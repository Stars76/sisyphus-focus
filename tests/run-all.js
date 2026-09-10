#!/usr/bin/env node
/* ============================================================
 * tests/run-all.js · 回归测试串行执行器
 * 用法：node tests/run-all.js   （或 npm run test:regression）
 * 不改动 tools/ 下的既有验收脚本；这里只负责把 tests/*.test.js
 * 逐个作为独立 Node 进程跑完并汇总。
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const files = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

let failed = 0;
const results = [];
for (const f of files) {
  const t0 = Date.now();
  process.stdout.write('\n======== ' + f + ' ========\n');
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
  const ok = r.status === 0;
  if (!ok) failed++;
  results.push({ file: f, ok, ms: Date.now() - t0 });
}

console.log('\n' + '='.repeat(52));
console.log('回归测试汇总：');
for (const x of results) console.log('  ' + (x.ok ? '✅' : '❌') + ' ' + x.file + '  (' + x.ms + 'ms)');
console.log('='.repeat(52));
if (failed) {
  console.error('失败文件：' + failed + ' / ' + results.length);
  process.exit(1);
}
console.log('全部回归测试通过 ✅');
process.exit(0);
