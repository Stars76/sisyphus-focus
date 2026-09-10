/* ============================================================
 * tests/timer-correctness.test.js · 计时正确性回归（任务 2）
 * 用可注入的 fake wall clock / monotonic clock 驱动 src/main/timer.js，
 * 覆盖：显式状态转换约束（非法转换被拒并记录）、重启恢复、休眠唤醒、
 *       系统时间跳变、跨午夜、重复完成、多窗口命令、放弃不计统计、
 *       完成事件/统计/历史各只发生一次。
 * 用法：node tests/timer-correctness.test.js
 * ============================================================ */
'use strict';

const path = require('path');
const H = require('./helpers');
const { createStore } = require('../src/main/store');
const { createTimer } = require('../src/main/timer');
const util = require('../src/main/util');

const sec = (n) => n * 1000;

/* 按 fake 时钟出“今天键”的 date provider */
function clockDate(clock) {
  return {
    todayKey: () => util.todayKey(new Date(clock.wall)),
    normalizeKey: util.normalizeKey
  };
}

function harness(startWallIso) {
  const dir = H.mkTmp('timer-corr');
  const store = createStore({ dir, log: () => { }, warn: () => { } });
  store.load();
  const clock = H.fakeClock(Date.parse(startWallIso || '2026-09-08T09:00:00'), 10000);
  const events = [];
  const logs = [];
  const notifications = [];
  const broadcasts = [];
  const ctx = { dir, clock, events, logs, notifications, broadcasts, store };
  ctx.makeTimer = function () {
    const evts = [];
    const notes = [];
    const t = createTimer({
      store: ctx.store, log: (m) => logs.push(String(m)), date: clockDate(clock),
      now: clock.now, mono: clock.monoNow,
      onBroadcast: (s) => broadcasts.push(s.revision),
      onEvent: (e) => { evts.push(e); events.push(e); },
      notify: (x, b) => { notes.push(x); notifications.push(x); }
    });
    t.init();
    return { t, events: evts, notifications: notes };
  };
  /** 模拟真正的进程重启：新 store 实例从磁盘读 */
  ctx.restart = function () {
    ctx.store.flush();
    ctx.store = createStore({ dir, log: () => { }, warn: () => { } });
    ctx.store.load();
    return ctx.makeTimer();
  };
  ctx.timer = ctx.makeTimer().t;
  return ctx;
}

H.group('1. 显式状态转换约束（非法转换必须被拒绝且记录）');
{
  const h = harness();
  H.eq(h.timer.snapshot().smState, 'idle', '初始状态 idle');

  let snap = h.timer.command('pause');
  H.assert(snap.lastRejection && snap.lastRejection.command === 'pause', 'idle 中 pause 被拒绝并记录', snap.lastRejection);
  H.eq(snap.timer.pauseCount, 0, '被拒的 pause 没产生任何变更');
  H.eq(snap.smState, 'idle', '状态仍是 idle');

  snap = h.timer.command('abandon');
  H.assert(snap.lastRejection && snap.lastRejection.command === 'abandon', 'idle 中 abandon 被拒绝');
  H.eq(h.store.get('sisy-timer-history') ? h.store.get('sisy-timer-history').length : 0, 0, '被拒的 abandon 没写历史');

  h.timer.command('start');
  snap = h.timer.command('start');
  H.assert(snap.lastRejection && snap.lastRejection.command === 'start', 'running 中重复 start 被拒绝');
  H.eq(snap.timer.running, true, '拒绝不影响正在进行的计时');

  snap = h.timer.command('rm-rf-everything');
  H.assert(snap.lastRejection && /未知/.test(snap.lastRejection.reason), '未知命令被拒绝', snap.lastRejection);

  // 合法链：running -> pause -> resume
  h.clock.advance(sec(60));
  h.timer.command('refresh');
  snap = h.timer.command('pause');
  H.eq(snap.smState, 'paused', 'pause 后进入 paused');
  H.eq(snap.timer.running, false, 'pause 生效');
  h.timer.command('start');
  H.eq(h.timer.snapshot().smState, 'running', 'paused 可 resume');
}

H.group('2. 完成只记一次：事件 / 统计 / 历史各一次');
{
  const h = harness();
  h.timer.command('start');
  h.clock.advance(sec(60)); h.timer.command('pause');
  h.clock.advance(sec(30));                       // 暂停 30s，不该走表
  h.timer.command('start');
  h.clock.advance(sec(1441));                     // 跑完剩余 1440s
  h.timer.command('refresh');
  const snap = h.timer.snapshot();
  H.eq(snap.stats.rounds, 1, '完成一轮 rounds=1');
  H.eq(snap.stats.minutes, 25, '完成一轮 minutes=25');
  const doneEvents = h.events.filter((e) => e.type === 'done');
  H.eq(doneEvents.length, 1, 'done 事件只发了 1 次');
  H.near(doneEvents[0].pausedMs, 30000, 50, 'done 事件带累计暂停 30s');
  const hist = h.store.get('sisy-timer-history');
  H.eq(hist.length, 1, '历史只写了一条');
  H.eq(hist[0].result, 'done', '历史标记 done');
  H.eq(h.notifications.length, 1, '系统通知只发了一次');

  // 重复 refresh 不得重复计数
  h.timer.command('refresh');
  h.timer.command('refresh');
  h.timer.command('pause');   // 完成后 idle 中 pause 也要被拒
  H.eq(h.timer.snapshot().stats.rounds, 1, '重复 refresh / 非法 pause 后 rounds 仍为 1');
  H.eq(h.events.filter((e) => e.type === 'done').length, 1, '重复 refresh 不重复发 done 事件');
  H.eq(h.store.get('sisy-timer-history').length, 1, '重复 refresh 不重复写历史');
}

H.group('3. 重启恢复（含关闭期间到点）——真·进程重启（新 store 从磁盘读）');
{
  const h = harness();
  h.timer.command('start');
  h.clock.advance(sec(100));
  let r1 = h.restart();
  H.eq(r1.t.snapshot().timer.running, true, '重启后仍在计时');
  H.eq(r1.t.snapshot().timer.recovered, true, '重启恢复带 recovered 标记');
  H.eq(r1.t.snapshot().timer.leftSec, 1400, '重启后剩余时间按墙上时钟推算');

  // 关闭期间已到点 -> 静默补记一次，不通知
  h.clock.advance(sec(1401));
  const r2 = h.restart();
  H.eq(r2.t.snapshot().stats.rounds, 1, '关闭期间到点补记完成');
  H.eq(r2.notifications.length, 0, '静默补记不发通知');
  H.eq(r2.events.filter((e) => e.type === 'done' && e.silent).length, 1, 'silent done 事件一次');
  // 再次重启不得重复补记
  const r3 = h.restart();
  H.eq(r3.t.snapshot().stats.rounds, 1, '第二次重启不重复补记');
  H.eq(r3.events.filter((e) => e.type === 'done').length, 0, '第二次重启不再发 done 事件');
}

H.group('4. 休眠唤醒与系统时间跳变（fake 双时钟）');
{
  const h = harness();
  // 休眠 2 小时：单调时钟（uptime）与墙上时钟一起前进
  h.timer.command('start');
  h.clock.advance(sec(60));
  h.clock.advance(2 * 3600 * 1000);       // 模拟休眠唤醒（两钟都跳）
  h.timer.command('refresh');
  const s0 = h.timer.snapshot();
  H.eq(s0.stats.rounds, 1, '唤醒后到点即完成，只完成一次');
  H.eq(s0.clockJumpAt, 0, '休眠不算改表（两钟同步前进无 drift）');
  H.eq(h.events.filter((e) => e.type === 'done').length, 1, '唤醒只发一个 done');
  h.timer.command('refresh');
  H.eq(h.timer.snapshot().stats.rounds, 1, '重复唤醒刷新不重复计数');

  // 手动改表：只动墙上时钟，剩余必须按单调时钟校正
  const h2 = harness();
  h2.timer.command('start');
  h2.clock.advance(sec(10));
  h2.clock.jumpWall(3600 * 1000);         // 用户把系统时间拨快 1 小时
  let s = h2.timer.command('refresh');
  H.eq(s.timer.leftSec, 1490, '改表后剩余时间不被吃掉');
  H.assert(s.clockJumpAt > 0, '记录了 clockJump');
  h2.clock.advance(sec(500));             // 真实再走 500s
  s = h2.timer.command('refresh');
  H.eq(s.timer.leftSec, 990, '改表后计时继续按单调时钟正常递减');
}

H.group('5. 跨午夜：完成归到完成那一刻所在的日期');
{
  const h = harness('2026-09-08T23:55:00');
  h.timer.command('setDuration', { sec: 600 });   // 10 分钟，跨过 00:00 完成
  h.timer.command('start');
  for (let i = 0; i < 605; i++) {
    h.clock.advance(1000);
    h.timer.command('refresh');
  }
  const rollovers = h.events.filter((e) => e.type === 'day-rollover').length;
  const snap = h.timer.snapshot();
  H.eq(snap.stats.day, '2026-09-09', '统计归属新的一天');
  H.eq(snap.stats.rounds, 1, '跨午夜完成记在新的一天');
  H.eq(snap.stats.minutes, 10, '分钟数正确');
  H.eq(rollovers, 1, 'day-rollover 事件只发一次');
  const done = h.events.filter((e) => e.type === 'done')[0];
  H.eq(done.day, '2026-09-09', 'done 事件带正确日期');
}

H.group('6. 放弃与「运行中改设置」：丢轮必须留痕，统计不加');
{
  const h = harness();
  h.timer.command('start');
  h.clock.advance(sec(120));
  h.timer.command('abandon');
  const snap = h.timer.snapshot();
  H.eq(snap.stats.rounds, 0, '放弃不加轮次');
  H.eq(snap.stats.minutes, 0, '放弃不加分钟');
  H.eq(h.events.filter((e) => e.type === 'abandoned').length, 1, 'abandoned 事件一次');
  const hist = h.store.get('sisy-timer-history');
  H.eq(hist.length, 1, '历史记了一条 abandoned');
  // 放弃后再放弃必须被拒（状态已回 idle）
  h.timer.command('abandon');
  H.eq(h.store.get('sisy-timer-history').length, 1, '重复放弃不追加历史');
  H.assert(h.timer.snapshot().lastRejection, '重复放弃被记录拒绝');

  // 运行中切阶段：等价于先放弃再切换（不再无痕丢轮）
  h.timer.command('setPhase', { phase: 'short' });
  h.timer.command('start');
  h.clock.advance(sec(30));
  h.timer.command('setPhase', { phase: 'focus' });
  const hist2 = h.store.get('sisy-timer-history');
  H.eq(hist2.filter((x) => x.result === 'abandoned').length, 2, '运行中切阶段为旧轮补记 abandoned');
  H.eq(h.timer.snapshot().stats.rounds, 0, '切阶段不进统计');
  H.eq(h.timer.snapshot().smState, 'idle', '切阶段后回到 idle');

  // 运行中 reset 同样留痕
  h.timer.command('start');
  h.clock.advance(sec(10));
  h.timer.command('reset');
  H.eq(h.store.get('sisy-timer-history').filter((x) => x.result === 'abandoned').length, 3, 'reset 丢弃进行中的轮也留痕');
  H.eq(h.timer.snapshot().timer.leftSec, 1500, 'reset 后回到满时长');
}

H.group('7. 多窗口命令打到同一权威');
{
  const h = harness();
  // 小窗 start、主窗 pause、托盘 refresh —— 全部走同一 timer.command
  const s1 = h.timer.command('start');
  h.clock.advance(sec(5));
  const s2 = h.timer.command('pause');
  const s3 = h.timer.command('toggle');   // 托盘/小窗/主窗都走同一权威
  H.eq(s1.timer.running, true, 'start 生效');
  H.eq(s2.timer.running, false, 'pause 生效');
  H.eq(s3.timer.running, true, 'toggle 恢复计时');
  H.eq(s2.timer.leftSec, s3.timer.leftSec, '任何窗口看到的剩余一致（单一权威）');
  H.assert(s2.revision > s1.revision && s3.revision > s2.revision, 'revision 单调递增');
  const uniqBroadcast = new Set(h.broadcasts);
  H.assert(uniqBroadcast.size === h.broadcasts.length, '广播 revision 不重复');
}

H.group('8. 计时状态跨重启持久（新 store 从磁盘重读）');
{
  const h = harness();
  h.timer.command('setDuration', { sec: 300 });
  h.timer.command('start');
  h.clock.advance(sec(100));
  const r = h.restart();
  H.eq(r.t.snapshot().phases.focus, 300, '自定义时长跨重启保留');
  H.eq(r.t.snapshot().timer.running, true, '跨重启仍在计时');
  H.eq(r.t.snapshot().timer.leftSec, 200, '跨重启剩余正确');
}

H.group('9. fake 时钟注入点本身可靠（防测试自嗨）');
{
  const h = harness();
  const before = h.timer.snapshot().serverNow;
  h.clock.advance(1234);
  const after = h.timer.snapshot().serverNow;
  H.eq(after - before, 1234, 'snapshot.serverNow 完全跟随注入时钟');
  H.assert(!h.store.lastError, 'store 无写入错误');
}

H.finish();
