// Verify the expected source set, including CSS/assets, against exactly the requested archive.
'use strict';
const path = require('path');
const fs = require('fs');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
const archive = process.argv[2] || path.join(root,'release/current-build/app.asar');
if (!fs.existsSync(archive)) { console.error('Missing requested archive: ' + archive); process.exit(2); }
function walk(rel) {
  return fs.readdirSync(path.join(root,rel),{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(rel+'/'+d.name):[rel+'/'+d.name]);
}
const expected = ['main.js','preload.js','index.html','package.json',...walk('src'),...walk('assets')].sort();
let matched=0, failed=0;
for (const rel of expected) {
  let buf;
  for (const key of [rel,rel.replace(/\//g,'\\')]) { try {buf=asar.extractFile(archive,key);break;} catch(_) {} }
  if (!buf) { console.error('MISSING '+rel); failed++; continue; }
  const src=fs.readFileSync(path.join(root,rel));
  let same=src.equals(buf);
  if (rel==='package.json') {
    const a=JSON.parse(src), b=JSON.parse(buf);
    same=['name','main','productName','version'].every(k=>a[k]===b[k]);
    console.log('packaged version: '+b.version);
  }
  console.log((same?'MATCH   ':'DIFFER  ')+rel);
  same ? matched++ : failed++;
}
const included=asar.listPackage(archive).map(p=>p.replace(/\\/g,'/').replace(/^\//,''));
for (const rel of included) {
  if (/^(src|assets)\/.+\.[^/]+$/.test(rel) && !expected.includes(rel)) { console.error('UNEXPECTED '+rel);failed++; }
}
console.log('archive: '+archive);
console.log('runtime source files='+expected.length+' matched='+matched+' failed='+failed);
process.exit(failed?1:0);
