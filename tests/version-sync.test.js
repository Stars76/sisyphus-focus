/* ============================================================
 * tests/version-sync.test.js · 版本一致性检查（任务 4）
 * package.json version ↔ CHANGELOG 最新条目 ↔ electron devDep/构建配置
 * 用法：node tests/version-sync.test.js
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const H = require('./helpers');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');

H.group('1. 版本号本体');
H.assert(/^\d+\.\d+\.\d+$/.test(pkg.version), 'package.json version 是 x.y.z', pkg.version);
const latest = /## (\d+\.\d+\.\d+)/.exec(changelog);
H.assert(!!latest, 'CHANGELOG 有版本条目');
H.eq(latest[1], pkg.version, 'CHANGELOG 最新条目与 package.json 一致');

H.group('2. 构建配置一致性');
const build = pkg.build || {};
H.assert(!!build.appId && !!build.productName, 'electron-builder 声明 appId/productName');
H.assert(/^[A-Za-z0-9 ._-]+$/.test(build.productName), 'productName 为纯 ASCII（防中文路径解包问题）', build.productName);
H.eq(build.appId, 'com.sisyphus.studio', 'appId 与 AppUserModelID 对齐（main.js）');
const targets = (build.win && build.win.target || []).map((t) => t.target);
H.assert(targets.indexOf('portable') !== -1 && targets.indexOf('nsis') !== -1, 'win 目标含 portable + nsis', targets);
H.assert(!!build.nsis && build.nsis.deleteAppDataOnUninstall === false, 'NSIS 卸载默认保留用户数据（文档已声明）');
H.assert(String(build.portable.artifactName || '').includes('${version}'), 'portable 产物名带版本号', build.portable.artifactName);
H.assert(String(build.nsis.artifactName).includes('${version}'), 'nsis 产物名带版本号', build.nsis.artifactName);

H.group('2b. macOS 构建配置');
const mac = build.mac || {};
const macTargets = (mac.target || []).map((t) => t.target);
H.assert(macTargets.indexOf('dmg') !== -1 && macTargets.indexOf('zip') !== -1, 'mac 目标含 dmg + zip', macTargets);
H.eq(mac.category, 'public.app-category.productivity', 'mac 声明应用分类（Finder 归类用）');
H.assert(fs.existsSync(path.join(root, mac.icon || '')), 'mac 图标文件存在', mac.icon);
H.assert(String(mac.artifactName || '').includes('${version}'), 'mac 产物名带版本号', mac.artifactName);
// arm64 与 x64 都产出，产物名必须带 ${arch}，否则两个架构互相覆盖
H.assert(String(mac.artifactName || '').includes('${arch}'), 'mac 产物名带架构', mac.artifactName);
H.assert(mac.hardenedRuntime === true, 'mac 开启强化运行时（公证的前置条件）');
H.assert(fs.existsSync(path.join(root, mac.entitlements || '')), 'mac entitlements 文件存在', mac.entitlements);
const macArchs = [];
(mac.target || []).forEach((t) => (t.arch || []).forEach((a) => macArchs.push(a)));
H.assert(macArchs.indexOf('arm64') !== -1 && macArchs.indexOf('x64') !== -1, 'mac 覆盖 arm64 与 x64', macArchs);

H.group('3. electron 依赖与 electronVersion 对齐');
if (fs.existsSync(path.join(root, 'node_modules/electron/package.json'))) {
  const installed = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version;
  H.eq(build.electronVersion, installed, 'build.electronVersion 与安装的 electron 一致');
} else {
  console.log('  （node_modules/electron 未安装，跳过安装态比对）');
}
const devRange = (pkg.devDependencies || {}).electron || '';
H.assert(devRange.replace(/^[\^~]/, '') === build.electronVersion, 'devDependencies.electron 与 electronVersion 对齐', devRange);

H.finish();
