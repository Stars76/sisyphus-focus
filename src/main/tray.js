/* ============================================================
 * src/main/tray.js · 系统托盘常驻
 * ------------------------------------------------------------
 *   - 托盘提示实时显示剩余时间 / 状态
 *   - 菜单可直接 开始 / 暂停 / 重置 / 切换阶段
 *   - 快速打开专注钟小窗、显示主窗、退出应用
 *   - 主窗 ✕ 可配置为「留在托盘」（prefs.closeToTray）
 *
 * 平台差异（两处，都在 macOS 上才成立）：
 *   1. 图标：macOS 菜单栏要单色模板图（系统自动反色）；
 *      其它平台继续用彩色应用图标缩到 16px。
 *   2. 菜单：macOS 上一旦 setContextMenu，click / double-click / right-click
 *      事件就都不再触发，因此不设常驻菜单，改为左键回主窗、右键临时弹出。
 * ============================================================ */
'use strict';

const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

function createTray(deps) {
  const log = deps.log || function () { };
  const timer = deps.timer;
  const onShowMain = deps.onShowMain || function () { };
  const onOpenCompact = deps.onOpenCompact || function () { };
  const onQuit = deps.onQuit || function () { };
  const iconPath = deps.iconPath;
  const templatePath = deps.templatePath;
  const isMac = process.platform === 'darwin';

  let tray = null;
  let rebuildT = null;
  let lastTitle = '';

  function icon() {
    try {
      // macOS：单色模板图 + setTemplateImage，系统按浅色/深色菜单栏自动反色。
      // 彩色图标缩到 16px 塞进菜单栏，在深色模式下是错的观感，Retina 下也会糊。
      if (isMac) {
        const tpl = nativeImage.createFromPath(templatePath || '');
        if (tpl.isEmpty()) return nativeImage.createEmpty();
        tpl.setTemplateImage(true);
        return tpl;
      }
      const img = nativeImage.createFromPath(iconPath);
      if (img.isEmpty()) return nativeImage.createEmpty();
      return img.resize({ width: 16, height: 16 });
    } catch (e) { log('托盘图标加载失败', e); return nativeImage.createEmpty(); }
  }

  function mmss(sec) {
    return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2);
  }

  function title(snap) {
    const t = snap.timer;
    if (t.running) return '专注中 ' + mmss(t.leftSec);
    if (t.paused) return '已暂停 ' + mmss(t.leftSec);
    return t.phaseLabel + ' · 待开始';
  }

  /* macOS 菜单栏文字：只在真正跑着或暂停时显示数字，待机时不占菜单栏位置 */
  function menuBarTitle(snap) {
    const t = snap.timer;
    return (t.running || t.paused) ? mmss(t.leftSec) : '';
  }

  function buildMenu(snap) {
    const t = snap.timer;
    const mm = Math.floor(t.leftSec / 60) + ':' + ('0' + (t.leftSec % 60)).slice(-2);
    const items = [
      { label: title(snap) + '（今日 ' + snap.stats.minutes + ' 分钟 / ' + snap.stats.rounds + ' 轮）', enabled: false },
      { type: 'separator' },
      { label: t.running ? '⏸ 暂停' : '▶ 开始', click: () => { timer.command(t.running ? 'pause' : 'start'); } },
      { label: '↺ 重置本轮', click: () => { timer.command('reset'); } },
      { type: 'separator' },
      { label: (t.phase === 'focus' ? '● ' : '○ ') + '专注 ' + Math.round(snap.phases.focus / 60) + ' 分钟', click: () => { timer.command('setPhase', { phase: 'focus' }); } },
      { label: (t.phase === 'short' ? '● ' : '○ ') + '短休息 ' + Math.round(snap.phases.short / 60) + ' 分钟', click: () => { timer.command('setPhase', { phase: 'short' }); } },
      { label: (t.phase === 'long' ? '● ' : '○ ') + '长休息 ' + Math.round(snap.phases.long / 60) + ' 分钟', click: () => { timer.command('setPhase', { phase: 'long' }); } },
      { type: 'separator' },
      { label: '⏱ 打开专注钟小窗', click: () => { onOpenCompact(); } },
      { label: '🧠 显示主窗口', click: () => { onShowMain(); } },
      { type: 'separator' },
      { label: '退出西西弗斯', click: () => { onQuit(); } }
    ];
    return Menu.buildFromTemplate(items);
  }

  function refresh(snap) {
    if (!tray || tray.isDestroyed()) return;
    // 轻量 tick 广播只带剩余时间字段，托盘菜单需要完整字段，忽略它改用主进程内存快照
    if (snap && snap.tick === true) snap = null;
    const snapNow = snap || timer.snapshot();
    const ttl = title(snapNow);
    if (ttl !== lastTitle) {
      lastTitle = ttl;
      try { tray.setToolTip('西西弗斯 · ' + ttl); } catch (e) { log('设置托盘提示失败', e); }
      // macOS 的原生做法：剩余时间直接写在菜单栏图标旁边（Windows 只能靠悬停提示）
      if (isMac) {
        try { tray.setTitle(menuBarTitle(snapNow)); } catch (e) { log('设置菜单栏标题失败', e); }
      }
    }
    // macOS 的菜单是右键临时弹出的，不存在常驻菜单需要重建
    if (isMac) return;
    if (rebuildT) return;
    rebuildT = setTimeout(() => {
      rebuildT = null;
      if (!tray || tray.isDestroyed()) return;
      try { tray.setContextMenu(buildMenu(snap || timer.snapshot())); }
      catch (e) { log('重建托盘菜单失败', e); }
    }, 400);
    if (rebuildT && typeof rebuildT.unref === 'function') rebuildT.unref();
  }

  return {
    create() {
      if (tray && !tray.isDestroyed()) return tray;
      try {
        tray = new Tray(icon());
        tray.setToolTip('西西弗斯');
        if (isMac) {
          // 不能 setContextMenu：macOS 上一旦设了常驻菜单，click / right-click 都不再触发，
          // 「点托盘回到主窗」会直接失效。改成左键回主窗、右键临时弹出同一份菜单。
          tray.on('click', () => { onShowMain(); });
          tray.on('right-click', () => { tray.popUpContextMenu(buildMenu(timer.snapshot())); });
        } else {
          tray.setContextMenu(buildMenu(timer.snapshot()));
          tray.on('click', () => { onShowMain(); });
          tray.on('double-click', () => { onShowMain(); });
        }
        refresh();
        log('托盘已就绪');
      } catch (e) {
        log('托盘创建失败（不影响其它功能）', e);
        tray = null;
      }
      return tray;
    },
    refresh,
    destroy() {
      if (rebuildT) { clearTimeout(rebuildT); rebuildT = null; }
      if (tray && !tray.isDestroyed()) { tray.destroy(); }
      tray = null;
    },
    get exists() { return !!(tray && !tray.isDestroyed()); }
  };
}

module.exports = { createTray };
