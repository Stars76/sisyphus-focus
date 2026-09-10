/* ============================================================
 * src/main/schema.js · 数据结构定义与校验（主进程权威层）
 * ------------------------------------------------------------
 * 职责：
 *   1) 声明所有已知存储键的结构（键名、必需字段、取值范围）
 *   2) 校验 IPC / 导入数据：区分「硬错误（拒绝写入）」与「可修复（纠正后记录）」
 *   3) 给导入摘要（天数 / 任务数 / 统计 …），供 UI 与日志使用
 *
 * 设计原则：
 *   - 未知但合法的 sisy-* 键一律放行（向后兼容旧版导出）
 *   - 容器类型错误 / 必需字段缺失 = 硬错误，导入必须整体失败
 *   - 叶子字段类型不对（title 是数字等）= 可修复，按规则纠正
 *   - 校验不抛异常，全部以 {ok, errors, repaired, value|data} 返回
 * ============================================================ */
'use strict';

const util = require('./util');

const SCHEMA = 2;               // 存储文件外层版本（envelope.schema）
const KEY_PREFIX = 'sisy-';
const MAX_KEY_LEN = 128;
const MAX_VALUE_BYTES = 5 * 1024 * 1024;   // 单值 5MB 上限（防内存炸弹）
const MAX_BUNDLE_BYTES = 32 * 1024 * 1024; // 导入文件 32MB 上限

/* 合法存储键：sisy- 前缀 + 字母数字/._-（含 __corrupt_ 恢复键） */
const KEY_RE = /^sisy-[A-Za-z0-9][A-Za-z0-9._-]*$/;

const PHASE_SET = ['focus', 'short', 'long'];
const HISTORY_MAX = 300;
const ALARM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;   // 任务闹钟时刻 HH:MM

/** 多轮专注计划（番茄法）预设键；定义与展开见 src/main/timer.js */
const PLAN_KEYS = ['classic', 'deep', 'sprint', 'marathon'];

const K = {
  STATE_V2: 'sisy-focus-state-v2',
  STATE_V1: 'sisy-focus-state',
  DAILY: 'sisy-daily-config',
  TIMER_STATE: 'sisy-timer-state',
  TIMER_RUN: 'sisy-timer-run',
  TIMER_STATS: 'sisy-timer-stats',
  TIMER_PREFS: 'sisy-timer-prefs',
  TIMER_HISTORY: 'sisy-timer-history',
  TODO_VIEW: 'sisy-todo-view'
};

/* 「清空数据」分区 → 存储键映射（文档 docs/data.md 有各自的影响说明） */
const CLEAR_SCOPES = {
  tasks: [K.STATE_V2, K.STATE_V1],                 // 今日事任务（含历史各日）
  daily: [K.DAILY],                                // 每日任务模板
  stats: [K.TIMER_STATS],                          // 专注统计（轮次/分钟）
  history: [K.TIMER_HISTORY],                      // 专注历史明细
  prefs: [K.TIMER_PREFS, K.TODO_VIEW],              // 计时与任务视图偏好
  timerState: [K.TIMER_STATE, K.TIMER_RUN]         // 正在进行的计时（不重置统计）
};

function isValidStoreKey(k) {
  return typeof k === 'string' && k.length <= MAX_KEY_LEN && k.length > KEY_PREFIX.length &&
    KEY_PREFIX === k.slice(0, KEY_PREFIX.length) && KEY_RE.test(k);
}

function isCorruptKey(k) { return typeof k === 'string' && k.indexOf('__corrupt_') !== -1; }

function clampInt(v, lo, hi, fb) {
  const n = (typeof v === 'number' && isFinite(v)) ? v : NaN;
  if (isNaN(n)) return fb;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

/* ------------------------------------------------------------
 * 各键的校验器：返回 {value, repaired[]} 或 push 到 errors
 * 约定：ctx = {errors: [], repaired: []}，label 用于定位
 * ------------------------------------------------------------ */
function checkTask(t, label, ctx) {
  if (!isPlainObject(t)) { ctx.errors.push(label + '：任务必须是对象'); return null; }
  const out = {};
  if (typeof t.id === 'string' && t.id) out.id = t.id;
  else { out.id = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); ctx.repaired.push(label + '：任务缺 id，已补'); }
  if (typeof t.title === 'string') out.title = t.title;
  else if (t.title == null) { out.title = ''; ctx.repaired.push(label + '：任务缺 title，按空处理'); }
  else { out.title = String(t.title); ctx.repaired.push(label + '：任务 title 非字符串，已转'); }
  out.done = !!t.done;
  if (!Array.isArray(t.subtasks)) {
    if (t.subtasks != null) ctx.repaired.push(label + '：subtasks 非数组，已置空');
    out.subtasks = [];
  } else {
    out.subtasks = [];
    t.subtasks.forEach(function (s, i) {
      const sl = label + '.subtasks[' + i + ']';
      if (!isPlainObject(s)) { ctx.errors.push(sl + '：小步骤必须是对象'); return; }
      const sub = {};
      if (typeof s.id === 'string' && s.id) sub.id = s.id;
      else { sub.id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); ctx.repaired.push(sl + '：缺 id，已补'); }
      sub.title = (typeof s.title === 'string') ? s.title : String(s.title == null ? '' : s.title);
      if (typeof s.title !== 'string') ctx.repaired.push(sl + '：title 非字符串，已转');
      sub.minutes = clampInt(s.minutes, 1, 180, 5);
      sub.done = !!s.done;
      out.subtasks.push(sub);
    });
  }
  if (typeof t.dailyId === 'string' && t.dailyId) out.dailyId = t.dailyId;
  if (typeof t.createdAt === 'string') out.createdAt = t.createdAt;
  // 闹钟：合法 HH:MM 保留；缺失/非法一律丢弃（可修复，不终止任务）
  if (t.alarm != null) {
    if (typeof t.alarm === 'string' && ALARM_RE.test(t.alarm)) out.alarm = t.alarm;
    else ctx.repaired.push(label + '：alarm 非 HH:MM，已丢弃');
  }
  if (!out.title && !out.subtasks.length) {
    ctx.errors.push(label + '：任务既无标题也无小步骤');
    return null;
  }
  return out;
}

function validateFocusState(value, ctx, label) {
  label = label || K.STATE_V2;
  if (!isPlainObject(value)) { ctx.errors.push(label + '：必须是对象'); return null; }
  let days = value.days;
  let migrated = false;
  // 旧版扁平结构（{tasks:[...]}）视为可修复的待迁移形态
  if (!isPlainObject(days) && Array.isArray(value.tasks)) {
    const day = util.todayKey();
    days = {}; days[day] = { tasks: value.tasks, dismissedDaily: {} };
    ctx.repaired.push(label + '：旧版扁平结构已迁移到 ' + day);
    migrated = true;
  }
  if (!isPlainObject(days)) { ctx.errors.push(label + '：缺少 days 对象（必需字段）'); return null; }
  const out = { days: {} };
  Object.keys(days).forEach(function (k) {
    let nk = util.normalizeKey(k);
    if (!nk) { ctx.errors.push(label + '.days[' + k + ']：日期键非法'); return; }
    if (nk !== k) ctx.repaired.push(label + '：日期键 ' + k + ' 已补零为 ' + nk);
    const dd = days[k];
    const dl = label + '.days[' + nk + ']';
    let obj = dd;
    if (dd == null) { obj = {}; ctx.repaired.push(dl + '：缺失，按空天处理'); }
    else if (!isPlainObject(dd)) { ctx.errors.push(dl + '：必须是对象'); return; }
    const dayOut = { tasks: [], dismissedDaily: {} };
    if (!Array.isArray(obj.tasks)) {
      // 缺省（undefined/null）→ 可修复为空列表；错误嵌套类型 → 硬错误（修复=清空用户内容，拒绝）
      if (obj.tasks === undefined || obj.tasks === null) ctx.repaired.push(dl + '：tasks 缺省，按空列表');
      else ctx.errors.push(dl + '：tasks 必须是数组');
    } else {
      const seen = {};
      obj.tasks.forEach(function (t, i) {
        const fixed = checkTask(t, dl + '.tasks[' + i + ']', ctx);
        if (!fixed) return;
        if (seen[fixed.id]) { fixed.id = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); ctx.repaired.push(dl + '：重复任务 id 已重编号'); }
        seen[fixed.id] = true;
        dayOut.tasks.push(fixed);
      });
    }
    if (isPlainObject(obj.dismissedDaily)) {
      Object.keys(obj.dismissedDaily).forEach(function (d) { if (obj.dismissedDaily[d]) dayOut.dismissedDaily[d] = true; });
    } else if (obj.dismissedDaily === undefined || obj.dismissedDaily === null) {
      ctx.repaired.push(dl + '：dismissedDaily 缺省，按空处理');
    } else {
      ctx.errors.push(dl + '：dismissedDaily 必须是对象');
    }
    if (out.days[nk]) {
      // 补零后冲突：合并
      const target = out.days[nk];
      const ids = {};
      target.tasks.forEach(function (t) { ids[t.id] = true; });
      dayOut.tasks.forEach(function (t) { if (!ids[t.id]) target.tasks.push(t); });
      Object.keys(dayOut.dismissedDaily).forEach(function (d) { target.dismissedDaily[d] = true; });
    } else {
      out.days[nk] = dayOut;
    }
  });
  if (ctx.errors.length) return null;
  let viewDay = util.normalizeKey(value.viewDay);
  if (!viewDay) {
    const keysSorted = Object.keys(out.days).sort();
    viewDay = keysSorted.length ? keysSorted[keysSorted.length - 1] : util.todayKey();
    ctx.repaired.push(label + '：viewDay 非法，已定为 ' + viewDay);
  } else if (!migrated && typeof value.viewDay === 'string' && viewDay !== value.viewDay) {
    ctx.repaired.push(label + '：viewDay ' + value.viewDay + ' 已补零');
  }
  if (!out.days[viewDay]) out.days[viewDay] = { tasks: [], dismissedDaily: {} };
  out.viewDay = viewDay;
  return out;
}

function validateDailyConfig(value, ctx) {
  const label = K.DAILY;
  if (!isPlainObject(value)) { ctx.errors.push(label + '：必须是对象'); return null; }
  if (!Array.isArray(value.tasks)) { ctx.errors.push(label + '：缺少 tasks 数组（必需字段）'); return null; }
  const out = { tasks: [] };
  value.tasks.forEach(function (t, i) {
    const tl = label + '.tasks[' + i + ']';
    if (!isPlainObject(t)) { ctx.errors.push(tl + '：必须是对象'); return; }
    const title = (typeof t.title === 'string') ? t.title.trim() : '';
    if (!title) { ctx.errors.push(tl + '：缺少 title（必需字段）'); return; }
    const id = (typeof t.id === 'string' && t.id) ? t.id : 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    out.tasks.push({ id: id, title: title });
  });
  return out;
}

function validateTimerStats(value, ctx) {
  const label = K.TIMER_STATS;
  if (!isPlainObject(value)) { ctx.errors.push(label + '：必须是对象'); return null; }
  const out = {};
  const day = util.normalizeKey(value.day);
  if (!day) { ctx.errors.push(label + '：day 缺失或非法（必需字段）'); return null; }
  if (day !== value.day) ctx.repaired.push(label + '：day ' + value.day + ' 已补零为 ' + day);
  out.day = day;
  if (typeof value.rounds !== 'number' || !isFinite(value.rounds)) { ctx.errors.push(label + '：rounds 缺失或非数字（必需字段）'); return null; }
  if (typeof value.minutes !== 'number' || !isFinite(value.minutes)) { ctx.errors.push(label + '：minutes 缺失或非数字（必需字段）'); return null; }
  out.rounds = Math.max(0, Math.round(value.rounds));
  out.minutes = Math.max(0, Math.round(value.minutes));
  if (typeof value.updatedAt === 'string') out.updatedAt = value.updatedAt;
  return out;
}

function validateTimerPrefs(value, ctx) {
  const label = K.TIMER_PREFS;
  if (!isPlainObject(value)) { ctx.errors.push(label + '：必须是对象'); return null; }
  const out = {};
  ['sound', 'notify', 'tray', 'closeToTray', 'highContrast', 'showSeconds'].forEach(function (k) {
    if (typeof value[k] === 'boolean') out[k] = value[k];
    else if (value[k] != null) ctx.repaired.push(label + '：' + k + ' 非布尔，已丢弃');
  });
  if (value.motion === 'full' || value.motion === 'calm' || value.motion === 'off') out.motion = value.motion;
  else if (value.motion != null) ctx.repaired.push(label + '：motion 非法值，已丢弃');
  if (value.phases != null) {
    if (!isPlainObject(value.phases)) { ctx.errors.push(label + '：phases 必须是对象'); return null; }
    const ph = {};
    let bad = false;
    PHASE_SET.forEach(function (k) {
      if (value.phases[k] == null) return;
      const n = clampInt(value.phases[k], 60, 180 * 60, NaN);
      if (isNaN(n)) { ctx.errors.push(label + '.phases.' + k + '：非数字时长'); bad = true; }
      else {
        if (n !== value.phases[k]) ctx.repaired.push(label + '.phases.' + k + ' 已规范到 ' + n);
        ph[k] = n;
      }
    });
    if (bad) return null;
    const extra = Object.keys(value.phases).filter(function (k) { return PHASE_SET.indexOf(k) === -1; });
    if (extra.length) ctx.repaired.push(label + '：忽略未知阶段 ' + extra.join(','));
    out.phases = ph;
  }
  return out;
}

function validateTimerState(value, ctx) {
  const label = K.TIMER_STATE;
  if (!isPlainObject(value)) { ctx.errors.push(label + '：必须是对象'); return null; }
  if (PHASE_SET.indexOf(value.phase) === -1) { ctx.errors.push(label + '：phase 非法（需 focus/short/long）'); return null; }
  const out = {};
  out.phase = value.phase;
  out.totalSec = clampInt(value.totalSec, 1, 180 * 60, 0);
  if (!out.totalSec) { ctx.errors.push(label + '：totalSec 缺失或非法（必需字段）'); return null; }
  out.leftMs = clampInt(value.leftMs, 0, out.totalSec * 1000, out.totalSec * 1000);
  out.running = !!value.running;
  if (out.running) {
    if (typeof value.endAt !== 'number' || !isFinite(value.endAt) || value.endAt <= 0) {
      ctx.errors.push(label + '：running=true 但缺少合法 endAt（必需字段）'); return null;
    }
    out.endAt = Math.round(value.endAt);
  } else out.endAt = 0;
  if (typeof value.startedAt === 'string') out.startedAt = value.startedAt;
  else out.startedAt = null;
  out.pauseCount = Math.max(0, clampInt(value.pauseCount, 0, 1e6, 0));
  out.pausedMs = Math.max(0, clampInt(value.pausedMs, 0, 1e12, 0));
  out.pauseStartedAt = (typeof value.pauseStartedAt === 'number' && isFinite(value.pauseStartedAt))
    ? Math.max(0, Math.min(1e15, Math.round(value.pauseStartedAt)))
    : 0;
  out.round = Math.max(1, clampInt(value.round, 1, 1e6, 1));
  out.abandoned = !!value.abandoned;
  if (value.task != null) {
    const ref = value.task;
    if (!isPlainObject(ref) || typeof ref.id !== 'string' || !ref.id || ref.id.length > 128 || !util.normalizeKey(ref.day) || typeof ref.title !== 'string' || ref.title.length > 500) {
      ctx.errors.push(label + '：task 关联格式非法'); return null;
    }
    out.task = { id: ref.id, day: util.normalizeKey(ref.day), title: ref.title };
  }
  if (typeof value.updatedAt === 'string') out.updatedAt = value.updatedAt;
  if (value.plan != null) {
    const p = checkPlan(value.plan, label, ctx);
    if (p) out.plan = p;
  }
  return out;
}

/** 多轮计划：{key,name,steps:[{phase,sec}],index}；非法即剥离（可修复，不终止） */
function checkPlan(p, label, ctx) {
  if (!isPlainObject(p) || typeof p.key !== 'string' || !p.key || typeof p.name !== 'string' || p.name.length > 60 ||
    !Array.isArray(p.steps) || p.steps.length === 0 || p.steps.length > 60) {
    ctx.repaired.push(label + '：plan 结构非法，已丢弃');
    return null;
  }
  const steps = [];
  let bad = false;
  p.steps.forEach(function (s, i) {
    if (!isPlainObject(s) || PHASE_SET.indexOf(s.phase) === -1 || typeof s.sec !== 'number') { bad = true; return; }
    steps.push({ phase: s.phase, sec: clampInt(s.sec, 60, 180 * 60, 60) });
  });
  if (bad) { ctx.repaired.push(label + '：plan.steps 含非法段，已丢弃'); return null; }
  const index = clampInt(p.index, 0, steps.length - 1, 0);
  return { key: p.key.slice(0, 40), name: p.name.slice(0, 60), steps: steps, index: index };
}

function validateTimerHistory(value, ctx) {
  const label = K.TIMER_HISTORY;
  if (!Array.isArray(value)) { ctx.errors.push(label + '：必须是数组'); return null; }
  const out = [];
  value.forEach(function (h, i) {
    const hl = label + '[' + i + ']';
    if (!isPlainObject(h)) { ctx.errors.push(hl + '：历史条目必须是对象'); return; }
    const e = {};
    const d = util.normalizeKey(h.day);
    if (d) e.day = d;
    else { ctx.errors.push(hl + '：day 缺失或非法（必需字段）'); return; }
    if (PHASE_SET.indexOf(h.phase) === -1) { ctx.errors.push(hl + '：phase 非法'); return; }
    e.phase = h.phase;
    ['startedAt', 'finishedAt'].forEach(function (k) { if (typeof h[k] === 'string') e[k] = h[k]; });
    e.plannedMinutes = Math.max(0, clampInt(h.plannedMinutes, 0, 1e6, 0));
    e.actualMinutes = Math.max(0, clampInt(h.actualMinutes, 0, 1e6, 0));
    e.pauseCount = Math.max(0, clampInt(h.pauseCount, 0, 1e6, 0));
    e.pausedMinutes = Math.max(0, clampInt(h.pausedMinutes, 0, 1e6, 0));
    const results = ['done', 'abandoned', 'recovered'];
    if (results.indexOf(h.result) === -1) { ctx.errors.push(hl + '：result 非法'); return; }
    e.result = h.result;
    if (typeof h.taskId === 'string' && h.taskId.length <= 128) e.taskId = h.taskId;
    if (util.normalizeKey(h.taskDay)) e.taskDay = util.normalizeKey(h.taskDay);
    if (typeof h.taskTitle === 'string') e.taskTitle = h.taskTitle.slice(0, 500);
    out.push(e);
  });
  if (out.length > HISTORY_MAX) {
    ctx.repaired.push(label + '：超出上限，仅保留最近 ' + HISTORY_MAX + ' 条');
    return out.slice(out.length - HISTORY_MAX);
  }
  return out;
}

/** 按键名校验单个值。返回 {ok, value, repaired[]}；未知键按原值放行 */
function validateValue(key, value) {
  const ctx = { errors: [], repaired: [] };
  let out = value;
  switch (key) {
    case K.TODO_VIEW:
      if (!isPlainObject(value) || typeof value.onlyOpen !== 'boolean' || !Array.isArray(value.collapsed) || value.collapsed.length > 1000 || value.collapsed.some(k => typeof k !== 'string' || k.length > 256)) {
        ctx.errors.push('任务视图偏好格式非法');
      } else out = { onlyOpen: value.onlyOpen, collapsed: value.collapsed.slice() };
      break;
    case K.STATE_V2: case K.STATE_V1: out = validateFocusState(value, ctx, key); break;
    case K.DAILY: out = validateDailyConfig(value, ctx); break;
    case K.TIMER_STATS: out = validateTimerStats(value, ctx); break;
    case K.TIMER_PREFS: out = validateTimerPrefs(value, ctx); break;
    case K.TIMER_STATE: out = validateTimerState(value, ctx); break;
    case K.TIMER_HISTORY: out = validateTimerHistory(value, ctx); break;
    case K.TIMER_RUN:
      if (!isPlainObject(value)) ctx.errors.push(K.TIMER_RUN + '：必须是对象');
      break;
    default:
      if (isCorruptKey(key)) {
        if (!isPlainObject(value) || typeof value.raw !== 'string') ctx.errors.push(key + '：恢复键内容异常');
      }
      break;
  }
  return { ok: ctx.errors.length === 0, errors: ctx.errors, repaired: ctx.repaired, value: out };
}

/** 校验整个导入包：{app?, schema?, data} -> {ok, errors, repaired, summary} */
function validateBundle(bundle) {
  const errors = [];
  const repaired = [];
  const perKey = {};
  if (!isPlainObject(bundle)) return { ok: false, errors: ['备份文件必须是一个 JSON 对象'], repaired, perKey, summary: null };
  if (!isPlainObject(bundle.data)) return { ok: false, errors: ['缺少 data 字段或格式不对（不是西西弗斯 备份）'], repaired, perKey, summary: null };
  const keys = Object.keys(bundle.data);
  const known = [];
  const unknown = [];
  keys.forEach(function (k) {
    if (!isValidStoreKey(k)) { errors.push('非法键名：' + JSON.stringify(String(k).slice(0, 40))); return; }
    if (isCorruptKey(k)) { unknown.push(k); return; }   // 恢复键只做搬运
    const r = validateValue(k, bundle.data[k]);
    repaired.push.apply(repaired, r.repaired.map(function (m) { return '导入修复：' + m; }));
    if (!r.ok) { errors.push.apply(errors, r.errors); return; }
    perKey[k] = r.value;
    known.push(k);
  });
  if (!known.length && !unknown.length && !keys.length) errors.push('备份文件里没有任何可导入的数据');
  const summary = summarize({ data: perKey }, unknown);
  return { ok: errors.length === 0, errors: errors, repaired: repaired, perKey: perKey, summary: summary };
}

/** 导入/导出摘要（不含任务正文，只含数量，可安全写日志） */
function summarize(bundle, unknownKeys) {
  const d = (bundle && bundle.data) || {};
  const tasks = d[K.STATE_V2] || (unknownKeys ? null : d[K.STATE_V1]);
  let days = 0, taskCount = 0;
  if (tasks && tasks.days && isPlainObject(tasks.days)) {
    days = Object.keys(tasks.days).length;
    Object.keys(tasks.days).forEach(function (k) { taskCount += (tasks.days[k].tasks || []).length; });
  }
  const daily = d[K.DAILY];
  const stats = d[K.TIMER_STATS];
  const history = d[K.TIMER_HISTORY];
  return {
    exportedAt: bundle && bundle.exportedAt,
    app: bundle && bundle.app,
    schema: bundle && bundle.schema,
    keys: Object.keys(d).length + (Array.isArray(unknownKeys) ? unknownKeys.length : 0),
    days: days,
    tasks: taskCount,
    dailyTemplates: (daily && Array.isArray(daily.tasks)) ? daily.tasks.length : 0,
    timerMinutes: (stats && typeof stats.minutes === 'number') ? stats.minutes : 0,
    timerRounds: (stats && typeof stats.rounds === 'number') ? stats.rounds : 0,
    historyEntries: Array.isArray(history) ? history.length : 0,
    recoveryEntries: Array.isArray(unknownKeys) ? unknownKeys.length : 0
  };
}

/** 把分区名解析成键列表；未知分区返回 null（调用方据此拒绝） */
function resolveClearScopes(scopes) {
  if (scopes == null) return { all: true, keys: null };
  if (!Array.isArray(scopes) || !scopes.length) return { all: false, keys: [], bad: ['空列表'] };
  const out = [];
  const bad = [];
  const seen = {};
  scopes.forEach(function (s) {
    if (typeof s !== 'string') { bad.push(String(s)); return; }
    if (s === 'all') { out.push.apply(out, Object.keys(CLEAR_SCOPES).reduce(function (acc, k) {
      CLEAR_SCOPES[k].forEach(function (key) { if (acc.indexOf(key) === -1) acc.push(key); }); return acc;
    }, [])); return; }
    if (CLEAR_SCOPES[s]) {
      CLEAR_SCOPES[s].forEach(function (key) { if (!seen[key]) { seen[key] = true; out.push(key); } });
      return;
    }
    if (isValidStoreKey(s) && !isCorruptKey(s)) {
      if (!seen[s]) { seen[s] = true; out.push(s); }
      return;
    }
    bad.push(s);
  });
  return { all: false, keys: out, bad: bad };
}

module.exports = {
  SCHEMA,
  KEY_PREFIX,
  MAX_KEY_LEN,
  MAX_VALUE_BYTES,
  MAX_BUNDLE_BYTES,
  HISTORY_MAX,
  PHASE_SET,
  ALARM_RE,
  PLAN_KEYS,
  KEYS: K,
  CLEAR_SCOPES,
  isValidStoreKey,
  isCorruptKey,
  validateValue,
  validateBundle,
  summarize,
  resolveClearScopes,
  clampInt,
  isPlainObject
};
