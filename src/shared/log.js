/* ============================================================
 * src/shared/log.js · 统一日志（替代空 catch）
 * ------------------------------------------------------------
 * 用法：
 *   DSH.log.warn("保存失败", err)
 *   DSH.log.error("初始化失败", err)
 *   DSH.log.dump()          -> 最近的日志文本（用于「复制诊断信息」）
 *
 * 特性：
 *   - 始终写 console（dev），并保留 200 条环形缓冲
 *   - 存在主进程日志桥（window.dshLog）时，批量转发到
 *     userData/logs/sisy.log（带大小上限滚动）
 *   - 自动挂 window.onerror / unhandledrejection
 * ============================================================ */
(function (global) {
  'use strict';
  var NS = global.DSH || (global.DSH = {});
  if (NS.log) return;

  var PREFIX = '[西西弗斯]';
  var MAX_RING = 200;
  var FLUSH_MS = 2000;

  var ring = [];
  var pending = [];
  var flushTimer = null;
  var bridge = null;

  try { bridge = (global.dshLog && typeof global.dshLog.report === 'function') ? global.dshLog : null; } catch (e) { bridge = null; }

  function stringify(v) {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (v instanceof Error) return (v.name || 'Error') + ': ' + (v.message || '') + (v.stack ? '\n' + v.stack : '');
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }

  function format(args) {
    var parts = [];
    for (var i = 0; i < args.length; i++) parts.push(stringify(args[i]));
    return parts.join(' ');
  }

  function stamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' +
      ('00' + d.getMilliseconds()).slice(-3);
  }

  function flush() {
    flushTimer = null;
    if (!bridge || !pending.length) return;
    var batch = pending;
    pending = [];
    try { bridge.report(batch); } catch (e) { /* 日志桥失败不能再抛错 */ }
  }

  function push(level, args) {
    var text = format(args);
    var entry = { t: stamp(), level: level, text: text };
    ring.push(entry);
    if (ring.length > MAX_RING) ring.shift();

    var fn = (level === 'error') ? 'error' : (level === 'warn' ? 'warn' : 'log');
    try { (console[fn] || console.log).call(console, PREFIX, level.toUpperCase(), text); } catch (e) { }

    if (bridge) {
      pending.push(entry);
      if (!flushTimer) {
        try { flushTimer = setTimeout(flush, FLUSH_MS); } catch (e) { flushTimer = null; }
      }
    }
    return entry;
  }

  var api = {
    PREFIX: PREFIX,
    debug: function () { return push('debug', arguments); },
    info: function () { return push('info', arguments); },
    warn: function () { return push('warn', arguments); },
    error: function () { return push('error', arguments); },
    entries: function () { return ring.slice(); },
    dump: function () {
      return ring.map(function (e) { return '[' + e.t + '] ' + e.level.toUpperCase() + ' ' + e.text; }).join('\n');
    },
    clear: function () { ring.length = 0; pending.length = 0; }
  };

  NS.log = api;

  /* ---------- 全局兜底：未捕获异常也要留痕 ---------- */
  try {
    global.addEventListener('error', function (ev) {
      if (ev && ev.message) api.error('未捕获错误:', ev.message, ev.filename ? ('@' + ev.filename + ':' + ev.lineno) : '');
    });
    global.addEventListener('unhandledrejection', function (ev) {
      api.error('未处理的 Promise 拒绝:', ev && ev.reason ? ev.reason : '(unknown)');
    });
  } catch (e) { }
})(typeof window !== 'undefined' ? window : globalThis);
