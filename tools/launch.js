#!/usr/bin/env node
/* ============================================================
 * tools/launch.js · 从源码启动西西弗斯（替代旧的 .cmd 启动脚本）
 * ------------------------------------------------------------
 * 用法：
 *   npm start            启动主窗（今日事）
 *   npm run compact      直接启动专注钟小窗
 *   node tools/launch.js [--compact-timer]
 *
 * 运行时解析顺序：
 *   1) 仓库内 Electron 运行时 electron/electron.exe（解压版，无需下载）
 *   2) node_modules 的 electron（npm install 后可用）
 * 两者都没有时给出明确提示，不静默失败。
 * ============================================================ */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const compact = args.indexOf('--compact-timer') !== -1;

function resolveRuntime() {
  const localWin = path.join(root, 'electron', 'electron.exe');
  const localUnix = path.join(root, 'electron', 'electron');
  if (fs.existsSync(localWin)) return localWin;
  if (fs.existsSync(localUnix)) return localUnix;
  try {
    return require('electron'); // devDependency 的二进制路径
  } catch (e) {
    return null;
  }
}

const bin = resolveRuntime();
if (!bin) {
  console.error('未找到 Electron 运行时。请任选其一：');
  console.error('  - 执行 npm install（会按 .npmrc 镜像下载 Electron）');
  console.error('  - 或把解压版运行时放到 electron/（需含 electron.exe）');
  process.exit(1);
}

// app path 必须是项目根，否则 main.js 的 loadFile('index.html') 会找不到页面
const child = spawn(bin, [root].concat(args), { detached: true, stdio: 'ignore' });
child.on('error', (err) => {
  console.error('启动失败：' + (err && err.message ? err.message : err));
  process.exit(1);
});
child.unref();
console.log('西西弗斯 已启动' + (compact ? '（专注钟小窗）' : '') + ' · 运行时：' + bin);
