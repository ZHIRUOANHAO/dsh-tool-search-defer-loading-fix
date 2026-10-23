import fs from 'fs';
const A = fs.readFileSync('D:/herness/resources/app.asar');
const B = fs.readFileSync('C:/tmp/app.asar.patched');
console.log('orig size:', A.length, '| patched size:', B.length, '| equal size:', A.length===B.length);
const FILE_OFF = 8 + A.readUInt32LE(4) + 111586548; // dataStart + offset
const FILE_SIZE = 32122;
const end = FILE_OFF + FILE_SIZE;
let diffCount = 0, firstDiff = -1, lastDiff = -1, outsideDiff = 0;
for(let i=0;i<A.length;i++){
  if(A[i]!==B[i]){
    diffCount++; if(firstDiff<0) firstDiff=i; lastDiff=i;
    if(i<FILE_OFF || i>=end) outsideDiff++;
  }
}
console.log('total differing bytes:', diffCount);
console.log('first diff at:', firstDiff, '| last diff at:', lastDiff);
console.log('file region: [', FILE_OFF, ',', end, ')');
console.log('diffs OUTSIDE target file region:', outsideDiff, outsideDiff===0?'(安全：只改了目标文件)':'(危险!)');
// 提取补丁区域内容做对照
const region = B.slice(FILE_OFF, end).toString('utf8');
console.log('region has defer_loading?', region.includes('defer_loading'));
console.log('region starts:', JSON.stringify(region.slice(0,60)));
