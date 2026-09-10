#!/usr/bin/env node
/* ============================================================
 * tools/check-links.js · Markdown 内部链接自检（不联网）
 * ------------------------------------------------------------
 * 文档是最容易悄悄腐烂的一环：重写文档后留下死链/死锚点，读者点到才发现。
 * 这个脚本把「文件存在」与「#锚点存在」两件事静态查掉：
 *   - 支持相对路径（README.md → docs/data.md）与同目录（docs/a.md → b.md）
 *   - 锚点按 GitHub 的生成规则还原：小写、去掉标点、空格转连字符（中文保留）
 *   - 跳过 http(s) / mailto / 纯 # 开头的链接
 * 用法：node tools/check-links.js
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['electron', 'node_modules', 'backups', '.git', 'dist', 'release', '.tmp', 'tmp']);

/** 收集仓库内所有 .md（跳过体积大/非文档目录） */
function mdFiles(dir, out) {
  out = out || [];
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) mdFiles(p, out);
    else if (/\.md$/i.test(name)) out.push(p);
  }
  return out;
}

/** 按 GitHub 的规则把标题还原成锚点 */
function anchorsOf(file) {
  const out = new Set();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^#{1,6}\s+(.*)$/.exec(line);
    if (!m) continue;
    out.add(m[1].toLowerCase().replace(/[^\w\u4e00-\u9fa5\s-]/g, '').trim().replace(/\s+/g, '-'));
  }
  return out;
}

let bad = 0;
let total = 0;
const files = mdFiles(ROOT);

for (const f of files) {
  const rel = path.relative(ROOT, f);
  const text = fs.readFileSync(f, 'utf8');
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const [file, anchor] = target.split('#');
    const abs = path.resolve(path.dirname(f), file);
    total++;
    if (!fs.existsSync(abs)) { console.error('  ✗ ' + rel + '：目标文件不存在 → ' + target); bad++; continue; }
    if (anchor && !anchorsOf(abs).has(anchor)) { console.error('  ✗ ' + rel + '：锚点不存在 → ' + target); bad++; }
  }
}

console.log('  ✓ 检查了 ' + files.length + ' 个 Markdown 文件 / ' + total + ' 条内部链接');
if (bad) {
  console.error('\n文档链接检查失败：' + bad + ' 条问题\n');
  process.exit(1);
}
console.log('\n文档链接全部有效 ✅\n');
