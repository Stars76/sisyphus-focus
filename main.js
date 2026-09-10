// 西西弗斯 · 桌面版 · Electron 主进程
// 主窗口（今日事 + 专注钟）+ 专注钟紧凑小窗（无边框 / 可置顶 / 记住位置）
//
// 架构（v1.1 起）：
//   main.js              进程装配、窗口、生命周期
//   src/main/store.js    权威数据存储（唯一写者，userData/sisy-store.json）
//   src/main/timer.js    唯一计时状态机（主窗内嵌视图与小窗都只是显示端）
//   src/main/tray.js     托盘常驻
//   src/main/ipc.js      全部 IPC 注册
'use strict';

const { app, BrowserWindow, ipcMain, shell, screen, powerMonitor, Notification, Menu } = require('electron');
const path = require('path');

const { createStore } = require('./src/main/store');
const { createTimer } = require('./src/main/timer');
const { createTray } = require('./src/main/tray');
const { createIpc } = require('./src/main/ipc');
const { createAlarm } = require('./src/main/alarm');
const util = require('./src/main/util');

let win = null;        // 主窗口
let timerWin = null;   // 专注钟紧凑小窗
let store = null;
let timer = null;
let alarm = null;
let tray = null;
let ipc = null;
let isQuitting = false;
let trayHintShown = false;

const COMPACT_FLAG = '--compact-timer';
const TIMER_PRESET = { width: 320, height: 430, minWidth: 230, minHeight: 300 };
const timerWinFile = () => path.join(app.getPath('userData'), 'sisy-timer-win.json');

/* ============================================================
 * 日志
 * ============================================================ */
function log() {
  const args = Array.prototype.slice.call(arguments);
  const line = '[main] ' + args.map((a) => (a && a.stack) ? a.stack : String(a)).join(' ');
  console.log(line);
  if (ipc) ipc.appendLog([line]);
}

/* ============================================================
 * 数据目录
 *   唯一数据目录是 %APPDATA%\Sisyphus（Electron 按 productName 取目录名）。
 *   2.0.0 起存储键前缀与文件名统一为 sisy-*：不提供从 1.x 的自动迁移，
 *   1.x 数据留在原目录里不予读取（迁移口径见 CHANGELOG / docs/data.md）。
 * ============================================================ */

/* ============================================================
 * 窗口
 * ============================================================ */
function broadcast(channel, payload) {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w || w.isDestroyed()) return;
    const wc = w.webContents;
    try { wc.send(channel, payload); } catch (e) { log('广播失败 ' + channel, e); }
    // webContents.send 只可靠送达顶层帧；今日事在 iframe（子框架）里，
    // 需用 sendToFrame 显式路由，否则 iframe 收不到计时状态/事件广播
    // （真实桌面验收复现：任务 focus 后 current-task 高亮不出现、历史不自动刷新）。
    try {
      (wc.mainFrame.frames || []).forEach((f) => {
        if (f && Number.isInteger(f.processId) && Number.isInteger(f.routingId)) {
          wc.sendToFrame([f.processId, f.routingId], channel, payload);
        }
      });
    } catch (e) { log('子框架广播失败 ' + channel, e); }
  });
}

function showMainWindow() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

function reloadAll() {
  BrowserWindow.getAllWindows().forEach((w) => {
    if (w && !w.isDestroyed()) { try { w.webContents.reload(); } catch (e) { log('刷新窗口失败', e); } }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1060,
    height: 780,
    minWidth: 720,
    minHeight: 560,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#F0F4F8',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 今日事在 iframe 里，必须让 preload 也注入子框架，
      // 否则 iframe 拿不到 dshStore/dshTimer，会退回 localStorage 造成数据分裂
      nodeIntegrationInSubFrames: true,
      sandbox: false
    }
  });

  win.loadFile('index.html');
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const notifyState = () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('win:state', { maximized: win.isMaximized() });
    }
  };
  ['maximize', 'unmaximize', 'restore', 'resize'].forEach((ev) => win.on(ev, notifyState));

  // 关闭 -> 留在托盘（可关闭该行为）
  win.on('close', (e) => {
    if (isQuitting) return;
    const prefs = timer ? timer.getPrefs() : null;
    if (prefs && prefs.closeToTray && tray && tray.exists) {
      e.preventDefault();
      win.hide();
      if (!trayHintShown) {
        trayHintShown = true;
        try {
          if (Notification.isSupported()) {
            new Notification({
              title: '西西弗斯 仍在后台运行',
              body: '专注钟继续计时。右键任务栏托盘图标可开始/暂停或退出。',
              silent: true
            }).show();
          }
        } catch (err) { log('托盘提示失败', err); }
      }
      log('主窗已隐藏到托盘');
    }
  });
}

/* ============================================================
 * 专注钟紧凑小窗
 * ============================================================ */
function defaultTimerBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  const m = 16;
  return {
    x: Math.round(wa.x + wa.width - TIMER_PRESET.width - m),
    y: Math.round(wa.y + wa.height - TIMER_PRESET.height - m),
    width: TIMER_PRESET.width,
    height: TIMER_PRESET.height
  };
}

function loadTimerBounds() {
  try {
    const fs = require('fs');
    const b = JSON.parse(fs.readFileSync(timerWinFile(), 'utf8'));
    if (b && Number.isFinite(b.x) && Number.isFinite(b.y) && b.width > 120 && b.height > 160) {
      const d = screen.getDisplayMatching(b);
      const wa = d && d.workArea;
      if (wa) {
        const visibleX = b.x > wa.x - b.width + 60 && b.x < wa.x + wa.width - 60;
        const visibleY = b.y >= wa.y - 4 && b.y < wa.y + wa.height - 40;
        if (visibleX && visibleY) return b;
      }
    }
  } catch (e) { if (e && e.code !== 'ENOENT') log('读取小窗位置失败', e); }
  return null;
}

function saveTimerBounds() {
  if (!timerWin || timerWin.isDestroyed()) return;
  try {
    const fs = require('fs');
    fs.writeFileSync(timerWinFile(), JSON.stringify(timerWin.getBounds()));
  } catch (e) { log('保存小窗位置失败', e); }
}

function createTimerWindow() {
  if (timerWin && !timerWin.isDestroyed()) {
    if (!timerWin.isVisible()) timerWin.show();
    timerWin.focus();
    return timerWin;
  }
  const def = defaultTimerBounds();
  const b = loadTimerBounds() || def;
  timerWin = new BrowserWindow({
    x: b.x, y: b.y,
    width: b.width || def.width,
    height: b.height || def.height,
    minWidth: TIMER_PRESET.minWidth,
    minHeight: TIMER_PRESET.minHeight,
    show: false,
    frame: false,
    transparent: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    minimizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#F0F4F8',
    title: '专注钟',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  timerWin.setAlwaysOnTop(true, 'floating');
  timerWin.loadFile('src/timer/index.html', { query: { compact: '1' } });
  timerWin.once('ready-to-show', () => timerWin.show());
  timerWin.on('closed', () => { timerWin = null; });

  let saveT = null;
  const queueSave = () => { if (saveT) clearTimeout(saveT); saveT = setTimeout(saveTimerBounds, 400); };
  timerWin.on('moved', queueSave);
  timerWin.on('resized', queueSave);
  timerWin.on('close', saveTimerBounds);
  return timerWin;
}

/* ============================================================
 * 单实例锁
 * ============================================================ */
const launchCompactOnly = process.argv.indexOf(COMPACT_FLAG) !== -1;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (argv.indexOf(COMPACT_FLAG) !== -1) { createTimerWindow(); return; }
    showMainWindow();
  });
}

app.setAppUserModelId('com.sisyphus.studio');

/* ============================================================
 * 启动装配
 * ============================================================ */
app.whenReady().then(() => {
  const userData = app.getPath('userData');

  store = createStore({
    dir: userData,
    log: log,
    warn: log
  });
  const loaded = store.load();
  log('存储文件:', store.file, loaded.loaded ? '(已加载)' : '(新建)');
  store.rollingBackup();

  timer = createTimer({
    store: store,
    log: log,
    date: util,
    onBroadcast: (snap) => {
      broadcast('timer:state', snap);
      if (tray) tray.refresh(snap);
    },
    onEvent: (ev) => {
      broadcast('timer:event', ev);
      if (ev.type === 'done' && !ev.silent) {
        log('完成事件:', ev.phase, ev.plannedMinutes + 'min');
      }
    },
    notify: (title, body) => {
      try {
        if (!Notification.isSupported()) return;
        new Notification({ title: title, body: body, silent: true }).show();
      } catch (e) { log('系统通知失败', e); }
    }
  });

  tray = createTray({
    log: log,
    timer: timer,
    iconPath: path.join(__dirname, 'assets', 'icon.png'),
    onShowMain: () => showMainWindow(),
    onOpenCompact: () => createTimerWindow(),
    onQuit: () => { isQuitting = true; app.quit(); }
  });

  alarm = createAlarm({
    store: store,
    log: log,
    date: util,
    notify: (title, body) => {
      try {
        if (Notification.isSupported()) {
          new Notification({ title: title, body: body, silent: true }).show();
        }
      } catch (e) { log('闹钟系统通知失败', e); }
    }
  });

  ipc = createIpc({
    store: store,
    timer: timer,
    log: log,
    getWin: () => win,
    getTimerWin: () => timerWin,
    createTimerWindow: createTimerWindow,
    reloadAll: reloadAll,
    logDir: path.join(userData, 'logs')
  });
  ipc.register();

  timer.init();
  alarm.start();

  if (launchCompactOnly) createTimerWindow();
  else createWindow();

  if (timer.getPrefs().tray) tray.create();

  // 系统休眠 / 唤醒：唤醒后立刻按真实时间重算剩余
  try {
    powerMonitor.on('resume', () => { log('系统唤醒，重算计时'); timer.resumeTicker(); });
    powerMonitor.on('suspend', () => { log('系统休眠，暂停心跳'); timer.pauseTicker(); });
    powerMonitor.on('unlock-screen', () => { timer.resumeTicker(); });
  } catch (e) { log('电源事件监听失败', e); }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (launchCompactOnly) createTimerWindow();
      else createWindow();
    } else {
      showMainWindow();
    }
  });

  // 托盘偏好切换后即时生效（仅接受布尔）
  ipcMain.handle('tray:set', (e, on) => {
    if (typeof on !== 'boolean') return timer.snapshot();
    const p = timer.setPrefs({ tray: on });
    if (p.prefs.tray) { if (tray) tray.create(); }
    else if (tray) tray.destroy();
    return p;
  });

  // 去掉默认菜单栏（Windows 上 Alt 会露出菜单）
  try { Menu.setApplicationMenu(null); } catch (e) { }
});

app.on('window-all-closed', () => {
  // 托盘还在就继续常驻，否则退出
  if (tray && tray.exists && !isQuitting) return;
  app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  if (timer) timer.flush();
  if (store) store.flush();
});

app.on('will-quit', () => {
  if (timer) timer.flush();
  if (store) store.flush();
  if (tray) tray.destroy();
  log('退出');
});

process.on('uncaughtException', (err) => {
  log('未捕获异常', err);
});
process.on('unhandledRejection', (reason) => {
  log('未处理的 Promise 拒绝', reason);
});
