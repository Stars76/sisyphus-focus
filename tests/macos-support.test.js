/* ============================================================
 * tests/macos-support.test.js · macOS 适配回归
 * ------------------------------------------------------------
 * 覆盖三件在 macOS 上「少了就坏」的东西：
 *   1. 应用菜单模板完整性——少了 quit 就用不了 Cmd+Q，
 *      少了 copy/paste/selectAll 输入框里连复制粘贴都做不了；
 *   2. main.js 真的把它接上了（模块写了却没接线是静默失效）；
 *   3. 菜单栏模板图标资源存在。
 *
 * 纯 Node，不依赖 Electron：菜单模块只导出数据模板。
 * 用法：node tests/macos-support.test.js
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const H = require('./helpers');

const root = path.join(__dirname, '..');
const menu = require('../src/main/menu');
const mainSrc = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

H.group('1. 应用菜单模板（darwin）');
const tpl = menu.buildDarwinTemplate('Sisyphus');
H.assert(Array.isArray(tpl) && tpl.length >= 4, '模板是数组且含 App/编辑/视图/窗口 四组', tpl.length);
H.eq(tpl[0].label, 'Sisyphus', '第一组标签是应用名（macOS 的加粗应用菜单）');
H.assert(!!tpl[0].submenu, '应用菜单有子项');

const roles = menu.collectRoles(tpl);
const missing = menu.REQUIRED_ROLES.filter((r) => roles.indexOf(r) === -1);
H.assert(missing.length === 0, '必需 role 齐全', missing);
// 逐项点名，失败时能一眼看出缺的是哪个（macOS 上各自对应一个系统快捷键）
['quit', 'copy', 'paste', 'cut', 'selectAll', 'undo', 'redo', 'minimize', 'close']
  .forEach((r) => { H.assert(roles.indexOf(r) !== -1, '含 role：' + r); });
// 文档里写过的两个调试快捷键靠菜单 role 提供
H.assert(roles.indexOf('reload') !== -1 && roles.indexOf('toggleDevTools') !== -1,
  '含 reload / toggleDevTools（README 与 docs/diagnostics.md 有写）');

H.group('2. 不传应用名时的兜底');
H.eq(menu.buildDarwinTemplate()[0].label, '西西弗斯', '未传 appName 时回落到中文品牌名');
H.eq(menu.buildDarwinTemplate('Sisyphus')[0].label, 'Sisyphus', '传入 appName 时以传入值为准');

H.group('3. collectRoles 递归');
H.eq(menu.collectRoles([{ submenu: [{ submenu: [{ role: 'deep' }] }] }]).join(','), 'deep', '能挖到嵌套两层里的 role');
H.eq(menu.collectRoles([{ label: '无 role' }, { type: 'separator' }]).length, 0, '没有 role 的项不产出条目');
H.eq(menu.collectRoles(null).length, 0, '空输入返回空数组');

H.group('4. main.js 接线');
H.assert(mainSrc.indexOf("require('./src/main/menu')") !== -1, 'main.js 引入了应用菜单模块');
H.assert(mainSrc.indexOf('buildDarwinTemplate') !== -1, 'main.js 调用了 buildDarwinTemplate');
H.assert(mainSrc.indexOf('Menu.setApplicationMenu(null)') !== -1, '非 macOS 分支仍然移除菜单（原有行为不回退）');
H.assert(mainSrc.indexOf('IS_MAC') !== -1, '平台判断走 IS_MAC');

H.group('5. macOS 资源');
['trayTemplate.png', 'trayTemplate@2x.png'].forEach((f) => {
  const p = path.join(root, 'assets', f);
  H.assert(fs.existsSync(p), '菜单栏模板图标存在：' + f);
  if (fs.existsSync(p)) {
    const buf = fs.readFileSync(p);
    // PNG 签名 + IHDR 里的宽高，确认不是空文件或被误替换
    H.assert(buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a', f + ' 是合法 PNG');
    if (buf.length > 24) {
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      const want = f.indexOf('@2x') !== -1 ? 32 : 16;
      H.eq(w + 'x' + h, want + 'x' + want, f + ' 尺寸为 ' + want + 'px');
    }
  }
});
H.assert(fs.existsSync(path.join(root, 'build', 'make-tray-icon.js')), '模板图标生成脚本存在（资源可复现）');

H.finish();
