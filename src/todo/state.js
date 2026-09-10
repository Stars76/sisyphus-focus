/* ============================================================
 * src/todo/state.js · 今日事数据层
 * ------------------------------------------------------------
 * 职责：加载（主进程已迁移+校验过的数据）、每日任务实体化、
 * 增删改、持久化。不含任何 DOM 操作。
 *
 * 数据结构（sisy-focus-state-v2）：
 *   { viewDay: "2026-09-08", days: { "2026-09-08": { tasks: [...], dismissedDaily: {} } } }
 * 数据修复/迁移统一在主进程（src/main/schema.js + migrations.js），
 * 渲染层不做第二遍。
 * ============================================================ */
(function (global) {
  'use strict';
  var NS = global.DSH || (global.DSH = {});
  NS.todo = NS.todo || {};
  if (NS.todo.createState) return;

  var STATE_KEY = 'sisy-focus-state-v2';
  var DAILY_KEY = 'sisy-daily-config';

  function createState(deps) {
    var store = deps.store;
    var date = deps.date;
    var log = deps.log;

    var state = null;

    function uid(prefix) {
      return (prefix || 't') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    /* ---------------- 加载 ---------------- */
    function load() {
      var raw = store.get(STATE_KEY, null);
      var days = {};
      if (raw && typeof raw === 'object' && raw.days && typeof raw.days === 'object') {
        Object.keys(raw.days).forEach(function (k) {
          if (date.isValidKey(k)) days[k] = raw.days[k];
        });
      }
      var viewDay = (raw && typeof raw.viewDay === 'string' && date.isValidKey(raw.viewDay))
        ? raw.viewDay : date.todayKey();
      if (!days[viewDay]) days[viewDay] = { tasks: [], dismissedDaily: {} };
      state = { viewDay: viewDay, days: days };
      return state;
    }

    function persist() {
      var r = store.set(STATE_KEY, state);
      if (!r.ok) { log.error('保存今日事失败', r.error); return false; }
      return true;
    }

    /* ---------------- 每日任务 ---------------- */
    function dailyConfig() {
      var c = store.get(DAILY_KEY, null);
      if (c && Array.isArray(c.tasks)) {
        c.tasks = c.tasks.map(function (t) {
          if (!t || typeof t !== 'object') return null;
          return { id: (typeof t.id === 'string' && t.id) ? t.id : uid('d'), title: String(t.title == null ? '' : t.title) };
        }).filter(function (t) { return t && t.title; });
        return c;
      }
      return { tasks: [] };
    }

    function saveDailyConfig(cfg) {
      var r = store.set(DAILY_KEY, cfg);
      if (!r.ok) log.error('保存每日任务配置失败', r.error);
      return r.ok;
    }

    function day(key) {
      if (!state.days[key]) state.days[key] = { tasks: [], dismissedDaily: {} };
      return state.days[key];
    }

    /** 每日任务实体化：每天首次进入写入当天列表（带 dailyId 防重复） */
    function syncDaily() {
      var cfg = dailyConfig();
      if (!cfg.tasks.length) return false;
      var dd = day(date.todayKey());
      var had = {};
      dd.tasks.forEach(function (t) { if (t.dailyId) had[t.dailyId] = true; });
      var added = false;
      cfg.tasks.forEach(function (dt) {
        if (had[dt.id] || dd.dismissedDaily[dt.id]) return;
        dd.tasks.push({ id: uid(), dailyId: dt.id, title: dt.title, subtasks: [], done: false, createdAt: new Date().toISOString() });
        added = true;
      });
      if (added) persist();
      return added;
    }

    /* ---------------- 查询 ---------------- */
    function findTask(id) {
      var tasks = day(state.viewDay).tasks;
      for (var i = 0; i < tasks.length; i++) if (tasks[i].id === id) return tasks[i];
      return null;
    }

    function findSub(task, sid) {
      if (!task || !task.subtasks) return null;
      for (var i = 0; i < task.subtasks.length; i++) if (task.subtasks[i].id === sid) return task.subtasks[i];
      return null;
    }

    function isToday() { return state.viewDay === date.todayKey(); }

    /* ---------------- 变更 ---------------- */
    var api = {
      STATE_KEY: STATE_KEY,
      DAILY_KEY: DAILY_KEY,

      init: function () {
        load();
        syncDaily();
        return api;
      },

      get state() { return state; },
      get viewDay() { return state.viewDay; },
      get days() { return state.days; },
      day: day,
      isToday: isToday,
      tasks: function () { return day(state.viewDay).tasks; },
      hasTasks: function (key) { return !!(state.days[key] && state.days[key].tasks && state.days[key].tasks.length); },

      setViewDay: function (key) {
        var nk = date.normalizeKey(key);
        if (!nk) return;
        if (state.viewDay === nk) return;
        state.viewDay = nk;
        day(nk);
        persist();
      },
      shiftView: function (delta) { api.setViewDay(date.shiftDay(state.viewDay, delta)); },
      goToday: function () { api.setViewDay(date.todayKey()); syncDaily(); },

      persist: persist,
      syncDaily: syncDaily,
      findTask: findTask,
      findSub: findSub,

      addTask: function (title) {
        var v = String(title || '').trim();
        if (!v) return null;
        var t = { id: uid(), title: v, subtasks: [], done: false, createdAt: new Date().toISOString() };
        day(state.viewDay).tasks.unshift(t);
        persist();
        return t;
      },
      setTaskTitle: function (id, title) {
        var t = findTask(id); if (!t) return false;
        var v = String(title || '').trim();
        if (!v) return false;
        t.title = v; persist(); return true;
      },
      /* 闹钟：合法 "HH:MM" 设置；空/null 清除 */
      setTaskAlarm: function (id, hhmm) {
        var t = findTask(id); if (!t) return false;
        var v = String(hhmm == null ? '' : hhmm).trim();
        var re = /^([01]\d|2[0-3]):[0-5]\d$/;
        if (v) {
          if (!re.test(v)) return false;
          t.alarm = v;
        } else if (t.alarm !== undefined) {
          delete t.alarm;
        }
        persist(); return true;
      },
      toggleTask: function (id) {
        var t = findTask(id); if (!t) return false;
        t.done = !t.done; persist(); return t.done;
      },
      deleteTask: function (id) {
        var dd = day(state.viewDay);
        var t = findTask(id); if (!t) return false;
        if (t.dailyId) dd.dismissedDaily[t.dailyId] = true;   // 当天删除后不再补回
        dd.tasks = dd.tasks.filter(function (x) { return x.id !== id; });
        persist(); return true;
      },
      /** 撤销删除：把任务原样插回原位置（撤销时不再补 dismissedDaily 标记） */
      restoreTask: function (task, index) {
        var dd = day(state.viewDay);
        if (task && task.dailyId) delete dd.dismissedDaily[task.dailyId];
        var at = (typeof index === 'number' && index >= 0 && index <= dd.tasks.length) ? index : dd.tasks.length;
        dd.tasks.splice(at, 0, task);
        persist(); return true;
      },
      moveTask: function (id, targetId, after) {
        if (!api.isToday() || id === targetId) return false;
        var dd = day(state.viewDay), from = dd.tasks.findIndex(function (x) { return x.id === id; });
        if (from < 0 || (targetId !== null && !dd.tasks.some(function (x) { return x.id === targetId; }))) return false;
        var item = dd.tasks.splice(from, 1)[0];
        var to = targetId === null ? dd.tasks.length : dd.tasks.findIndex(function (x) { return x.id === targetId; }) + (after ? 1 : 0);
        dd.tasks.splice(to, 0, item); persist(); return true;
      },

      addSubtask: function (taskId) {
        var t = findTask(taskId); if (!t) return null;
        t.subtasks = t.subtasks || [];
        var s = { id: uid('s'), title: '', minutes: 5, done: false };
        t.subtasks.push(s);
        t.done = false;
        persist();
        return s;
      },
      setSubTitle: function (taskId, sid, title) {
        var s = findSub(findTask(taskId), sid); if (!s) return false;
        var v = String(title || '').trim();
        if (!v) return false;
        s.title = v; persist(); return true;
      },
      setSubMinutes: function (taskId, sid, minutes) {
        var s = findSub(findTask(taskId), sid); if (!s) return false;
        var n = Math.round(+minutes);
        if (!(n >= 1 && n <= 180)) return false;
        s.minutes = n; persist(); return true;
      },
      toggleSubtask: function (taskId, sid) {
        var t = findTask(taskId); if (!t) return false;
        var s = findSub(t, sid); if (!s) return false;
        s.done = !s.done;
        var allDone = t.subtasks.length > 0 && t.subtasks.every(function (x) { return x.done; });
        var justCompleted = false;
        if (allDone && !t.done) { t.done = true; justCompleted = true; }
        else if (!allDone) { t.done = false; }
        persist();
        return { justCompleted: justCompleted, allDone: allDone };
      },
      deleteSubtask: function (taskId, sid) {
        var t = findTask(taskId); if (!t || !t.subtasks) return false;
        t.subtasks = t.subtasks.filter(function (s) { return s.id !== sid; });
        if (t.subtasks.length) t.done = t.subtasks.every(function (s) { return s.done; });
        persist();
        return true;
      },

      /* ---------------- 每日任务配置 ---------------- */
      dailyConfig: dailyConfig,
      addDaily: function (title) {
        var v = String(title || '').trim();
        if (!v) return null;
        var cfg = dailyConfig();
        var t = { id: uid('d'), title: v };
        cfg.tasks.push(t);
        saveDailyConfig(cfg);
        syncDaily();
        return t;
      },
      renameDaily: function (id, title) {
        var v = String(title || '').trim();
        if (!v) return false;
        var cfg = dailyConfig();
        var target = null;
        cfg.tasks.forEach(function (t) { if (t.id === id) target = t; });
        if (!target) return false;
        var old = target.title;
        target.title = v;
        saveDailyConfig(cfg);
        // 同步今天已实体化的同名任务（只在没被手动改名时）
        var dd = day(date.todayKey());
        var touched = false;
        dd.tasks.forEach(function (x) {
          if (x.dailyId === id && x.title === old) { x.title = v; touched = true; }
        });
        if (touched) persist();
        return true;
      },
      removeDaily: function (id) {
        var cfg = dailyConfig();
        var before = cfg.tasks.length;
        cfg.tasks = cfg.tasks.filter(function (t) { return t.id !== id; });
        if (cfg.tasks.length === before) return false;
        saveDailyConfig(cfg);
        syncDaily();
        return true;
      },

      /** 跨天：生成新一天每日任务；若正看着「今天」则跟随 */
      handleDayRollover: function (prevDay) {
        var today = date.todayKey();
        if (today === prevDay) return false;
        syncDaily();
        if (state.viewDay === prevDay) state.viewDay = today;
        persist();
        return true;
      },

      /** 统计：今天已完成 / 总数 */
      todayStats: function () {
        var tasks = day(date.todayKey()).tasks;
        var total = 0, done = 0, subDone = 0, subTotal = 0;
        tasks.forEach(function (t) {
          total++;
          if (t.done) done++;
          (t.subtasks || []).forEach(function (s) { subTotal++; if (s.done) subDone++; });
        });
        return { total: total, done: done, subTotal: subTotal, subDone: subDone };
      },
      dayStats: function (key) {
        var dd = state.days[date.normalizeKey(key)];
        if (!dd) return { total: 0, done: 0 };
        return { total: dd.tasks.length, done: dd.tasks.filter(function (t) { return t.done; }).length };
      },
      records: function () { return JSON.parse(JSON.stringify(state.days)); }
    };

    return api;
  }

  NS.todo.createState = createState;
})(typeof window !== 'undefined' ? window : globalThis);