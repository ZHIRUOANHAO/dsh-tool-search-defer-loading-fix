import fs from 'fs';
import crypto from 'crypto';

const ASAR = 'D:/herness/resources/app.asar';
const BASENAME = 'openai-responses-shared.js';
const OUT = 'C:/tmp/app.asar.patched';
const WRITE = process.argv.includes('--write');

const full = fs.readFileSync(ASAR);
const headerSize = full.readUInt32LE(4);
const headerBuf = full.slice(8, 8 + headerSize);
const idx = headerBuf.indexOf('{"files":');
const raw = headerBuf.slice(idx).toString('utf8');
const headerJson = JSON.parse(raw.slice(0, raw.lastIndexOf('}') + 1));
const dataStart = 8 + headerSize;

let found = null;
function walk(node, path){
  if(!node || !node.files) return;
  for(const [name, child] of Object.entries(node.files)){
    const p = path ? path + '/' + name : name;
    if(child && child.files){ walk(child, p); }
    else if(name === BASENAME && p.includes('pi-ai') && !found){
      found = { path: p, size: child.size, offset: Number(child.offset), integrity: child.integrity };
    }
  }
}
walk(headerJson, '');
if(!found){ console.error('NOT FOUND'); process.exit(2); }
console.log('found:', found.path, '| size:', found.size, '| offset:', found.offset);

const absOff = dataStart + found.offset;
const onDisk = full.slice(absOff, absOff + found.size);

// 权威校验：SHA256(onDisk) 必须等于 header 记录的 hash
let ok = false;
if(found.integrity && found.integrity.hash){
  const h = crypto.createHash('sha256').update(onDisk).digest('hex');
  console.log('computed:', h, '\nrecorded:', found.integrity.hash);
  ok = (h === found.integrity.hash);
} else {
  // 无 integrity 时退而用长度自洽
  ok = (onDisk.length === found.size);
}
if(!ok){ console.error('INTEGRITY MISMATCH - offset wrong - ABORT'); process.exit(3); }
console.log('OFFSET+INTEGRITY VERIFIED OK');

const s = onDisk.toString('utf8');
const target = '{ defer_loading: true }';
const occ = s.split(target).length - 1;
console.log('occurrences of defer obj:', occ);
console.log('defer_loading total in file:', s.split('defer_loading').length - 1);
if(occ < 1){ console.error('target not found in bundled version - ABORT'); process.exit(6); }
const repl = '{' + ' '.repeat(target.length - 2) + '}';
const patchedBuf = Buffer.from(s.split(target).join(repl), 'utf8');
if(patchedBuf.length !== onDisk.length){ console.error('LEN CHANGED'); process.exit(5); }
fs.writeFileSync('C:/tmp/_chk.js', patchedBuf);
console.log('patched same-length OK:', patchedBuf.length);

if(!WRITE){ console.log('DRY-RUN OK. use --write'); process.exit(0); }
const out = Buffer.from(full);
patchedBuf.copy(out, absOff);
fs.writeFileSync(OUT, out);
console.log('WROTE', OUT, out.length);
