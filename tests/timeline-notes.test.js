/* ============================================================
 * tests/timeline-notes.test.js · 每日时间轴 / 任务顺延 / 笔记模板
 * ------------------------------------------------------------
 * 覆盖：statistics.dayTimeline 合并语义、时间轴修正层（重叠允许）、
 * layoutTimeline 分列、taskTotals 跨日聚合、todo/state 任务顺延、
 * shared/template 渲染引擎、schema 新键校验。
 * 用法：node tests/timeline-notes.test.js
 * ============================================================ */
'use strict';

const H = require('./helpers');
const stat = require('../src/shared/statistics');
const tpl = require('../src/shared/template');
const schema = require('../src/main/schema');
const dateMod = require('../src/shared/date');
require('../src/todo/state');

function h(day, phase, result, taskId, from, to, mins, title) {
  return {
    day: day, phase: phase, result: result,
    taskId: taskId || null, taskDay: taskId ? day : null, taskTitle: taskId ? (title || '任务') : null,
    startedAt: day + 'T' + from + ':00', finishedAt: day + 'T' + to + ':00',
    plannedMinutes: mins, actualMinutes: mins, pauseCount: 0, pausedMinutes: 0
  };
}

/* ---------------- 1. dayTimeline 派生块与合并 ---------------- */
H.group('1. dayTimeline：同任务合并 / 中断独立 / 休息并入');
const D = '2026-09-22';
const merged = stat.dayTimeline([
  h(D, 'focus', 'done', 'tA', '08:00', '08:25', 25, '写报告'),
  h(D, 'short', 'done', 'tA', '08:25', '08:30', 5, '写报告'),
  h(D, 'focus', 'done', 'tA', '08:30', '08:55', 25, '写报告')
], D, null);
H.eq(merged.length, 1, '同任务相邻段（含计划内短休）合并为一块');
H.eq(merged[0].startMin, 8 * 60, '合并块起始 08:00');
H.eq(merged[0].endMin, 8 * 60 + 55, '合并块结束 08:55（含中间短休跨度）');
H.eq(merged[0].minutes, 50, '合并块专注分钟只计 focus 段');
H.eq(merged[0].segments, 2, '合并块 focus 段数为 2');

const far = stat.dayTimeline([
  h(D, 'focus', 'done', 'tA', '08:00', '08:25', 25),
  h(D, 'focus', 'done', 'tA', '09:30', '09:55', 25)
], D, null);
H.eq(far.length, 2, '间隔超过 15 分钟不合并');

const broke = stat.dayTimeline([
  h(D, 'focus', 'done', 'tA', '08:00', '08:25', 25),
  h(D, 'focus', 'abandoned', 'tA', '09:00', '09:10', 10),
  h(D, 'focus', 'done', 'tA', '09:30', '09:55', 25)
], D, null);
H.eq(broke.length, 3, 'abandoned 中断独立成块，前后不合并');
H.eq(broke[1].result, 'abandoned', '中断块带 abandoned 标记');

const untagged = stat.dayTimeline([
  h(D, 'focus', 'done', null, '10:00', '10:25', 25),
  h(D, 'focus', 'recovered', null, '14:00', '14:25', 25)
], D, null);
H.eq(untagged.length, 2, '未绑定任务的专注独立显示');
H.eq(untagged[0].title, '未定任务的专注', '未绑定块标题固定');

const restOnly = stat.dayTimeline([
  h(D, 'short', 'done', 'tB', '11:00', '11:05', 5, '休息任务')
], D, null);
H.eq(restOnly.length, 0, '纯休息块不构成「做了什么」');
H.eq(stat.dayTimeline([], 'bad-day', null).length, 0, '非法日期键返回空');

/* ---------------- 2. 时间轴修正层 ---------------- */
H.group('2. 修正层：改起止 / 隐藏 / 补录（重叠允许）');
const base = stat.dayTimeline([h(D, 'focus', 'done', 'tA', '08:00', '08:25', 25, '写报告')], D, null);
const key = base[0].key;
const fixed = stat.applyTimelineOverrides(base, {
  edits: [{ key: key, start: '08:05', end: '08:40' }],
  manual: [
    { id: 'm1', day: D, start: '08:30', end: '09:10', title: '开会' },
    { id: 'm2', day: '2026-09-21', start: '08:00', end: '09:00', title: '别的天' }
  ]
}, D);
H.eq(fixed.length, 2, '修正起止 + 当日补录并存（跨日补录不混入）');
H.eq(fixed[0].startMin, 8 * 60 + 5, 'edits 改起始时间生效');
H.eq(fixed[0].edited, true, '修正过的块带 edited 标记');
const manualBlock = fixed.filter(function (b) { return b.result === 'manual'; })[0];
H.eq(manualBlock.title, '开会', '补录块标题正确');
H.eq(manualBlock.minutes, 40, '补录块分钟 = 起止差');

const overlapped = stat.layoutTimeline(fixed);
H.eq(overlapped.length, 2, '布局保留全部块（重叠不清退）');
H.assert(overlapped[0].col !== overlapped[1].col, '重叠块并排分列');
H.eq(overlapped[0].cols, 2, '重叠簇宽度为 2');

const hidden = stat.applyTimelineOverrides(base, { edits: [{ key: key, hidden: true }], manual: [] }, D);
H.eq(hidden.length, 0, '隐藏的块不显示（不动权威历史）');

/* ---------------- 3. taskTotals 跨日聚合 ---------------- */
H.group('3. taskTotals：跨日累计（任务顺延场景）');
const totals = stat.taskTotals([
  h('2026-09-21', 'focus', 'done', 'tA', '08:00', '08:25', 25),
  h('2026-09-22', 'focus', 'done', 'tA', '08:00', '08:25', 25),
  h('2026-09-22', 'focus', 'abandoned', 'tA', '09:00', '09:10', 10)
]);
H.eq(totals['2026-09-21/tA'], 25, '按天索引保留');
H.eq(totals['tA'], 50, '按任务跨日聚合（abandoned 不计）');

/* ---------------- 4. 任务顺延 ---------------- */
H.group('4. 任务顺延：普通任务滚动顺延，每日任务豁免');
const mem = new Map();
const store = {
  get: function (k, d) { return mem.has(k) ? mem.get(k) : (d === undefined ? null : d); },
  set: function (k, v) { mem.set(k, JSON.parse(JSON.stringify(v))); return { ok: true }; }
};
const yesterday = dateMod.shiftDay(dateMod.todayKey(), -1);
mem.set('sisy-focus-state-v2', {
  viewDay: dateMod.todayKey(),
  days: {
    '2020-01-01': {},
    [yesterday]: {
      tasks: [
        { id: 't-open', title: '昨天没做完', subtasks: [], done: false },
        { id: 't-done', title: '昨天做完了', subtasks: [], done: true },
        { id: 't-daily', title: '每日任务', dailyId: 'd1', subtasks: [], done: false }
      ],
      dismissedDaily: {}
    },
    [dateMod.todayKey()]: { tasks: [], dismissedDaily: {} }
  }
});
const { createState } = globalThis.DSH.todo;
const st = createState({ store: store, date: dateMod, log: { error: function () { }, info: function () { } } }).init();
const todayTasks = st.tasks();
const yTasks = st.day(yesterday).tasks;
H.eq(todayTasks.length, 1, '未完成普通任务顺延到今天');
H.eq(todayTasks[0].id, 't-open', '顺延的是昨天未完成的那条');
H.eq(todayTasks[0].rolledFrom, yesterday, '顺延任务保留 rolledFrom 来源日');
H.eq(yTasks.length, 2, '已完成任务与每日任务留在原日');
H.assert(!yTasks.some(function (t) { return t.id === 't-open'; }), '原日不再重复显示顺延任务');
st.rolloverOpenTasks();
H.eq(st.tasks().length, 1, '重复顺延幂等（不复制）');

/* ---------------- 5. 模板引擎 ---------------- */
H.group('5. 模板引擎：单值 / 循环 / 空态 / 未知保留');
const out = tpl.render(
  '# {{date_cn}}\n{{#tasks_done}}- {{title}}（{{minutes}}）\n{{/tasks_done}}{{^tasks_done}}空{{/tasks_done}}\n{{unknown_var}}',
  { vars: { date_cn: '9月22日' }, lists: { tasks_done: [{ title: '写报告', minutes: 50 }] } }
);
H.assert(out.indexOf('9月22日') !== -1, '单值替换');
H.assert(out.indexOf('- 写报告（50）') !== -1, '循环块按条目展开');
H.assert(out.indexOf('空') === -1, '非空列表不渲染空态块');
H.assert(out.indexOf('{{unknown_var}}') !== -1, '未知变量原样保留');
const emptyOut = tpl.render('{{#tasks_done}}x{{/tasks_done}}{{^tasks_done}}今天还没有完成的任务{{/tasks_done}}', { vars: {}, lists: { tasks_done: [] } });
H.assert(emptyOut.indexOf('今天还没有完成的任务') !== -1, '空列表渲染空态块');
H.assert(tpl.pick(null, 'daily').text.indexOf('{{date_cn}}') !== -1, '未自定义时回落内置默认模板');

/* ---------------- 6. schema 新键校验 ---------------- */
H.group('6. schema：rolledFrom / 时间轴修正 / 笔记模板');
const stv = schema.validateValue('sisy-focus-state-v2', {
  viewDay: '2026-09-22',
  days: { '2026-09-22': { tasks: [{ id: 'a', title: 'x', subtasks: [], done: false, rolledFrom: '2026-9-8' }], dismissedDaily: {} } }
});
H.assert(stv.ok, '含 rolledFrom 的任务合法');
H.eq(stv.value.days['2026-09-22'].tasks[0].rolledFrom, '2026-09-08', 'rolledFrom 补零规范化');
const stv2 = schema.validateValue('sisy-focus-state-v2', {
  viewDay: '2026-09-22',
  days: { '2026-09-22': { tasks: [{ id: 'a', title: 'x', subtasks: [], done: false, rolledFrom: 'not-a-day' }], dismissedDaily: {} } }
});
H.assert(stv2.ok, '非法 rolledFrom 可修复不终止');
H.assert(!('rolledFrom' in stv2.value.days['2026-09-22'].tasks[0]), '非法 rolledFrom 被丢弃');

const ovv = schema.validateValue('sisy-timeline-overrides', {
  edits: [{ key: 'k1', start: '08:00', hidden: true }, { key: 'k2', start: '25:99' }, 'junk'],
  manual: [
    { id: 'm1', day: '2026-09-22', start: '08:00', end: '07:00', title: '倒流' },
    { id: 'm2', day: '2026-09-22', start: '08:00', end: '09:00', title: '正常' }
  ]
});
H.assert(ovv.ok, '时间轴修正整体合法（坏条目可修复）');
H.eq(ovv.value.edits.length, 1, '非法 edit 被丢弃');
H.eq(ovv.value.edits[0].key, 'k1', '合法 edit 保留（含隐藏标记）');
H.eq(ovv.value.edits[0].start, '08:00', '合法 HH:MM 字段保留');
H.eq(ovv.value.manual.length, 1, '结束早于开始的补录被丢弃');
H.eq(ovv.value.manual[0].title, '正常', '合法补录保留');

const tpv = schema.validateValue('sisy-export-template', {
  templates: { daily: { name: '自定义', text: '# {{date}}' }, task: { text: 123 }, weekly: { name: 'w', text: 'x'.repeat(40000) } }
});
H.assert(tpv.ok, '笔记模板整体合法（坏条目可修复）');
H.eq(tpv.value.templates.daily.text, '# {{date}}', '合法模板保留');
H.assert(!tpv.value.templates.task, '结构非法的模板被丢弃（回落默认）');
H.eq(tpv.value.templates.weekly.text.length, 32 * 1024, '超长模板截断到 32KB');

H.finish();
