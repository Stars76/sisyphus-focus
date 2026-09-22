/* ============================================================
 * src/main/menu.js · 应用菜单模板（仅 macOS 使用）
 * ------------------------------------------------------------
 * Windows 上应用菜单一律移除：Alt 会露出系统菜单，与自绘标题栏冲突
 * （见 main.js 里的 setApplicationMenu(null)）。
 *
 * macOS 不能照做。系统菜单栏承载着 Cmd+Q / Cmd+C / Cmd+V / Cmd+X /
 * Cmd+A / Cmd+W / Cmd+M / Cmd+H 这些由菜单 role 提供的系统级快捷键，
 * 菜单一旦被移除，它们会全部失效——应用甚至无法用键盘退出。
 *
 * 因此 macOS 上装一份最小菜单：只放系统约定必需的 role，标签交给系统。
 *
 * 本模块只产出**纯数据**模板（不 require electron），装配交给 main.js，
 * 这样 tools/check-syntax.js 与 tests/menu-template.test.js 都能直接断言。
 * ============================================================ */
'use strict';

/* macOS 上缺一不可的 role 清单（tests/menu-template.test.js 按此校验）：
 *   quit                → Cmd+Q，没有它应用无法用键盘退出
 *   copy/paste/cut/selectAll → Cmd+C/V/X/A，输入框里的复制粘贴全靠它
 *   undo/redo           → Cmd+Z / Cmd+Shift+Z
 *   minimize/close      → Cmd+M / Cmd+W
 *   front               → 常规「全部置于顶层」
 *   reload/toggleDevTools → Cmd+R / Cmd+Opt+I（README 与 docs/diagnostics.md 有写）
 */
const REQUIRED_ROLES = [
  'quit',
  'undo', 'redo', 'cut', 'copy', 'paste', 'selectAll',
  'reload', 'toggleDevTools',
  'minimize', 'close', 'front'
];

function buildDarwinTemplate(appName) {
  const name = appName || '西西弗斯';
  return [
    {
      label: name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
        { type: 'separator' },
        { role: 'front' }
      ]
    }
  ];
}

/* 递归收集模板里出现的所有 role（纯函数，供测试与自检使用） */
function collectRoles(template) {
  const out = [];
  (function walk(items) {
    (items || []).forEach(function (it) {
      if (!it) return;
      if (typeof it.role === 'string') out.push(it.role);
      if (Array.isArray(it.submenu)) walk(it.submenu);
    });
  })(template);
  return out;
}

module.exports = { buildDarwinTemplate: buildDarwinTemplate, collectRoles: collectRoles, REQUIRED_ROLES: REQUIRED_ROLES };
