#!/usr/bin/env node
/* ============================================================
 * tools/check-syntax.js · 静态自检（不启动 Electron）
 * ------------------------------------------------------------
 * 1) 所有 .js 文件 + tools/*.cjs 语法检查
 * 2) HTML 内联 <script> 语法检查
 * 3) HTML 引用的外部脚本存在性检查
 * 4) getElementById("x") 的 id 是否真的存在于该页面（含其脚本）
 * 5) 工具脚本（tools/*.cjs|js）里引用的元素 id 是否存在于三个页面之一
 *    —— 页面元素被删掉而验收脚本还在引用，是最容易漏的一类回归
 * 用法：node tools/check-syntax.js
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['electron', 'node_modules', 'backups', '.git', 'dist', 'release', '.tmp', 'tmp']);

let errors = 0;
let checked = 0;

function fail(msg) { errors++; console.error('  ✗ ' + msg); }
function ok(msg) { console.log('  ✓ ' + msg); }

function walk(dir, out) {
  out = out || [];
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/* ---------------- 1) JS 语法 ---------------- */
console.log('\n[1/5] JavaScript 语法检查');
const jsFiles = walk(ROOT).filter((f) => f.endsWith('.js') || f.endsWith('.cjs'));
for (const f of jsFiles) {
  const rel = path.relative(ROOT, f);
  try {
    new vm.Script(fs.readFileSync(f, 'utf8'), { filename: rel });
    checked++;
  } catch (e) {
    fail(rel + ': ' + e.message);
  }
}
if (checked === jsFiles.length) ok(jsFiles.length + ' 个 JS/CJS 文件语法正确');

/* ---------------- 2/3/4) HTML ---------------- */
console.log('\n[2/5] HTML 内联脚本语法 + 引用检查');
const htmlFiles = walk(ROOT).filter((f) => f.endsWith('.html'));
const idIndex = {};

for (const f of htmlFiles) {
  const rel = path.relative(ROOT, f);
  const html = fs.readFileSync(f, 'utf8');
  const dir = path.dirname(f);

  /* 收集 id */
  const ids = new Set();
  const idRe = /\bid\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = idRe.exec(html))) ids.add(m[1]);

  /* 外部脚本存在性 */
  const srcRe = /<script[^>]+src\s*=\s*"([^"]+)"/g;
  const extScripts = [];
  while ((m = srcRe.exec(html))) {
    const src = m[1];
    const target = path.resolve(dir, src);
    extScripts.push(target);
    if (!fs.existsSync(target)) fail(rel + ' 引用的脚本不存在: ' + src);
  }

  /* 内联脚本语法 */
  const inlineRe = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let inlineCount = 0;
  while ((m = inlineRe.exec(html))) {
    inlineCount++;
    try { new vm.Script(m[1], { filename: rel + '#inline' + inlineCount }); }
    catch (e) { fail(rel + ' 内联脚本语法错误: ' + e.message); }
  }

  /* 外部脚本里出现的 id 也并入该页面的 id 集合 */
  for (const s of extScripts) {
    if (!fs.existsSync(s)) continue;
    try {
      const code = fs.readFileSync(s, 'utf8');
      const gRe = /getElementById\(\s*['"]([A-Za-z0-9_$-]+)['"]\s*\)/g;
      let g;
      while ((g = gRe.exec(code))) {
        const id = g[1];
        if (!ids.has(id)) fail(rel + ' 缺少 id="' + id + '"（被 ' + path.relative(ROOT, s) + ' 引用）');
      }
      const idRe2 = /\bid\s*=\s*"([^"]+)"/g;
      let g2;
      while ((g2 = idRe2.exec(code))) ids.add(g2[1]);
    } catch (e) { fail('读取 ' + s + ' 失败: ' + e.message); }
  }

  idIndex[rel] = ids;
  checked++;
}
ok(htmlFiles.length + ' 个 HTML 页面检查完成');

/* ---------------- 工具脚本 id 交叉检查 ---------------- */
/* 页面元素被删掉、而 tools/ 下的验收或冒烟脚本还在引用它，是历史真发生过的一类回归；
 * 静态扫一遍能提前发现（引用不存在的 id 会让脚本在运行时抛 null）。 */
console.log('\n[3/5] 工具脚本引用的元素 id 检查');
const allIds = new Set();
Object.keys(idIndex).forEach((page) => idIndex[page].forEach((id) => allIds.add(id)));
const toolFiles = fs.readdirSync(path.join(ROOT, 'tools'))
  .filter((f) => /\.(cjs|js)$/.test(f))
  .filter((f) => f !== 'check-syntax.js')      // 本文件头部注释里就写着 getElementById 的示例，自己扫自己必然误报
  .map((f) => path.join(ROOT, 'tools', f));
let toolRefs = 0;
for (const f of toolFiles) {
  const rel = path.relative(ROOT, f);
  const code = fs.readFileSync(f, 'utf8');
  const gRe = /getElementById\(\s*['"]([A-Za-z0-9_$-]+)['"]\s*\)/g;
  let m;
  while ((m = gRe.exec(code))) {
    toolRefs++;
    if (!allIds.has(m[1])) fail(rel + ' 引用了不存在的元素 id: #' + m[1]);
  }
  /* 形如 const ids=['a','b',...] / const nodes=[...] 的「元素清单」：
   * 清单里过半是真实 id 时才当成 id 清单，剩下的按过期 id 报错（避免把普通字符串数组当误报）。 */
  const listRe = /(?:const|var|let)\s+\w*(?:ids|nodes|controls)\w*\s*=\s*\[([^\]]{2,400})\]/g;
  while ((m = listRe.exec(code))) {
    const items = m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    if (items.length < 2) continue;
    const known = items.filter((i) => allIds.has(i));
    if (known.length < 2 || known.length * 2 < items.length) continue;
    items.filter((i) => !allIds.has(i)).forEach((i) => fail(rel + ' 的元素清单里有已不存在的 id: #' + i));
  }
}
if (!errors) ok(toolRefs + ' 处工具脚本 id 引用全部存在于页面');

/* ---------------- 汇总 ---------------- */
console.log('\n[4/5] 脚本依赖顺序检查');
const ORDER_RULES = [
  {
    page: 'src/todo/index.html',
    mustBefore: [
      ['../shared/storage.js', 'state.js'],
      ['state.js', 'render.js'],
      ['render.js', 'app.js'],
      ['../shared/icons.js', 'render.js']
    ]
  },
  {
    page: 'src/timer/index.html',
    mustBefore: [
      ['../shared/storage.js', 'state.js'],
      ['state.js', 'app.js'],
      ['flow.js', 'app.js'],
      ['audio.js', 'app.js'],
      ['ui.js', 'app.js']
    ]
  }
];
for (const rule of ORDER_RULES) {
  const p = path.join(ROOT, rule.page);
  if (!fs.existsSync(p)) { fail('缺少页面 ' + rule.page); continue; }
  const html = fs.readFileSync(p, 'utf8');
  for (const [a, b] of rule.mustBefore) {
    const ia = html.indexOf(a);
    const ib = html.indexOf(b);
    if (ia === -1) fail(rule.page + ' 未引用 ' + a);
    else if (ib === -1) fail(rule.page + ' 未引用 ' + b);
    else if (ia > ib) fail(rule.page + ' 脚本顺序错误：' + a + ' 必须在 ' + b + ' 之前');
  }
}
if (!errors) ok('依赖顺序正确');

console.log('\n[5/5] 汇总');
if (errors) {
  console.error('\n检查失败：' + errors + ' 个问题\n');
  process.exit(1);
}
console.log('\n全部检查通过 ✅\n');
