/* ============================================================
 * src/main/ipc.js · 主进程 IPC 注册（带参数校验）
 * ------------------------------------------------------------
 * 渲染进程只能通过这里暴露的能力访问数据与计时状态：
 *   window.dshStore  -> 同步存储读写（主进程唯一写者）
 *   window.dshTimer  -> 计时状态订阅 / 命令
 *   window.dshData   -> 导出 / 导入 / 备份 / 清空（支持分区）
 *   window.dshLog    -> 日志转发
 *   window.dshApp    -> 版本、路径、平台
 *
 * 安全约束（v1.2 起）：
 *   - 所有入口参数做类型 / 白名单校验，非法一律拒绝且不落数据
 *   - data:reveal 只允许应用数据目录内的路径
 *   - 导入只备份一次（store.importAll 内部完成），UI 展示摘要后再确认
 *   - 日志单行截断，不含任务正文等隐私内容
 * ============================================================ */
'use strict';

const path = require('path');

const LOG_MAX = 1024 * 1024;   // 1 MB 后滚动
const LOG_LINE_MAX = 600;      // 单行截断，防止把大对象写进日志
const LOG_BATCH_MAX = 200;     // 单次上报条数上限

function createIpc(deps) {
  const store = deps.store;
  const timer = deps.timer;
  const log = deps.log || function () { };
  const getWin = deps.getWin;
  const getTimerWin = deps.getTimerWin;
  const createTimerWindow = deps.createTimerWindow;
  const reloadAll = deps.reloadAll || function () { };
  const logDir = deps.logDir;
  const logFile = path.join(logDir, 'sisy.log');
  const schema = require('./schema');

  // Electron API 可注入（便于纯 Node 回归测试），默认取真实模块
  const electron = deps.electron || require('electron');
  const { ipcMain, dialog, shell, app, Notification } = electron;
  const fs = deps.fs || require('fs');

  const OK = { ok: true };
  function fail(reason, detail) {
    log('IPC 拒绝: ' + reason);
    return { ok: false, error: reason, detail: detail === undefined ? undefined : String(detail).slice(0, 200) };
  }

  function isStr(v, max) { return typeof v === 'string' && v.length <= (max || 1024); }
  function isBool(v) { return typeof v === 'boolean'; }

  /* ---------------- 参数校验器 ---------------- */
  function checkKey(key) {
    if (!isStr(key, schema.MAX_KEY_LEN) || !schema.isValidStoreKey(key)) return '非法键名';
    return null;
  }
  const TIMER_COMMANDS = ['start', 'pause', 'toggle', 'reset', 'setPhase', 'setDuration', 'abandon', 'resetToday', 'refresh', 'applyPlan'];
  function checkTimerCommand(type, payload) {
    if (typeof type !== 'string' || TIMER_COMMANDS.indexOf(type) === -1) return '未知计时命令';
    if (payload !== undefined && (payload === null || typeof payload !== 'object' || Array.isArray(payload))) return '命令负载必须是对象';
    if (type === 'setPhase') {
      if (!payload || schema.PHASE_SET.indexOf(payload.phase) === -1) return 'phase 必须是 focus/short/long';
    }
    if (type === 'setDuration') {
      const sec = payload && payload.sec;
      if (typeof sec !== 'number' || !isFinite(sec) || !Number.isInteger(sec) || sec < 60 || sec > 180 * 60) {
        return 'sec 必须是 60..10800 的整数';
      }
    }
    if (type === 'applyPlan') {
      if (!payload || schema.PLAN_KEYS.indexOf(payload.plan) === -1) return 'plan 必须是预设键之一';
    }
    return null;
  }
  function checkPrefsPatch(patch) {
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return '偏好必须是对象';
    for (const k of ['sound', 'notify', 'tray', 'closeToTray', 'highContrast', 'showSeconds']) {
      if (patch[k] !== undefined && !isBool(patch[k])) return '偏好 ' + k + ' 必须是布尔';
    }
    if (patch.motion !== undefined && ['full', 'calm', 'off'].indexOf(patch.motion) === -1) return 'motion 非法';
    if (patch.phases !== undefined) {
      if (patch.phases === null || typeof patch.phases !== 'object' || Array.isArray(patch.phases)) return 'phases 必须是对象';
      for (const k of Object.keys(patch.phases)) {
        if (schema.PHASE_SET.indexOf(k) === -1) return '未知阶段 ' + String(k).slice(0, 20);
        const v = patch.phases[k];
        if (typeof v !== 'number' || !isFinite(v) || v < 60 || v > 180 * 60) return '阶段 ' + k + ' 时长必须为 60..10800 秒';
      }
    }
    return null;
  }
  function checkUserDataPath(p) {
    if (!isStr(p, 4096)) return false;
    let userData;
    try { userData = path.resolve(app.getPath('userData')); }
    catch (e) { return false; }
    const abs = path.resolve(p);
    // 只允许应用数据目录及其子路径（备份 / 损坏现场 / 日志都在这下面）
    return abs === userData || abs.startsWith(userData + path.sep);
  }
  function checkClearRequest(keys) {
    if (keys === null || keys === undefined) return { scopes: null };          // 旧 UI：清空全部
    if (!Array.isArray(keys) || keys.length === 0) return { scopes: null, empty: true };
    if (keys.some(function (k) { return typeof k !== 'string'; })) return { bad: ['元素必须是字符串'] };
    const r = schema.resolveClearScopes(keys);
    if (r.bad && r.bad.length) return { bad: r.bad };
    return { scopes: r.all ? null : r.keys };
  }

  function appendLog(lines) {
    try {
      fs.mkdirSync(logDir, { recursive: true });
      try {
        const st = fs.statSync(logFile);
        if (st.size > LOG_MAX) {
          fs.renameSync(logFile, logFile + '.1');
        }
      } catch (e) { }
      const safe = lines.slice(0, LOG_BATCH_MAX).map(function (line) {
        return String(line).replace(/\r?\n/g, ' ⏎ ').slice(0, LOG_LINE_MAX);
      });
      fs.appendFileSync(logFile, safe.join('\n') + '\n', 'utf8');
    } catch (e) { /* 日志失败不再抛错 */ }
  }

  function summarize(bundle) {
    return schema.summarize(bundle);
  }

  /* ============================================================
   * 导出授权（R8）：data:reveal 允许应用数据目录内，或用户刚经导出对话框授权的具体文件
   * ============================================================ */
  const authorizedExportPaths = new Set();

  function register() {
    /* ---------------- 存储（同步，渲染端拿到的就是最新值） ---------------- */
    ipcMain.on('store:get', (e, key) => {
      const err = checkKey(key);
      e.returnValue = err ? null : store.get(key);
    });
    ipcMain.on('store:set', (e, key, value) => {
      const err = checkKey(key);
      e.returnValue = err ? { ok: false, error: err } : store.set(key, value);
    });
    ipcMain.on('store:remove', (e, key) => {
      const err = checkKey(key);
      e.returnValue = err ? { ok: false, error: err } : store.remove(key);
    });
    ipcMain.on('store:keys', (e) => { e.returnValue = store.keys(); });
    ipcMain.on('store:export', (e) => { e.returnValue = store.exportAll(); });
    ipcMain.on('store:import', (e, bundle, mode) => {
      if (mode !== undefined && mode !== 'merge' && mode !== 'replace') { e.returnValue = fail('非法导入模式'); return; }
      e.returnValue = store.importAll(bundle, mode);
    });
    ipcMain.on('store:clear', (e, keys) => {
      const req = checkClearRequest(keys);
      if (req.bad) { e.returnValue = fail('清空请求包含非法项'); return; }
      if (req.empty) { e.returnValue = fail('清空列表为空（清空全部请使用 null）'); return; }
      e.returnValue = store.clear(req.scopes === null ? null : req.scopes);
    });
    ipcMain.on('store:backup', (e, tag) => {
      if (tag !== undefined && tag !== null && !isStr(tag, 32)) { e.returnValue = fail('非法备份标签'); return; }
      e.returnValue = store.backup(tag || 'manual');
    });

    /* ---------------- 专注钟 ---------------- */

    /* ---------------- 数据导出 / 导入（文件对话框，用户明确选择的路径） ---------------- */
    ipcMain.handle('data:export-file', async () => {
      const bundle = store.exportAll();
      const d = new Date();
      const p2 = (n) => (n < 10 ? '0' : '') + n;
      const stamp = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes());
      const win = getWin();
      const res = await dialog.showSaveDialog(win || undefined, {
        title: '导出西西弗斯 数据',
        defaultPath: path.join(app.getPath('documents'), 'sisyphus-backup-' + stamp + '.json'),
        filters: [{ name: 'JSON 备份', extensions: ['json'] }]
      });
      if (res.canceled || !res.filePath) return { ok: false, canceled: true };
      try {
        fs.writeFileSync(res.filePath, JSON.stringify(bundle, null, 2), 'utf8');
        // R8：用户经导出对话框授权的具体文件，登记为可 reveal（取消/失败不登记）
        try { authorizedExportPaths.add(path.resolve(res.filePath)); } catch (ee) { }
        log('已导出数据到 ' + res.filePath);
        return { ok: true, path: res.filePath, summary: summarize(bundle) };
      } catch (e) {
        log('导出失败', e);
        return { ok: false, error: (e && e.message) || String(e) };
      }
    });

    ipcMain.handle('data:pick-import-file', async () => {
      const win = getWin();
      const res = await dialog.showOpenDialog(win || undefined, {
        title: '选择西西弗斯 备份文件',
        properties: ['openFile'],
        filters: [{ name: 'JSON 备份', extensions: ['json'] }]
      });
      if (res.canceled || !res.filePaths || !res.filePaths.length) return { ok: false, canceled: true };
      const p = res.filePaths[0];
      let bundle;
      try {
        const st = fs.statSync(p);
        if (st.size > schema.MAX_BUNDLE_BYTES) {
          return fail('备份文件过大（>32MB），疑似损坏', st.size);
        }
        const raw = fs.readFileSync(p, 'utf8');
        bundle = JSON.parse(raw);
      } catch (e) {
        log('备份文件解析失败（仅记录错误类型）', (e && e.name) || 'Error');
        return { ok: false, error: '文件无法解析：' + ((e && e.message) || String(e)).slice(0, 200) };
      }
      // 解析→校验→摘要：不合格的文件在选择阶段就拒绝，不产生任何备份/写入
      const validation = schema.validateBundle(bundle);
      if (!validation.ok) {
        log('备份文件校验失败：' + validation.errors.join(' | ').slice(0, 300));
        return {
          ok: false,
          error: '备份文件校验失败：' + validation.errors.slice(0, 5).join('；').slice(0, 300),
          errors: validation.errors.slice(0, 20)
        };
      }
      return { ok: true, path: p, bundle: bundle, summary: validation.summary, repaired: validation.repaired.slice(0, 20) };
    });

    ipcMain.handle('data:apply-import', async (e, bundle, mode) => {
      if (mode !== undefined && mode !== 'merge' && mode !== 'replace') return fail('非法导入模式');
      // store.importAll 内部完成：校验→摘要→只备份一次→写入→验证
      const r = store.importAll(bundle, mode || 'merge');
      if (r.ok) {
        log('已导入数据 applied=' + r.applied + ' mode=' + (mode || 'merge'));
        timer.init();          // 刷新：重新加载计时状态 / 统计 / 偏好
        reloadAll();           // 刷新：让所有窗口重读数据
      }
      return Object.assign({}, r, { preBackup: r.backup || null });
    });

    ipcMain.handle('data:clear-all', async (e, keys) => {
      const req = checkClearRequest(keys);
      if (req.bad) return fail('清空请求包含未知分区或非法键', req.bad.join(','));
      if (req.empty) return fail('清空列表为空（清空全部请使用 null）');
      const pre = store.backup('pre-clear');     // 清空前备份（只此一次）
      if (!pre.ok) return fail('清空前备份失败，已中止清空', pre.error);
      const r = store.clear(req.scopes);
      if (r.ok) {
        log('已清空数据 removed=' + r.removed + ' scopes=' + (Array.isArray(keys) ? keys.join(',') : 'all'));
        timer.init();
        reloadAll();
      } else {
        log('清空失败已回滚：' + (r.error || ''));
      }
      return Object.assign({}, r, { preBackup: pre.path, scopes: Array.isArray(keys) ? keys : ['all'] });
    });

    ipcMain.handle('data:reveal', async (e, p) => {
      if (p === null || p === undefined || p === '') return { ok: false, error: '参数为空' };
      if (typeof p !== 'string') return fail('路径类型非法');
      // 任意路径限制：只允许 userData 内 或 用户刚授权导出的具体文件（R8）
      const authorized = checkUserDataPath(p) || authorizedExportPaths.has(path.resolve(p));
      if (!authorized) return fail('只允许打开应用数据目录内或刚授权导出的路径');
      try { shell.showItemInFolder(p); return { ok: true, shellInvoked: true }; }
      catch (err) { return { ok: false, error: String(err).slice(0, 200) }; }
    });

    /* ---------------- 计时状态 ---------------- */
    ipcMain.handle('timer:get', () => timer.snapshot());
    ipcMain.handle('timer:task-start', (e, task, opts) => {
      if (!task || typeof task !== 'object' || Array.isArray(task)) return fail('当前任务格式非法');
      if (opts !== undefined && (opts === null || typeof opts !== 'object' || Array.isArray(opts))) return fail('专注选项格式非法');
      const noStart = opts && opts.noStart === true;
      return timer.startTask(task, { noStart: noStart });
    });
    ipcMain.handle('timer:cmd', (e, type, payload) => {
      const err = checkTimerCommand(type, payload);
      if (err) return { ok: false, error: '非法计时命令：' + err, snapshot: timer.snapshot() };
      return timer.command(type, payload);
    });
    ipcMain.handle('timer:prefs-set', (e, patch) => {
      const err = checkPrefsPatch(patch);
      if (err) return { ok: false, error: '非法偏好：' + err, snapshot: timer.snapshot() };
      return timer.setPrefs(patch);
    });
    ipcMain.handle('timer:prefs-get', () => timer.getPrefs());
    ipcMain.handle('timer:history', () => timer.getHistory());

    /* ---------------- 窗口控制 ---------------- */
    ipcMain.on('win:minimize', () => { const w = getWin(); if (w) w.minimize(); });
    ipcMain.on('win:maximize', () => {
      const w = getWin();
      if (!w) return;
      if (w.isMaximized()) w.unmaximize(); else w.maximize();
    });
    ipcMain.on('win:close', () => { const w = getWin(); if (w) w.close(); });
    ipcMain.handle('win:is-maximized', () => { const w = getWin(); return w ? w.isMaximized() : false; });
    ipcMain.on('shell:open-timer-compact', () => createTimerWindow());

    ipcMain.handle('timer:pin-toggle', () => {
      const w = getTimerWin();
      if (!w) return false;
      const next = !w.isAlwaysOnTop();
      w.setAlwaysOnTop(next, 'floating');
      return next;
    });
    ipcMain.handle('timer:pin-get', () => {
      const w = getTimerWin();
      return w ? w.isAlwaysOnTop() : true;
    });
    ipcMain.on('timer:close', () => { const w = getTimerWin(); if (w) w.close(); });

    /* ---------------- 通知（主进程发，窗口隐藏也能到） ---------------- */
    ipcMain.handle('notify:show', (e, title, body) => {
      if (!isStr(title, 200) || !isStr(body, 1000)) return fail('通知内容超长或类型非法');
      try {
        if (!Notification.isSupported()) return { ok: false };
        new Notification({ title: title || '西西弗斯', body: body, silent: true }).show();
        return { ok: true };
      } catch (err) { log('通知失败', err); return { ok: false, error: '通知失败' }; }
    });

    /* ---------------- 日志 ---------------- */
    ipcMain.on('log:report', (e, entries) => {
      if (!Array.isArray(entries)) return;
      appendLog(entries.filter(function (it) { return it && typeof it === 'object'; })
        .map(function (it) {
          const t = isStr(it.t, 40) ? it.t : '';
          const level = ['debug', 'info', 'warn', 'error'].indexOf(it.level) === -1 ? 'info' : it.level;
          const text = isStr(it.text, LOG_LINE_MAX) ? it.text : String(it.text || '').slice(0, LOG_LINE_MAX);
          return '[' + t + '] ' + level.toUpperCase() + ' ' + text;
        }));
    });
    ipcMain.handle('log:reveal', () => { try { shell.showItemInFolder(logFile); return { ok: true }; } catch (e2) { return { ok: false }; } });

    /* ---------------- 应用信息 ---------------- */
    ipcMain.handle('app:info', () => ({
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      packaged: app.isPackaged,
      userData: app.getPath('userData'),
      storeFile: store.file,
      backupDir: store.backupDir,
      logFile: logFile,
      storeKeys: store.keys(),
      recovery: store.listRecovery(),
      migrations: store.getMigrationLog(),
      timer: timer.snapshot()
    }));
  }

  return {
    register, summarize, appendLog, logFile,
    authorizedExportCount() { return authorizedExportPaths.size; },
    /* 暴露校验器给回归测试（不改变运行时行为） */
    _checks: { checkKey, checkTimerCommand, checkPrefsPatch, checkUserDataPath, checkClearRequest }
  };
}

module.exports = { createIpc };
