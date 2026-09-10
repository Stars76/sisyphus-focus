/* ============================================================
 * src/main/tray.js · 系统托盘常驻
 * ------------------------------------------------------------
 *   - 托盘提示实时显示剩余时间 / 状态
 *   - 菜单可直接 开始 / 暂停 / 重置 / 切换阶段
 *   - 快速打开专注钟小窗、显示主窗、退出应用
 *   - 主窗 ✕ 可配置为「留在托盘」（prefs.closeToTray）
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

  let tray = null;
  let rebuildT = null;
  let lastTitle = '';

  function icon() {
    try {
      const img = nativeImage.createFromPath(iconPath);
      if (img.isEmpty()) return nativeImage.createEmpty();
      return img.resize({ width: 16, height: 16 });
    } catch (e) { log('托盘图标加载失败', e); return nativeImage.createEmpty(); }
  }

  function title(snap) {
    const t = snap.timer;
    if (t.running) return '专注中 ' + Math.floor(t.leftSec / 60) + ':' + ('0' + (t.leftSec % 60)).slice(-2);
    if (t.paused) return '已暂停 ' + Math.floor(t.leftSec / 60) + ':' + ('0' + (t.leftSec % 60)).slice(-2);
    return t.phaseLabel + ' · 待开始';
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
    }
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
        tray.setContextMenu(buildMenu(timer.snapshot()));
        tray.on('click', () => { onShowMain(); });
        tray.on('double-click', () => { onShowMain(); });
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
