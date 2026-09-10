/* ============================================================
 * src/main/migrations.js · 存储文件版本化迁移（主进程权威层）
 * ------------------------------------------------------------
 * 与 schema.js 的分工：
 *   schema.js     —— 判断「这份数据是不是合法的」
 *   migrations.js —— 把「旧版本的合法数据」升级到当前版本
 *
 * 迁移必须幂等：重复执行不产生额外变化。
 * 每一次迁移都记录在 changes 里，供日志 / 诊断 / 测试断言。
 *
 * 迁移链（envelope.schema）：
 *   (无外层，裸键值表)  -> 1  视为旧版，包装 + 逐键迁移
 *   1 -> 2              引入 {schema, updatedAt, data} 外层（现行版本）
 * 数据级迁移（与 schema 号无关，逐键执行）：
 *   M1 旧扁平任务结构 {tasks} -> {viewDay, days}
 *   M2 日期键零填充 2026-9-8 -> 2026-09-08（focus-state-v2 / stats.day）
 *   M3 旧键 sisy-focus-state -> sisy-focus-state-v2（目标键不存在时）
 *   M4 统计数值规范化（rounds/minutes 非负整数）
 *   M5 历史列表裁剪到 HISTORY_MAX
 *   M6 偏好 phases 时长钳制到 60s..3h
 * ============================================================ */
'use strict';

const util = require('./util');
const schema = require('./schema');

const CURRENT_SCHEMA = schema.SCHEMA;   // 2

function isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

/* ---------- M1/M2：任务状态迁移（扁平->分组、日期键补零） ---------- */
function migrateFocusState(data, changes) {
  const K2 = schema.KEYS.STATE_V2;
  const K1 = schema.KEYS.STATE_V1;
  let st = data[K2];

  // M3：旧键并入（仅当 v2 不存在）
  if (st == null && data[K1] != null) {
    st = data[K1];
    changes.push('M3 旧键 ' + K1 + ' -> ' + K2);
    delete data[K1];
    data[K2] = st;
  }
  if (st == null) { delete data[K1]; return; }
  if (!isPlainObject(st)) {
    changes.push('M0 ' + K2 + ' 非对象，移除');
    delete data[K2];
    return;
  }

  // M1：扁平 {tasks:[...]} -> {viewDay, days:{今天:{tasks}}}
  if (!isPlainObject(st.days) && Array.isArray(st.tasks)) {
    const day = util.todayKey();
    const days = {};
    days[day] = { tasks: st.tasks, dismissedDaily: {} };
    st = { viewDay: day, days: days };
    changes.push('M1 扁平任务结构迁移到按日期分组（' + day + '）');
    data[K2] = st;
  }
  if (!isPlainObject(st.days)) return;

  // M2：日期键补零 + 统一合并（不依赖遍历顺序；规范键与旧键走同一入口）
  let touched = false;
  const fixedDays = {};
  function mergeDay(nk, incoming) {
    if (!isPlainObject(incoming)) { touched = true; return; }
    if (!fixedDays[nk]) { fixedDays[nk] = incoming; return; }
    // 已存在：合并任务（按 id 去重，保留先合并者）与 dismissedDaily（并集）
    const target = isPlainObject(fixedDays[nk]) ? fixedDays[nk] : { tasks: [], dismissedDaily: {} };
    const srcTasks = Array.isArray(target.tasks) ? target.tasks : [];
    const ids = {};
    srcTasks.forEach(function (t) { if (t && t.id) ids[t.id] = true; });
    (Array.isArray(incoming.tasks) ? incoming.tasks : []).forEach(function (t) {
      if (t && t.id && ids[t.id]) return;      // 同 ID：先合并者胜（稳定、幂等）
      srcTasks.push(t);
    });
    target.tasks = srcTasks;
    if (isPlainObject(incoming.dismissedDaily)) {
      const dd = isPlainObject(target.dismissedDaily) ? target.dismissedDaily : {};
      Object.keys(incoming.dismissedDaily).forEach(function (d) {
        if (!dd[d]) dd[d] = !!incoming.dismissedDaily[d];   // 已经隐藏的不被覆盖
      });
      target.dismissedDaily = dd;
    }
    fixedDays[nk] = target;
  }
  Object.keys(st.days).forEach(function (k) {
    const nk = util.normalizeKey(k);
    if (!nk) { changes.push('M2 ' + K2 + ' 丢弃非法日期键 ' + JSON.stringify(k)); touched = true; return; }
    if (nk !== k) {
      touched = true;
      changes.push('M2 日期键 ' + k + ' -> ' + nk);
    }
    mergeDay(nk, st.days[k]);
  });
  if (touched) st.days = fixedDays;

  const nvd = util.normalizeKey(st.viewDay);
  if (nvd && st.viewDay !== nvd) {
    changes.push('M2 viewDay ' + st.viewDay + ' -> ' + nvd);
    st.viewDay = nvd;
    touched = true;
  } else if (!nvd) {
    const keys = Object.keys(st.days).sort();
    st.viewDay = keys.length ? keys[keys.length - 1] : util.todayKey();
    changes.push('M2 viewDay 非法，重置为 ' + st.viewDay);
    touched = true;
  }
  if (touched) data[K2] = st;
}

/* ---------- M4：统计规范化 ---------- */
function migrateStats(data, changes) {
  const key = schema.KEYS.TIMER_STATS;
  const s = data[key];
  if (!isPlainObject(s)) { if (s != null) { delete data[key]; changes.push('M4 非法统计已移除'); } return; }
  const before = JSON.stringify(s);
  const day = util.normalizeKey(s.day);
  if (day && day !== s.day) { s.day = day; changes.push('M4 统计日期键补零 -> ' + day); }
  const rounds = schema.clampInt(s.rounds, 0, 1e6, 0);
  const minutes = schema.clampInt(s.minutes, 0, 1e6, 0);
  if (s.rounds !== rounds) { s.rounds = rounds; changes.push('M4 rounds 规范化为 ' + rounds); }
  if (s.minutes !== minutes) { s.minutes = minutes; changes.push('M4 minutes 规范化为 ' + minutes); }
  if (JSON.stringify(s) !== before) data[key] = s;
}

/* ---------- M5：历史裁剪 ---------- */
function migrateHistory(data, changes) {
  const key = schema.KEYS.TIMER_HISTORY;
  const h = data[key];
  if (h == null) return;
  if (!Array.isArray(h)) { delete data[key]; changes.push('M5 非法历史已移除'); return; }
  if (h.length > schema.HISTORY_MAX) {
    data[key] = h.slice(h.length - schema.HISTORY_MAX);
    changes.push('M5 历史裁剪到最近 ' + schema.HISTORY_MAX + ' 条');
  }
}

/* ---------- M6：偏好钳制 ---------- */
function migratePrefs(data, changes) {
  const key = schema.KEYS.TIMER_PREFS;
  const p = data[key];
  if (!isPlainObject(p)) { if (p != null) { delete data[key]; changes.push('M6 非法偏好已移除'); } return; }
  if (isPlainObject(p.phases)) {
    schema.PHASE_SET.forEach(function (k) {
      if (p.phases[k] == null) return;
      const n = schema.clampInt(p.phases[k], 60, 180 * 60, NaN);
      if (!isNaN(n) && n !== p.phases[k]) { p.phases[k] = n; changes.push('M6 阶段 ' + k + ' 时长钳制为 ' + n + 's'); }
    });
  }
}

/**
 * 对整份 data（键值表）执行全部数据级迁移。
 * 返回 {data, changes}；changes 为空表示无需改动（幂等）。
 */
function migrateData(data, opts) {
  opts = opts || {};
  const log = opts.log || function () { };
  const changes = [];
  if (!isPlainObject(data)) return { data: {}, changes: changes };
  migrateFocusState(data, changes);
  migrateStats(data, changes);
  migrateHistory(data, changes);
  migratePrefs(data, changes);
  changes.forEach(log);
  return { data: data, changes: changes };
}

/**
 * 校验并升级存储文件外层。
 * 输入：JSON.parse 后的文件内容；输出：{data, schema, upgraded, notes[]}
 */
function migrateEnvelope(parsed) {
  const notes = [];
  if (!isPlainObject(parsed)) {
    notes.push('外层结构非法，按空存储处理');
    return { data: {}, schema: CURRENT_SCHEMA, upgraded: true, notes: notes };
  }
  let data;
  let from = 0;
  if (isPlainObject(parsed.data)) {
    data = parsed.data;
    from = (typeof parsed.schema === 'number' && isFinite(parsed.schema)) ? parsed.schema : 1;
  } else {
    // 裸键值表 = schema 1 之前的形态，包装之
    data = {};
    Object.keys(parsed).forEach(function (k) {
      if (k === 'schema' || k === 'updatedAt') return;
      data[k] = parsed[k];
    });
    from = 1;
    notes.push('检测到裸键值表，已包装为 {schema,data} 外层');
  }
  if (from < 1 || from > CURRENT_SCHEMA) notes.push('未知外层版本 ' + from + '，按 ' + from + ' -> ' + CURRENT_SCHEMA + ' 尽力升级');
  const r = migrateData(data);
  return { data: r.data, schema: CURRENT_SCHEMA, upgraded: from !== CURRENT_SCHEMA || r.changes.length > 0, notes: notes.concat(r.changes) };
}

module.exports = {
  CURRENT_SCHEMA: CURRENT_SCHEMA,
  migrateData: migrateData,
  migrateEnvelope: migrateEnvelope
};
