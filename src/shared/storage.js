/* ============================================================
 * src/shared/storage.js · 渲染端统一存储适配
 * ------------------------------------------------------------
 * 桌面版唯一数据写者是主进程（userData/sisy-store.json），所有键经
 * preload 暴露的 window.dshStore（同步 IPC）访问；这里只做转发与
 * 保存失败提示。
 * ============================================================ */
(function (global) {
  'use strict';
  var NS = global.DSH || (global.DSH = {});
  if (NS.store) return;

  var log = NS.log;
  var SCHEMA = 2;

  var backend = null;
  var saveErrorHandlers = [];
  var lastErrorAt = 0;

  /* ---------- 后端：主进程（唯一） ---------- */
  function ipcBackend(bridge) {
    return {
      kind: 'ipc',
      get: function (key) { return bridge.get(key); },
      set: function (key, value) { return bridge.set(key, value); },
      remove: function (key) { return bridge.remove(key); },
      keys: function () { return bridge.keys() || []; },
      exportAll: function () { return bridge.exportAll(); },
      importAll: function (bundle, mode) { return bridge.importAll(bundle, mode); },
      clear: function (keys) { return bridge.clear(keys); },
      backup: function (tag) { return bridge.backup(tag); }
    };
  }

  function notifySaveError(key, error) {
    var now = Date.now();
    if (log) log.error('保存失败 ' + key, error);
    if (now - lastErrorAt < 4000) return;   // 去抖：4 秒内只提示一次
    lastErrorAt = now;
    saveErrorHandlers.forEach(function (cb) {
      try { cb(key, error); } catch (e) { if (log) log.error('保存失败回调异常', e); }
    });
  }

  var api = {
    SCHEMA: SCHEMA,
    get backendKind() { return backend ? backend.kind : 'none'; },

    init: function () {
      if (backend) return api;
      if (!global.dshStore || typeof global.dshStore.get !== 'function') {
        if (log) log.error('主进程存储不可用：桌面版必须在 Electron 中运行');
        return api;
      }
      backend = ipcBackend(global.dshStore);
      if (log) log.info('存储后端:', backend.kind);
      return api;
    },

    get: function (key, fallback) {
      if (!backend) api.init();
      if (!backend) return fallback === undefined ? null : fallback;
      var v;
      try { v = backend.get(key); }
      catch (e) { if (log) log.error('读取失败 ' + key, e); return fallback === undefined ? null : fallback; }
      if (v === null || v === undefined) return fallback === undefined ? null : fallback;
      return v;
    },

    set: function (key, value) {
      if (!backend) api.init();
      if (!backend) return { ok: false, error: '存储不可用' };
      var r;
      try { r = backend.set(key, value); }
      catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
      if (!r || !r.ok) { notifySaveError(key, r && r.error); return { ok: false, error: r && r.error }; }
      return { ok: true };
    },

    remove: function (key) {
      if (!backend) api.init();
      if (!backend) return { ok: false };
      try { return backend.remove(key); } catch (e) { if (log) log.error('删除失败 ' + key, e); return { ok: false }; }
    },

    keys: function () {
      if (!backend) api.init();
      if (!backend) return [];
      try { return backend.keys() || []; } catch (e) { if (log) log.error('枚举键失败', e); return []; }
    },

    /** 导出完整备份包 */
    exportAll: function () {
      if (!backend) api.init();
      if (!backend) return null;
      var bundle;
      try { bundle = backend.exportAll(); }
      catch (e) { if (log) log.error('导出失败', e); return null; }
      if (!bundle) return null;
      bundle.schema = SCHEMA;
      bundle.app = 'sisyphus';
      bundle.exportedAt = new Date().toISOString();
      bundle.backend = backend.kind;
      return bundle;
    },

    /** 导入备份包；mode: 'merge'(默认) | 'replace' */
    importAll: function (bundle, mode) {
      if (!backend) api.init();
      if (!backend) return { ok: false, error: '存储不可用' };
      try { return backend.importAll(bundle, mode || 'merge'); }
      catch (e) { if (log) log.error('导入失败', e); return { ok: false, error: (e && e.message) || String(e) }; }
    },

    clear: function (keys) {
      if (!backend) api.init();
      if (!backend) return { ok: false };
      try { return backend.clear(keys); } catch (e) { if (log) log.error('清空失败', e); return { ok: false }; }
    },

    backup: function (tag) {
      if (!backend) api.init();
      if (!backend) return { ok: false, error: '存储不可用' };
      if (typeof backend.backup !== 'function') return { ok: false, error: '当前后端不支持备份' };
      try { return backend.backup(tag); } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
    },

    onSaveError: function (cb) { if (typeof cb === 'function') saveErrorHandlers.push(cb); }
  };

  NS.store = api;
})(typeof window !== 'undefined' ? window : globalThis);