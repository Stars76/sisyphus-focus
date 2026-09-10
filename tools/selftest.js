#!/usr/bin/env node
/* ============================================================
 * tools/selftest.js · 纯 Node 逻辑自检（不启动 Electron）
 * ------------------------------------------------------------
 * 覆盖：
 *   1. 日期工具（零填充 / 旧键迁移）
 *   2. 主进程存储（读写 / 导出导入 / 备份 / 损坏恢复）
 *   3. 主进程计时状态机（唯一状态 / 不重复计数 / 暂停统计 /
 *      阶段切换 / 放弃 / 跨天 / 系统改表防护）
 *   4. 今日事数据层（旧结构迁移 / 每日任务实体化 / 删除不补回）
 * 用法：npm test
 * ============================================================ */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0;
const failures = [];

function ok(name) { pass++; }
function assert(cond, name, extra) {
  if (cond) { ok(name); return; }
  failures.push(name + (extra !== undefined ? '  →  ' + JSON.stringify(extra) : ''));
  console.error('  ✗ ' + name + (extra !== undefined ? '  →  ' + JSON.stringify(extra) : ''));
}
function eq(a, b, name) { assert(a === b, name, { got: a, want: b }); }
function near(a, b, tol, name) { assert(Math.abs(a - b) <= tol, name, { got: a, want: b, tol: tol }); }
function group(title) { console.log('\n── ' + title); }

/* ============================================================
 * 1. 日期工具
 * ============================================================ */
group('1. 日期工具（src/shared/date.js）');
require('../src/shared/log.js');
require('../src/shared/date.js');
const date = globalThis.DSH.date;

eq(date.dayKey(new Date(2026, 8, 8)), '2026-09-08', 'dayKey 补零');
eq(date.dayKey(new Date(2026, 11, 31)), '2026-12-31', 'dayKey 跨月');
eq(date.normalizeKey('2026-9-8'), '2026-09-08', 'normalizeKey 旧键补零');
eq(date.normalizeKey('2026-09-08'), '2026-09-08', 'normalizeKey 新键不变');
eq(date.isLegacyKey('2026-9-8'), true, 'isLegacyKey 识别旧键');
eq(date.isLegacyKey('2026-09-08'), false, 'isLegacyKey 新键为假');
eq(date.parseDayKey('2026-02-31'), null, '非法日期返回 null');
eq(date.parseDayKey('乱七八糟'), null, '无法解析返回 null');
eq(date.shiftDay('2026-09-30', 1), '2026-10-01', 'shiftDay 跨月');
eq(date.shiftDay('2026-01-01', -1), '2025-12-31', 'shiftDay 跨年');
eq(date.dayLabel('2026-09-08'), '9月8日', 'dayLabel');
eq(date.weekdayLabel('2026-09-08'), '周二', 'weekdayLabel');
eq(date.fmtClock(1500), '25:00', 'fmtClock 25 分钟');
eq(date.fmtClock(3661), '1:01:01', 'fmtClock 超过一小时');
eq(date.diffDays('2026-09-08', '2026-09-10'), 2, 'diffDays');

/* ============================================================
 * 2. 主进程工具 + 存储
 * ============================================================ */
group('2. 主进程存储（src/main/store.js）');
const util = require('../src/main/util');
const { createStore } = require('../src/main/store');

eq(/^\d{4}-\d{2}-\d{2}$/.test(util.todayKey()), true, 'util.todayKey 格式');
eq(util.normalizeKey('2026-9-8'), '2026-09-08', 'util.normalizeKey 旧键补零');
eq(util.normalizeKey('2026-09-08'), '2026-09-08', 'util.normalizeKey 新键不变');
eq(util.normalizeKey('乱七八糟'), null, 'util.normalizeKey 非法返回 null');
eq(util.fmtClock(3661), '1:01:01', 'util.fmtClock');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sisy-selftest-'));
const logs = [];
const store = createStore({ dir: tmp, log: (m) => logs.push(m), warn: (m) => logs.push(m) });
store.load();

assert(store.set('sisy-a', { x: 1 }).ok, '写入合法键');
eq(store.get('sisy-a').x, 1, '读回值');
assert(!store.set('bad-key', 1).ok, '拒绝非 sisy- 前缀的键');
eq(store.get('bad-key'), null, '非法键读取为 null');
assert(store.set('sisy-b', { deep: { arr: [1, 2, 3] } }).ok, '写入嵌套值');
eq(store.get('sisy-b').deep.arr.length, 3, '嵌套值读回');
eq(store.keys().join(','), 'sisy-a,sisy-b', 'keys 排序');

store.set('sisy-b', { changed: true });
eq(store.get('sisy-a').x, 1, '覆盖写入不影响其它键');

const b1 = store.backup('selftest');
assert(b1.ok && fs.existsSync(b1.path), '手动备份生成文件');

const exported = store.exportAll();
eq(exported.schema, 2, '导出包含 schema');
eq(exported.data['sisy-a'].x, 1, '导出包含数据');

const impMerge = store.importAll({ data: { 'sisy-c': { v: 3 } } }, 'merge');
assert(impMerge.ok, '合并导入成功');
eq(store.get('sisy-c').v, 3, '合并导入写入新键');
eq(store.get('sisy-a').x, 1, '合并导入保留旧键');
assert(!!impMerge.backup, '导入前自动备份');

const impReplace = store.importAll({ data: { 'sisy-z': { v: 9 } } }, 'replace');
assert(impReplace.ok, '替换导入成功');
eq(store.get('sisy-z').v, 9, '替换导入写入');
eq(store.get('sisy-a'), null, '替换导入清掉旧键');

eq(store.clear(['sisy-z']).removed, 1, '清空指定键');
eq(store.get('sisy-z'), null, '清空后读取为 null');

assert(!store.importAll(null).ok, '拒绝空备份');
assert(!store.importAll({ data: { 'bad': 1 } }).ok, '拒绝无有效键的备份');

store.set('sisy-keep', { v: 1 });
store.flush();
const rawFile = JSON.parse(fs.readFileSync(path.join(tmp, 'sisy-store.json'), 'utf8'));
eq(rawFile.schema, 2, '落盘文件包含 schema');
eq(rawFile.data['sisy-keep'].v, 1, '落盘文件包含数据');

// 损坏恢复
fs.writeFileSync(path.join(tmp, 'sisy-store.json'), '{{{ 这不是 JSON', 'utf8');
const store2 = createStore({ dir: tmp, log: (m) => logs.push(m), warn: (m) => logs.push(m) });
const loadRes = store2.load();
assert(loadRes.corrupt === true, '损坏文件被识别');
eq(store2.get('sisy-keep'), null, '损坏后数据重置');
assert(fs.readdirSync(tmp).some((f) => f.includes('.corrupt-')), '损坏文件已另存');

/* ============================================================
 * 3. 主进程计时状态机
 * ============================================================ */
/* R9：测试时钟隔离 —— 把「业务时钟 / 日期工具 / VM 内时间」统一到可模拟的测试日期，
   原生运行与真实系统日期无关：无论今天/明天/任意日期都稳定，脚本内用 simMs 模拟跨日。
   保留全部既有业务断言语义与数量；跨日模拟为新增场景（断言数会 +N，见输出）。 */
let simMs = new Date(2026, 8, 8, 12, 0, 0).getTime();
const RealDate = Date;
class TestDate extends RealDate {
  static now() { return simMs; }
  constructor(...a) { if (a.length === 0) super(simMs); else super(...a); }
}
global.Date = TestDate;

group('3. 计时状态机（src/main/timer.js）');
const { createTimer } = require('../src/main/timer');

const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sisy-timer-test-'));
const tstore = createStore({ dir: tmp2, log: () => { }, warn: () => { } });
tstore.load();

let wall = Date.parse('2026-09-08T09:00:00');
let mono = 1000;
const advance = (ms) => { wall += ms; mono += ms; };
const events = [];
let notified = 0;

const timer = createTimer({
  store: tstore,
  log: () => { },
  date: util,
  now: () => wall,
  mono: () => mono,
  onBroadcast: () => { },
  onEvent: (e) => events.push(e),
  notify: () => { notified++; }
});

let snap = timer.init();
eq(snap.timer.phase, 'focus', '初始阶段为专注');
eq(snap.timer.totalSec, 1500, '默认专注 25 分钟');
eq(snap.timer.running, false, '初始未运行');
eq(snap.timer.idle, true, '初始 idle');
eq(snap.timer.leftSec, 1500, '初始剩余 25 分钟');

timer.command('start');
snap = timer.snapshot();
eq(snap.timer.running, true, '开始后 running');
eq(snap.timer.idle, false, '开始后非 idle');

advance(60 * 1000);
timer.command('refresh');
snap = timer.snapshot();
eq(snap.timer.leftSec, 1440, '运行 1 分钟后剩余 24 分钟');
near(snap.timer.progress, 60 / 1500, 0.01, '进度约 4%');

timer.command('pause');
snap = timer.snapshot();
eq(snap.timer.running, false, '暂停后不运行');
eq(snap.timer.paused, true, '暂停标记');
eq(snap.timer.pauseCount, 1, '暂停次数 1');

advance(30 * 1000);              // 暂停中，时间不该走
timer.command('refresh');
eq(timer.snapshot().timer.leftSec, 1440, '暂停期间剩余时间不变');

timer.command('start');
advance(1441 * 1000);            // 剩余 1440 秒 + 1 秒余量
timer.command('refresh');
snap = timer.snapshot();
eq(snap.stats.rounds, 1, '完成一轮后轮次 +1');
eq(snap.stats.minutes, 25, '完成一轮记 25 分钟');
eq(snap.timer.running, false, '完成后回到未运行');
eq(snap.timer.phase, 'focus', '完成后仍停在专注阶段');
eq(snap.timer.idle, true, '完成后 idle');
eq(notified, 1, '完成发了一次通知');

const doneEv = events.filter((e) => e.type === 'done')[0];
assert(!!doneEv, '产生了 done 事件');
eq(doneEv.pauseCount, 1, 'done 事件带暂停次数');
near(doneEv.pausedMs, 30000, 50, 'done 事件带总暂停时间');
eq(doneEv.plannedMinutes, 25, 'done 事件带计划时长');

// 重复 refresh 不该重复计数
timer.command('refresh');
timer.command('refresh');
eq(timer.snapshot().stats.rounds, 1, '重复刷新不重复计数');

// 系统改表：墙上时钟跳 1 小时，单调时钟只走 10 秒
timer.command('start');
advance(10 * 1000);
wall += 3600 * 1000;             // 只改墙上时钟
timer.command('refresh');
snap = timer.snapshot();
eq(snap.timer.leftSec, 1490, '系统改表后用单调时钟校正剩余时间');
assert(snap.clockJumpAt > 0, '记录了时间跳变');
wall -= 3600 * 1000;
timer.command('reset');
eq(timer.snapshot().timer.leftSec, 1500, '重置回到满时长');
eq(timer.snapshot().timer.startedAt, null, '重置清空开始时间');

// 阶段切换：休息不计入专注统计
timer.command('setPhase', { phase: 'short' });
snap = timer.snapshot();
eq(snap.timer.totalSec, 300, '短休息 5 分钟');
eq(snap.timer.phase, 'short', '阶段切换为短休');
timer.command('start');
advance(301 * 1000);
timer.command('refresh');
snap = timer.snapshot();
eq(snap.stats.rounds, 1, '休息完成不计入专注轮次');
eq(snap.stats.minutes, 25, '休息完成不计入专注分钟');
eq(events.filter((e) => e.type === 'done' && e.phase === 'short').length, 1, '产生休息完成事件');

// 放弃本轮
timer.command('setPhase', { phase: 'focus' });
timer.command('start');
advance(120 * 1000);
timer.command('abandon');
snap = timer.snapshot();
eq(snap.stats.rounds, 1, '放弃不计入统计');
assert(events.some((e) => e.type === 'abandoned'), '产生 abandoned 事件');

// 自定义时长
timer.command('setDuration', { sec: 10 * 60 });
snap = timer.snapshot();
eq(snap.timer.totalSec, 600, '自定义 10 分钟生效');
eq(snap.phases.focus, 600, '自定义时长写入偏好');

// 中断记录
const hist = timer.getHistory();
assert(Array.isArray(hist) && hist.length >= 2, '写入专注历史');
assert(hist.some((h) => h.result === 'done'), '历史含完成记录');
assert(hist.some((h) => h.result === 'abandoned'), '历史含放弃记录');

// 跨天重置
tstore.set('sisy-timer-stats', { day: '2026-09-07', rounds: 9, minutes: 300 });
timer.init();
snap = timer.snapshot();
eq(snap.stats.day, '2026-09-08', '跨天后统计归属新日期');
eq(snap.stats.rounds, 0, '跨天后轮次清零');
eq(snap.stats.minutes, 0, '跨天后分钟清零');

// 旧版不补零的统计日期键：规范化后必须保留当天数据，不能误判成昨天而清零
tstore.set('sisy-timer-stats', { day: '2026-9-8', rounds: 5, minutes: 125 });
timer.init();
snap = timer.snapshot();
eq(snap.stats.day, util.todayKey(), '统计旧日期键被规范化为零填充');
eq(snap.stats.rounds, 5, '规范化后不丢轮次');
eq(snap.stats.minutes, 125, '规范化后不丢分钟');
eq(tstore.get('sisy-timer-stats').day, util.todayKey(), '规范化结果已落盘');

group('3b. 时钟隔离：另一个日期 + 跨日（R9）');
{
  // 模拟“另一个日期”与一次跨日：昨天(09-08)有统计 → 今天(09-09)启动归零并落盘
  const prevMs = simMs;
  simMs = new Date(2026, 8, 9, 8, 0, 0).getTime();
  tstore.set('sisy-timer-stats', { day: '2026-09-08', rounds: 5, minutes: 125 });
  timer.init();
  snap = timer.snapshot();
  eq(snap.stats.day, '2026-09-09', 'R9 冷启动跨日（09-08→09-09）统计归属新日期');
  eq(snap.stats.rounds, 0, 'R9 冷启动跨日（09-08→09-09）轮次清零');
  eq(tstore.get('sisy-timer-stats').day, '2026-09-09', 'R9 冷启动跨日统计归零已落盘（键更新为今天）');
  // 09-09 当天写不补零旧键：规范化后同日保留，不误判跨日
  tstore.set('sisy-timer-stats', { day: '2026-9-9', rounds: 5, minutes: 125 });
  timer.init();
  snap = timer.snapshot();
  eq(snap.stats.day, util.todayKey(), 'R9 09-09 当天旧统计键被规范化');
  eq(snap.stats.rounds, 5, 'R9 09-09 当天旧统计键不丢轮次');
  eq(snap.stats.minutes, 125, 'R9 09-09 当天旧统计键不丢分钟');
  simMs = prevMs;
}

/* ============================================================
 * 4. 今日事数据层
 * ============================================================ */
group('4. 今日事数据层（src/todo/state.js）');

// 内存版主进程存储：让 storage.js 走 ipc 通道
const memStore = new Map();
const cloneVal = (x) => (x == null ? null : JSON.parse(JSON.stringify(x)));
global.dshStore = {
  get: (k) => (memStore.has(k) ? cloneVal(memStore.get(k)) : null),
  set: (k, v) => { memStore.set(k, cloneVal(v)); return { ok: true }; },
  remove: (k) => { memStore.delete(k); return { ok: true }; },
  keys: () => Array.from(memStore.keys()),
  exportAll: () => ({ app: 'sisy', data: Object.fromEntries(memStore) }),
  importAll: () => ({ ok: true }),
  clear: () => { memStore.clear(); return { ok: true }; },
  backup: () => ({ ok: true, path: 'x' })
};

require('../src/shared/storage.js');
require('../src/todo/state.js');
const DSH = globalThis.DSH;
DSH.store.init();
eq(DSH.store.backendKind, 'ipc', '走主进程 ipc 存储');

const tstate = DSH.todo.createState({ store: DSH.store, date: DSH.date, log: DSH.log });
DSH.store.set('sisy-focus-state-v2', {
  viewDay: '2026-09-08',
  days: { '2026-09-08': { tasks: [{ id: 'a1', title: '任务', done: false, subtasks: [] }], dismissedDaily: {} } }
});
tstate.init();
eq(tstate.viewDay, '2026-09-08', '按 viewDay 打开');
eq(tstate.tasks()[0].title, '任务', '加载已有任务');

// 增删改
const before = tstate.tasks().length;
tstate.addTask('写自检');
eq(tstate.tasks().length, before + 1, '新增任务');
eq(tstate.tasks()[0].title, '写自检', '新任务排在最前');
const newId = tstate.tasks()[0].id;
tstate.toggleTask(newId);
eq(tstate.findTask(newId).done, true, '勾选任务');
tstate.toggleTask(newId);
eq(tstate.findTask(newId).done, false, '取消勾选');

// 标题不设长度上限：超长文字必须原样保存
const longTitle = '把整段会议纪要粘进来的任务'.repeat(12);
tstate.addTask(longTitle);
eq(tstate.tasks()[0].title, longTitle, '超长标题原样保存');
eq(tstate.tasks()[0].title.length, longTitle.length, '超长标题不被截断');
tstate.deleteTask(tstate.tasks()[0].id);

const s1 = tstate.addSubtask(newId);
tstate.setSubTitle(newId, s1.id, '第一步');
tstate.setSubMinutes(newId, s1.id, 15);
eq(tstate.findSub(tstate.findTask(newId), s1.id).minutes, 15, '设置小步骤分钟数');
tstate.toggleSubtask(newId, s1.id);
eq(tstate.findTask(newId).done, true, '小步骤全完成时主任务自动完成');
tstate.toggleSubtask(newId, s1.id);
eq(tstate.findTask(newId).done, false, '取消小步骤时主任务回退');
tstate.deleteSubtask(newId, s1.id);
eq(tstate.findTask(newId).subtasks.length, 0, '删除小步骤');

// 每日任务实体化 + 删除不补回
tstate.addDaily('每天喝水');
const dailyId = tstate.dailyConfig().tasks[0].id;
const dailyTasks = tstate.tasks().filter((t) => t.dailyId === dailyId);
eq(dailyTasks.length, 1, '每日任务实体化到今天');
tstate.syncDaily();
eq(tstate.tasks().filter((t) => t.dailyId === dailyId).length, 1, '重复同步不重复生成');
tstate.deleteTask(dailyTasks[0].id);
eq(tstate.tasks().filter((t) => t.dailyId === dailyId).length, 0, '删除每日任务实体');
tstate.syncDaily();
eq(tstate.tasks().filter((t) => t.dailyId === dailyId).length, 0, '当天删除后不再补回');

// 每日任务改名同步
tstate.addDaily('原名');
const did2 = tstate.dailyConfig().tasks[1].id;
tstate.renameDaily(did2, '新名');
eq(tstate.dailyConfig().tasks[1].title, '新名', '每日任务改名');
eq(tstate.tasks().filter((t) => t.dailyId === did2)[0].title, '新名', '改名同步到今天的实体任务');

/* ============================================================
 * 汇总
 * ============================================================ */
console.log('\n' + '='.repeat(52));
if (failures.length) {
  console.error('自检失败：' + failures.length + ' / ' + (pass + failures.length));
  failures.forEach((f) => console.error('  - ' + f));
  console.log('='.repeat(52) + '\n');
  process.exit(1);
}
console.log('全部通过 ✅  ' + pass + ' 项断言');
console.log('='.repeat(52) + '\n');
process.exit(0);
