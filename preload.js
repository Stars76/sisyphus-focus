// 预加载脚本：向渲染层暴露最小化的、按用途分组的 API
//   dshWindow 窗口控制 / dshStore 同步存储 / dshTimer 计时状态
//   dshData 导出导入 / dshLog 日志 / dshApp 应用信息
const { contextBridge, ipcRenderer } = require('electron');

/* ---------------- 窗口控制 ---------------- */
contextBridge.exposeInMainWorld('dshWindow', {
  minimize: () => ipcRenderer.send('win:minimize'),
  toggleMaximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  isMaximized: () => ipcRenderer.invoke('win:is-maximized'),
  onState: (cb) => ipcRenderer.on('win:state', (_e, state) => cb(state)),
  openTimerCompact: () => ipcRenderer.send('shell:open-timer-compact')
});

/* ---------------- 同步存储（主进程是唯一写者） ---------------- */
contextBridge.exposeInMainWorld('dshStore', {
  get: (key) => ipcRenderer.sendSync('store:get', key),
  set: (key, value) => ipcRenderer.sendSync('store:set', key, value),
  remove: (key) => ipcRenderer.sendSync('store:remove', key),
  keys: () => ipcRenderer.sendSync('store:keys'),
  exportAll: () => ipcRenderer.sendSync('store:export'),
  importAll: (bundle, mode) => ipcRenderer.sendSync('store:import', bundle, mode),
  clear: (keys) => ipcRenderer.sendSync('store:clear', keys),
  backup: (tag) => ipcRenderer.sendSync('store:backup', tag)
});

/* ---------------- 专注钟：订阅 + 发命令 ---------------- */
contextBridge.exposeInMainWorld('dshTimer', {
  getState: () => ipcRenderer.invoke('timer:get'),
  cmd: (type, payload) => ipcRenderer.invoke('timer:cmd', type, payload),
  getPrefs: () => ipcRenderer.invoke('timer:prefs-get'),
  setPrefs: (patch) => ipcRenderer.invoke('timer:prefs-set', patch),
  history: () => ipcRenderer.invoke('timer:history'),
  onState: (cb) => ipcRenderer.on('timer:state', (_e, snap) => cb(snap)),
  onEvent: (cb) => ipcRenderer.on('timer:event', (_e, ev) => cb(ev)),
  togglePin: () => ipcRenderer.invoke('timer:pin-toggle'),
  getPin: () => ipcRenderer.invoke('timer:pin-get'),
  close: () => ipcRenderer.send('timer:close'),
  setTray: (on) => ipcRenderer.invoke('tray:set', on),
  notify: (title, body) => ipcRenderer.invoke('notify:show', title, body),
  startTask: (task, opts) => ipcRenderer.invoke('timer:task-start', task, opts)
});

/* ---------------- 数据导出 / 导入 ---------------- */
contextBridge.exposeInMainWorld('dshData', {
  exportFile: () => ipcRenderer.invoke('data:export-file'),
  pickImportFile: () => ipcRenderer.invoke('data:pick-import-file'),
  applyImport: (bundle, mode) => ipcRenderer.invoke('data:apply-import', bundle, mode),
  clearAll: (keys) => ipcRenderer.invoke('data:clear-all', keys),
  reveal: (p) => ipcRenderer.invoke('data:reveal', p),
  renderNote: (kind, payload) => ipcRenderer.invoke('data:render-note', kind, payload),
  copyNote: (kind, payload) => ipcRenderer.invoke('data:copy-note', kind, payload),
  saveNote: (kind, payload) => ipcRenderer.invoke('data:save-note', kind, payload)
});

/* ---------------- 日志 ---------------- */
contextBridge.exposeInMainWorld('dshLog', {
  report: (entries) => ipcRenderer.send('log:report', entries),
  reveal: () => ipcRenderer.invoke('log:reveal')
});

/* ---------------- 应用信息 ---------------- */
contextBridge.exposeInMainWorld('dshApp', {
  info: () => ipcRenderer.invoke('app:info')
});
