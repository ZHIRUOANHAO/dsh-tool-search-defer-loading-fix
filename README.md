# DeepSeek Harness Desktop（DSH）"所有工具被延迟加载" 报错修复

## 现象

DSH 运行某一轮时整轮失败，界面报：

```
本轮运行失败 tools: at least one tool must have defer_loading=false. All tools cannot be deferred.
(request_id: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
```

进程没崩、host 也在跑，但**每轮请求都被 DeepSeek API 拒绝**。

## 根因（源码级定位）

1. 报错来自 DeepSeek 官方 API 的校验：请求 `tools` 数组中 `defer_loading` 不能全部为 `true`，必须至少有一个 `false`。
2. `defer_loading` 字段由 DSH 的 AI 抽象层 **`@earendil-works/pi-ai`** 生成，位置：
   - `pi-ai/dist/api/openai-responses-shared.js`
   - 函数 `convertResponsesTools(tools, options)`
   - 当 `options.toolSearchResult` 为真时，给**每一个**工具都加 `...{ defer_loading: true }`。
3. 触发场景：DSH 的「工具搜索 / 渐进式工具加载」路径（`appendSystemToolAdditions` 生成 `tool_search_output` 项，`toolSearchResult: true`）会把一批工具整体以「搜索结果」形式发出。
4. 当一次请求里当前工具集**全部**经由这个路径发出（例如会话中途动态加了工具、装了较多插件使工具数量激增），就会「所有工具都 deferred」→ 被 DeepSeek 拒绝。

> 关键点：`defer_loading` 只在 **openai-responses** 代码路径产生（`openai-completions` 路径没有）。所以命中此 bug 说明当前模型走的是 responses/工具搜索路径。

## 修复（最小侵入补丁）

在 `pi-ai/dist/api/openai-responses-shared.js` 的 `convertResponsesTools` 中，
让这批「搜索结果工具」里**第一个工具永不延迟**（`__idx === 0` 时不加 `defer_loading`），
其余照旧延迟。这样任何请求都至少有一个 `defer_loading=false` 的工具，DeepSeek 校验永远满足，且保留了「其余工具延迟加载」的原功能。

改动前：
```js
    return tools.map((tool) => {
        ...
                ...(options?.toolSearchResult ? { defer_loading: true } : {}),
        ...
            ...(options?.toolSearchResult ? { defer_loading: true } : {}),
```

改动后：
```js
    return tools.map((tool, __idx) => {
        ...
                ...(options?.toolSearchResult && __idx > 0 ? { defer_loading: true } : {}),
        ...
            ...(options?.toolSearchResult && __idx > 0 ? { defer_loading: true } : {}),
```

补丁文件见 `patches/openai-responses-shared.patch`。

## 应用步骤（Windows / DSH 0.2.x / version 44.7.0）

DSH 有两份 pi-ai：
- **(A) Profile（插件侧）**：`C:\Users\<user>\.dsh\profiles\desktop\node_modules\@earendil-works\pi-ai\`
- **(B) 内置打包**：`D:\herness\resources\app.asar`（内部 `dsh/node_modules/@earendil-works/pi-ai/`）

### A. 先补 Profile 那份（推荐、安全、可随时还原）
1. 备份：复制 `openai-responses-shared.js` 为 `.bak`。
2. 按上面「改动后」修改该文件（3 处：map 签名 + 两处 defer 条件）。
3. 重启 DSH 生效。
4. 新建一个对话测试（见下方「临时绕行」）。

### B. 内置 app.asar（彻底根治，但需重打包，有风险）
> app.asar 内含 1583 个文件、含原生 `.node`（必须保持解包）。重打包务必用 `--unpack` 保留原生模块，否则会破坏 App。
1. 备份 `D:\herness\resources\app.asar`。
2. `npx @electron/asar extract app.asar extract_dir`
3. 对 `extract_dir/dsh/node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js` 打同样的补丁。
4. `npx @electron/asar pack extract_dir app.asar.new --unpack "…原生模块 glob…"`（glob 必须正确覆盖所有 `.node` 及原 app.asar.unpacked 内容）。
5. **验证**：重新 extract `app.asar.new`，确认补丁存在、原生 `.node` 在 `app.asar.new.unpacked` 中、文件数量与原包一致。
6. 关闭 DSH 后替换 app.asar 及其 .unpacked 目录，重启验证。

⚠️ 若无法保证 `--unpack` 精确，**不要替换**，否则原生模块无法加载、App 会起不来。

## 临时绕行（不改文件也能恢复可用）
- **新开一个对话**：该报错通常是「某个会话历史里含坏的 tool_search_output」在重放；新会话无此历史，通常直接可用。
- 减少插件数量（工具数量下降，不触发整体延迟）也能降低复发。

## 版本信息
- DSH desktop version: `44.7.0`，runtime desktopVersion `0.2.1-rc.2`
- pi-ai version: `1.3.0`
- 补丁文件位置（插件侧）：`%USERPROFILE%\.dsh\profiles\desktop\node_modules\@earendil-works\pi-ai\dist\api\openai-responses-shared.js`

## 建议上游
此类问题应在上游修复：`convertResponsesTools` 在 `toolSearchResult` 模式下应保证至少一个工具 `defer_loading:false`（或在会话层面保证）。可向 `earendil-works/pi` 与 DSH 官方反馈。
