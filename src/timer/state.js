/* ============================================================
 * src/timer/state.js · 渲染端计时状态（主进程状态的只读镜像 + 命令通道）
 * ------------------------------------------------------------
 * 唯一计时状态在主进程；这里只订阅广播、发命令，并做本地插值
 * 供每帧平滑显示。桌面版不提供浏览器回退。
 *
 * 对外 API：
 *   DSH.timer.state.init()             -> Promise<snapshot>
 *   DSH.timer.state.snapshot()         -> 最近一次快照
 *   DSH.timer.state.remainMs()         -> 插值后的剩余毫秒（用于每帧平滑显示）
 *   DSH.timer.state.cmd(type, payload)
 *   DSH.timer.state.setPrefs(patch)
 *   DSH.timer.state.onUpdate(cb) / onEvent(cb)
 * ============================================================ */
(function (global) {
  'use strict';
  var NS = global.DSH || (global.DSH = {});
  NS.timer = NS.timer || {};
  if (NS.timer.state) return;

  var log = NS.log;
  var bridge = (global.dshTimer && typeof global.dshTimer.getState === 'function') ? global.dshTimer : null;

  var snap = null;
  var updateHandlers = [];
  var eventHandlers = [];

  function emitUpdate() {
    updateHandlers.forEach(function (cb) { try { cb(snap); } catch (e) { if (log) log.error('状态回调异常', e); } });
  }
  function emitEvent(ev) {
    eventHandlers.forEach(function (cb) { try { cb(ev); } catch (e) { if (log) log.error('事件回调异常', e); } });
  }

  var api = {
    get kind() { return 'ipc'; },

    snapshot: function () { return snap; },

    init: function () {
      if (!bridge) {
        if (log) log.error('无法连接计时器（桌面版缺少 dshTimer 桥）');
        return Promise.resolve(null);
      }
      bridge.onState(function (s) {
        // 轻量 tick：只带 timer 子集，合并进本地快照，避免每秒全量重发
        if (s && s.tick === true && snap) {
          Object.keys(s.timer).forEach(function (k) { snap.timer[k] = s.timer[k]; });
          snap.revision = s.revision;
          snap.serverNow = Date.now();
        } else {
          snap = s;
        }
        emitUpdate();
      });
      bridge.onEvent(function (ev) { emitEvent(ev); });
      return bridge.getState().then(function (s) {
        snap = s; emitUpdate(); return s;
      });
    },

    cmd: function (type, payload) {
      if (bridge) return bridge.cmd(type, payload);
      return snap;
    },

    setPrefs: function (patch) {
      if (bridge) return bridge.setPrefs(patch);
      return snap;
    },

    setTray: function (on) {
      if (bridge && bridge.setTray) return bridge.setTray(on);
      return snap;
    },

    notify: function (title, body) {
      if (bridge && bridge.notify) return bridge.notify(title, body);
    },

    /** 平滑剩余毫秒：用快照的 serverNow 做本地插值 */
    remainMs: function () {
      if (!snap) return 0;
      var t = snap.timer;
      if (!t.running) return t.leftMs;
      var drift = Date.now() - (snap.serverNow || Date.now());
      return Math.max(0, t.leftMs - drift);
    },

    onUpdate: function (cb) { if (typeof cb === 'function') updateHandlers.push(cb); },
    onEvent: function (cb) { if (typeof cb === 'function') eventHandlers.push(cb); }
  };

  NS.timer.state = api;
})(typeof window !== 'undefined' ? window : globalThis);