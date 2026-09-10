/* ============================================================
 * src/main/timer.js · 专注钟唯一权威状态（主进程）
 * ------------------------------------------------------------
 * 目标：整个应用只有一个计时状态，主窗内嵌视图与小窗都只是「显示端」。
 *   - 渲染进程只能发命令（start/pause/reset/setPhase/...）
 *   - 主进程计算、广播，任何窗口关闭/重开都不影响计时
 *   - 完成统计只在主进程累加一次 → 不会重复计数
 *
 * 抗时间异常：
 *   - 运行中剩余时间用「单调时钟」推算（process.uptime()，不受系统改时间影响，
 *     且包含系统休眠时长），墙上时钟 endAt 仅用于跨进程重启恢复与显示
 *   - 检测到系统时间被手动大改 → 记录 clockJump 并在 UI 提示
 *   - 跨午夜：计时继续跑，统计记在「完成那一刻」所在的日期
 * ============================================================ */
'use strict';

const PHASES = {
  focus: { key: 'focus', label: '专注', short: '专注' },
  short: { key: 'short', label: '短休息', short: '短休' },
  long: { key: 'long', label: '长休息', short: '长休' }
};

const STATE_KEY = 'sisy-timer-state';
const STATS_KEY = 'sisy-timer-stats';
const RUN_KEY = 'sisy-timer-run';
const PREFS_KEY = 'sisy-timer-prefs';
const HISTORY_KEY = 'sisy-timer-history';
const HISTORY_MAX = 300;

const DEFAULT_PREFS = {
  sound: true,
  notify: true,
  motion: 'full',          // full | calm | off
  tray: true,
  closeToTray: true,
  highContrast: false,
  showSeconds: true,
  phases: { focus: 25 * 60, short: 5 * 60, long: 15 * 60 }
};

/**
 * 多轮专注计划（番茄工作法预设）。
 * 展开后自动按「专注 → 短休 → …… → 专注 → 长休」推进，直到计划结束。
 * rounds 指专注轮数；每轮之间短休，最后一轮后接长休。
 */
const DEFAULT_PLANS = [
  { key: 'classic', name: '标准番茄', rounds: 4, focus: 25, short: 5, long: 15 },
  { key: 'deep', name: '深专注', rounds: 2, focus: 45, short: 5, long: 15 },
  { key: 'sprint', name: '短冲刺', rounds: 4, focus: 15, short: 3, long: 10 },
  { key: 'marathon', name: '长跑', rounds: 2, focus: 50, short: 10, long: 20 }
];

function expandPlan(def) {
  const steps = [];
  for (let i = 0; i < def.rounds; i++) {
    steps.push({ phase: 'focus', sec: def.focus * 60 });
    if (i < def.rounds - 1) steps.push({ phase: 'short', sec: def.short * 60 });
  }
  if (def.long) steps.push({ phase: 'long', sec: def.long * 60 });
  return steps;
}

const TICK_MS = 250;
const PERSIST_EVERY_MS = 5000;
const CLOCK_JUMP_MS = 5000;

function clamp(n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n); }
function num(v, fb) { return (typeof v === 'number' && isFinite(v)) ? v : fb; }

function createTimer(deps) {
  const store = deps.store;
  const log = deps.log || function () { };
  const date = deps.date;                     // {todayKey}
  const onBroadcast = deps.onBroadcast || function () { };
  const onEvent = deps.onEvent || function () { };
  const notify = deps.notify || function () { };

  let prefs = Object.assign({}, DEFAULT_PREFS, { phases: Object.assign({}, DEFAULT_PREFS.phases) });
  let stats = { day: date.todayKey(), rounds: 0, minutes: 0 };
  let timer = null;
  let ticker = null;
  let revision = 0;
  let lastPersist = 0;

  // 可注入的时钟（便于测试）：wall = 墙上时钟，mono = 单调时钟
  const now = deps.now || (() => Date.now());
  const mono = deps.mono || (() => process.uptime() * 1000);

  let lastWall = now();
  let lastMono = mono();
  let clockJumpAt = 0;
  let recovered = false;

  /* ---------------- 偏好 ---------------- */
  function loadPrefs() {
    // 先重建默认值再覆盖：清空偏好 / replace 导入缺 prefs 键后，缺失字段回默认
    prefs = Object.assign({}, DEFAULT_PREFS, { phases: Object.assign({}, DEFAULT_PREFS.phases) });
    const raw = store.get(PREFS_KEY);
    if (raw && typeof raw === 'object') {
      if (typeof raw.sound === 'boolean') prefs.sound = raw.sound;
      if (typeof raw.notify === 'boolean') prefs.notify = raw.notify;
      if (raw.motion === 'full' || raw.motion === 'calm' || raw.motion === 'off') prefs.motion = raw.motion;
      if (typeof raw.tray === 'boolean') prefs.tray = raw.tray;
      if (typeof raw.closeToTray === 'boolean') prefs.closeToTray = raw.closeToTray;
      if (typeof raw.highContrast === 'boolean') prefs.highContrast = raw.highContrast;
      if (typeof raw.showSeconds === 'boolean') prefs.showSeconds = raw.showSeconds;
      if (raw.phases && typeof raw.phases === 'object') {
        ['focus', 'short', 'long'].forEach((k) => {
          const v = num(raw.phases[k], NaN);
          if (isFinite(v)) prefs.phases[k] = clamp(Math.round(v), 60, 180 * 60);
        });
      }
    }
  }

  function savePrefs() {
    const r = store.set(PREFS_KEY, prefs);
    if (!r.ok) log('保存偏好失败', r.error);
  }

  function setPrefs(patch) {
    if (!patch || typeof patch !== 'object') return api.snapshot();
    ['sound', 'notify', 'tray', 'closeToTray', 'highContrast', 'showSeconds'].forEach((k) => {
      if (typeof patch[k] === 'boolean') prefs[k] = patch[k];
    });
    if (patch.motion === 'full' || patch.motion === 'calm' || patch.motion === 'off') prefs.motion = patch.motion;
    if (patch.phases && typeof patch.phases === 'object') {
      ['focus', 'short', 'long'].forEach((k) => {
        const v = num(patch.phases[k], NaN);
        if (isFinite(v)) prefs.phases[k] = clamp(Math.round(v), 60, 180 * 60);
      });
    }
    savePrefs();
    // 未开始的当前阶段要跟着新时长走
    if (timer && !timer.running && !timer.startedAt) {
      timer.totalSec = prefs.phases[timer.phase] || timer.totalSec;
      timer.leftMs = timer.totalSec * 1000;
      persist(true);
    }
    broadcast();
    return api.snapshot();
  }

  /* ---------------- 统计 ---------------- */
  function loadStats() {
    const raw = store.get(STATS_KEY);
    if (raw && typeof raw === 'object' && typeof raw.rounds === 'number') {
      // 旧版本的日期键不补零（2026-9-8），必须先规范化，否则会被误判成「昨天」而清零
      const rawDay = (typeof raw.day === 'string') ? raw.day : '';
      const fixedDay = (typeof date.normalizeKey === 'function') ? date.normalizeKey(rawDay) : rawDay;
      stats = {
        day: fixedDay || date.todayKey(),
        rounds: Math.max(0, Math.round(raw.rounds)),
        minutes: Math.max(0, Math.round(num(raw.minutes, 0)))
      };
      if (fixedDay && fixedDay !== rawDay) {
        log('统计日期键规范化 ' + rawDay + ' -> ' + fixedDay);
        persistStats();
      }
    } else {
      // 无键 / 非法键：重建今日默认（清空 stats 分区 / replace 导入缺键后恢复 0）。
      // 不写回：清空后的“键不存在”语义保留，仅内存权威即时归零。
      stats = { day: date.todayKey(), rounds: 0, minutes: 0 };
    }
    // 跨日重置：统计归零真实落盘，再落计时状态（若 timer 已加载）
    if (stats.day !== date.todayKey()) {
      stats = { day: date.todayKey(), rounds: 0, minutes: 0 };
      persistStats();
      if (timer) persist(true);
    }
  }

  function rollDayIfNeeded(silent) {
    const today = date.todayKey();
    if (stats.day === today) return false;
    const prev = stats.day;
    stats = { day: today, rounds: 0, minutes: 0 };
    if (!silent) {
      log('跨天，专注统计已重置（' + prev + ' -> ' + today + '）');
      onEvent({ type: 'day-rollover', day: today, prev });
    }
    persistStats();
    if (timer) persist(true);
    return true;
  }

  /* ---------------- 状态 ---------------- */
  function newTimer(phase) {
    phase = PHASES[phase] ? phase : 'focus';
    const totalSec = prefs.phases[phase] || DEFAULT_PREFS.phases[phase];
    return {
      phase: phase,
      totalSec: totalSec,
      leftMs: totalSec * 1000,
      running: false,
      endAt: 0,
      startMono: 0,
      leftAtStartMs: totalSec * 1000,
      startedAt: null,          // 本轮墙上时钟开始（ISO）
      pauseCount: 0,
      pausedMs: 0,
      pauseStartedAt: 0,
      round: stats.rounds + 1,  // 当前是今日第几轮（专注阶段）
      abandoned: false,
      recovered: false,
      task: null,
      plan: null,
      awaitPlan: false
    };
  }

  function loadState() {
    const raw = store.get(STATE_KEY);
    if (!raw || typeof raw !== 'object' || !PHASES[raw.phase]) { timer = newTimer('focus'); return; }
    const t = newTimer(raw.phase);
    t.totalSec = clamp(Math.round(num(raw.totalSec, t.totalSec)), 1, 180 * 60);
    t.pauseCount = Math.max(0, Math.round(num(raw.pauseCount, 0)));
    t.pausedMs = Math.max(0, Math.round(num(raw.pausedMs, 0)));
    t.pauseStartedAt = 0;
    t.startedAt = (typeof raw.startedAt === 'string') ? raw.startedAt : null;
    t.task = raw.phase === 'focus' && t.startedAt && raw.task ? Object.assign({}, raw.task) : null;
    // 恢复多轮计划（schema 已校验形状）
    if (raw.plan && Array.isArray(raw.plan.steps) && raw.plan.steps.length) {
      t.plan = {
        key: raw.plan.key,
        name: raw.plan.name,
        steps: raw.plan.steps.map(function (s) { return { phase: s.phase, sec: s.sec }; }),
        index: Math.min(Math.max(0, raw.plan.index | 0), raw.plan.steps.length - 1)
      };
    }
    t.abandoned = !!raw.abandoned;
    t.round = Math.max(1, Math.round(num(raw.round, stats.rounds + 1)));

    // R6：暂停中的轮次恢复「暂停起点」；resume 时把起点到恢复的间隔计入 pausedMs，
    // 因此退出前已发生的暂停能跨重启保留，且不会重复入账。
    if (!raw.running && t.startedAt && typeof raw.pauseStartedAt === 'number' && isFinite(raw.pauseStartedAt) && raw.pauseStartedAt > 0) {
      t.pauseStartedAt = clamp(raw.pauseStartedAt, 0, now());
    }

    if (raw.running && num(raw.endAt, 0) > 0) {
      // 重启恢复：用墙上时钟推算剩余（单调时钟已随进程重启失效）
      const remainMs = raw.endAt - now();
      if (remainMs <= 0) {
        // 关闭期间已到点 → 静默补记完成（不响铃/不通知）
        t.running = false;
        t.leftMs = 0;
        timer = t;
        complete(true);
        return;
      }
      t.running = true;
      t.endAt = raw.endAt;
      t.leftMs = clamp(remainMs, 0, t.totalSec * 1000);
      t.startMono = mono();
      t.leftAtStartMs = t.leftMs;
      t.recovered = true;
      log('恢复运行中的计时：剩余 ' + Math.round(t.leftMs / 1000) + 's');
    } else {
      t.running = false;
      t.leftMs = clamp(Math.round(num(raw.leftMs, t.totalSec * 1000)), 0, t.totalSec * 1000);
      if (t.leftMs <= 0) t.leftMs = t.totalSec * 1000;
    }
    timer = t;
  }

  function persist(force) {
    const t0 = now();
    if (!force && t0 - lastPersist < PERSIST_EVERY_MS) return;
    lastPersist = t0;
    const t = timer;
    const r = store.set(STATE_KEY, {
      phase: t.phase, totalSec: t.totalSec, leftMs: Math.round(t.leftMs),
      running: t.running, endAt: t.running ? t.endAt : 0,
      startedAt: t.startedAt, pauseCount: t.pauseCount, pausedMs: Math.round(t.pausedMs),
      pauseStartedAt: t.pauseStartedAt || 0,
      round: t.round, abandoned: t.abandoned, updatedAt: new Date(t0).toISOString(),
      task: t.task,
      plan: t.plan
    });
    if (!r.ok) log('保存计时状态失败', r.error);
    // 兼容旧版本读取
    store.set(RUN_KEY, t.running
      ? { totalSec: t.totalSec, running: true, endAt: t.endAt }
      : { totalSec: t.totalSec, running: false, leftSec: Math.round(t.leftMs / 1000) });
  }

  function persistStats() {
    const r = store.set(STATS_KEY, { day: stats.day, rounds: stats.rounds, minutes: stats.minutes, updatedAt: new Date(now()).toISOString() });
    if (!r.ok) log('保存统计失败', r.error);
  }

  /** 中断记录：本轮开始时间 / 暂停次数 / 总暂停时间 / 完成或放弃 */
  function appendHistory(entry) {
    let list = store.get(HISTORY_KEY);
    if (!Array.isArray(list)) list = [];
    list.push(entry);
    if (list.length > HISTORY_MAX) list = list.slice(list.length - HISTORY_MAX);
    const r = store.set(HISTORY_KEY, list);
    if (!r.ok) log('保存专注历史失败', r.error);
  }

  function broadcast() {
    revision++;
    onBroadcast(api.snapshot());
  }

  /**
   * 轻量 tick：整秒倒计时推进时只广播 leftSec/leftMs/progress 三个字段，
   * 状态切换（开始/暂停/完成/设置变化）仍走完整 snapshot 的 broadcast()。
   * 渲染端收到 { tick: true, revision, timer: {...} } 后合并进本地缓存。
   */
  function broadcastTick() {
    revision++;
    const t = timer;
    onBroadcast({
      tick: true,
      revision: revision,
      timer: {
        leftSec: Math.ceil(currentLeftMs() / 1000),
        leftMs: Math.round(currentLeftMs()),
        progress: t.totalSec > 0 ? clamp(1 - currentLeftMs() / (t.totalSec * 1000), 0, 1) : 0
      }
    });
  }

  function setRunning(on) {
    const t = timer;
    if (on === t.running) return;
    if (on) {
      t.awaitPlan = false;                 // 一开跑就摘掉「等待选计划」标记
      if (!t.startedAt) t.startedAt = new Date(now()).toISOString();
      if (t.leftMs <= 0) t.leftMs = t.totalSec * 1000;
      t.startMono = mono();
      t.leftAtStartMs = t.leftMs;
      t.endAt = now() + t.leftMs;
      t.running = true;
      if (t.pauseStartedAt) {
        t.pausedMs += now() - t.pauseStartedAt;
        t.pauseStartedAt = 0;
      }
      t.recovered = false;
    } else {
      t.leftMs = currentLeftMs();
      t.running = false;
      t.endAt = 0;
      if (t.startedAt) {
        t.pauseCount += 1;
        t.pauseStartedAt = now();
      }
    }
    persist(true);
    broadcast();
  }

  /** 运行中的剩余毫秒：优先单调时钟（抗改表/含休眠） */
  function currentLeftMs() {
    const t = timer;
    if (!t.running) return Math.max(0, t.leftMs);
    let left = t.leftAtStartMs - (mono() - t.startMono);
    if (!isFinite(left)) left = t.endAt - now();
    // 单调时钟异常（比如系统休眠后 uptime 行为差异）时退回墙上时钟
    if (left < -60000) left = t.endAt - now();
    return clamp(left, 0, t.totalSec * 1000);
  }

  /* ---------------- 完成 ---------------- */
  let finishing = false;   // 完成重入保护：事件 / 统计 / 历史各只发生一次
  function complete(silent) {
    if (finishing) { reject('complete', '重入被拦截'); return; }
    finishing = true;
    try {
    const t = timer;
    const finishedAt = new Date(now());
    t.running = false;
    t.endAt = 0;
    if (t.pauseStartedAt) { t.pausedMs += finishedAt.getTime() - t.pauseStartedAt; t.pauseStartedAt = 0; }

    const plannedSec = t.totalSec;
    const actualMs = t.startedAt ? (finishedAt.getTime() - new Date(t.startedAt).getTime()) : plannedSec * 1000;
    const phase = t.phase;
    const activeTask = t.task;
    let credited = 0;

    if (phase === 'focus') {
      rollDayIfNeeded(true);
      credited = Math.round(plannedSec / 60);
      stats.rounds += 1;
      stats.minutes += credited;
      persistStats();
    }

    const payload = {
      type: 'done',
      phase: phase,
      silent: !!silent,
      minutes: credited,
      plannedMinutes: Math.round(plannedSec / 60),
      actualMinutes: Math.max(1, Math.round(actualMs / 60000)),
      actualMs: actualMs,
      round: stats.rounds,
      rounds: stats.rounds,
      minutesToday: stats.minutes,
      pauseCount: t.pauseCount,
      pausedMs: Math.round(t.pausedMs),
      startedAt: t.startedAt,
      finishedAt: finishedAt.toISOString(),
      day: stats.day
      ,taskId: activeTask && activeTask.id
      ,taskTitle: activeTask && activeTask.title
    };

    // 多轮计划：还有下一段就自动推进（番茄法连循环自动跑到底）
    const plan = timer.plan;
    const advancing = !silent && plan && plan.index + 1 < plan.steps.length;
    if (advancing) {
      const nextIndex = plan.index + 1;
      const step = plan.steps[nextIndex];
      const nt = newTimer(step.phase);
      nt.totalSec = step.sec;
      nt.leftMs = step.sec * 1000;
      nt.plan = { key: plan.key, name: plan.name, steps: plan.steps, index: nextIndex };
      nt.task = activeTask;
      nt.round = stats.rounds + 1;
      nt.startedAt = new Date(now()).toISOString();
      nt.startMono = mono(); nt.leftAtStartMs = nt.leftMs; nt.endAt = now() + nt.leftMs; nt.running = true;
      timer = nt;
      persist(true);
      appendHistory({
        day: payload.day, phase: phase, startedAt: payload.startedAt, finishedAt: payload.finishedAt,
        plannedMinutes: payload.plannedMinutes, actualMinutes: payload.actualMinutes,
        pauseCount: payload.pauseCount, pausedMinutes: Math.round(payload.pausedMs / 60000),
        result: 'done', taskId: activeTask && activeTask.id,
        taskDay: activeTask && activeTask.day, taskTitle: activeTask && activeTask.title
      });
      broadcast();
      onEvent({ type: 'plan-advance', name: plan.name, index: nextIndex, total: plan.steps.length, phase: step.phase, minutes: Math.round(step.sec / 60) });
      if (prefs.notify) {
        notify(step.phase === 'focus' ? '🔔 该专注了' : '☕ 休息一下',
          plan.name + ' · ' + (nextIndex + 1) + '/' + plan.steps.length + ' · ' + (step.phase === 'focus' ? '专注' : '休息') + ' ' + Math.round(step.sec / 60) + ' 分钟');
      }
      log('计划自动推进', plan.name, (nextIndex + 1) + '/' + plan.steps.length, step.phase);
      return;
    }

    // 计划完成（最后一轮 / 单段模式）：回到未开始状态，清掉计划
    const keepPhase = phase;
    timer = newTimer(keepPhase);
    timer.plan = null;
    timer.round = stats.rounds + 1;
    persist(true);
    appendHistory({
      day: payload.day,
      phase: phase,
      startedAt: payload.startedAt,
      finishedAt: payload.finishedAt,
      plannedMinutes: payload.plannedMinutes,
      actualMinutes: payload.actualMinutes,
      pauseCount: payload.pauseCount,
      pausedMinutes: Math.round(payload.pausedMs / 60000),
      result: silent ? 'recovered' : 'done', taskId: activeTask && activeTask.id,
      taskDay: activeTask && activeTask.day, taskTitle: activeTask && activeTask.title
    });
    broadcast();
    onEvent(payload);

    if (!silent) {
      if (prefs.notify) {
        const title = phase === 'focus' ? '🎉 专注完成' : '☕ 休息结束';
        const body = phase === 'focus'
          ? ('本轮 ' + payload.plannedMinutes + ' 分钟 · 今日第 ' + stats.rounds + ' 轮 · 累计 ' + stats.minutes + ' 分钟')
          : ('该回到专注了 · 今日已专注 ' + stats.minutes + ' 分钟');
        notify(title, body);
      }
    }
    log('阶段完成', phase, '计划', payload.plannedMinutes + 'min', '实际', payload.actualMinutes + 'min',
      '暂停', payload.pauseCount + '次', silent ? '(静默补记)' : '');
    } finally {
      finishing = false;
    }
  }

  /* ---------------- 放弃 ---------------- */
  let abandoning = false;   // 放弃重入保护：历史 / 事件各只发生一次
  function abandon() {
    if (abandoning) { reject('abandon', '重入被拦截'); return; }
    abandoning = true;
    try {
    const t = timer;
    const phase = t.phase;
    const activeTask = t.task;
    const plannedMin = Math.round(t.totalSec / 60);
    const actualMs = t.startedAt ? (now() - new Date(t.startedAt).getTime()) : 0;
    const payload = {
      type: 'abandoned',
      phase: phase,
      plannedMinutes: plannedMin,
      actualMinutes: Math.max(0, Math.round(actualMs / 60000)),
      pauseCount: t.pauseCount,
      pausedMs: Math.round(t.pausedMs),
      startedAt: t.startedAt,
      abandonedAt: new Date(now()).toISOString()
      ,taskId: activeTask && activeTask.id
      ,taskTitle: activeTask && activeTask.title
    };
    log('放弃本轮', phase, plannedMin + 'min');
    timer = newTimer(phase);
    timer.plan = null;
    timer.round = stats.rounds + 1;
    persist(true);
    appendHistory({
      day: date.todayKey(),
      phase: phase,
      startedAt: payload.startedAt,
      finishedAt: payload.abandonedAt,
      plannedMinutes: plannedMin,
      actualMinutes: payload.actualMinutes,
      pauseCount: payload.pauseCount,
      pausedMinutes: Math.round(payload.pausedMs / 60000),
      result: 'abandoned', taskId: activeTask && activeTask.id,
      taskDay: activeTask && activeTask.day, taskTitle: activeTask && activeTask.title
    });
    broadcast();
    onEvent(payload);
    } finally {
      abandoning = false;
    }
  }

  /* ---------------- 状态机（显式转换约束） ---------------- */
  /** 当前语义状态：idle(未开始) / running(计时中) / paused(暂停中) */
  function stateOf(t) { return t.running ? 'running' : (t.startedAt ? 'paused' : 'idle'); }

  const TRANSITIONS = {
    start: ['idle', 'paused'],        // 只允许从未开始或暂停中开始
    pause: ['running'],               // 只允许从计时中暂停
    toggle: ['idle', 'running', 'paused'],
    reset: ['idle', 'running', 'paused'],
    setPhase: ['idle', 'running', 'paused'],   // running/paused 中切阶段 = 先记一次放弃
    setDuration: ['idle', 'running', 'paused'],// 同上
    applyPlan: ['idle', 'running', 'paused'],  // 同上：切换多轮计划
    abandon: ['running', 'paused'],   // 只有开始过的轮次能放弃
    resetToday: ['idle', 'running', 'paused'],
    refresh: ['idle', 'running', 'paused']
  };

  let lastRejection = null;
  let rejecting = false;   // 防止 reject -> broadcast 递归

  function reject(command, reason) {
    lastRejection = { command: String(command).slice(0, 32), reason: String(reason).slice(0, 120), at: new Date(now()).toISOString(), from: timer ? stateOf(timer) : 'none' };
    log('拒绝非法状态转换 ' + lastRejection.command + ' @ ' + lastRejection.from + '：' + lastRejection.reason);
    return false;
  }

  function canRun(command) {
    const allow = TRANSITIONS[command];
    if (!allow) return reject(command, '未知命令');
    if (allow.indexOf(stateOf(timer)) === -1) return reject(command, '当前状态=' + stateOf(timer) + ' 允许=' + allow.join('/'));
    return true;
  }

  /* ---------------- 命令 ---------------- */
  const commands = {
    start() { if (!canRun('start')) return; setRunning(true); },
    pause() { if (!canRun('pause')) return; setRunning(false); },
    toggle() { if (!canRun('toggle')) return; setRunning(!timer.running); },
    reset() {
      if (!canRun('reset')) return;
      const t = timer;
      // 开始过又重置 = 本轮被丢弃；历史里留下一条 abandoned，统计不加
      if (t.startedAt && !rejecting) {
        rejecting = true;
        try { abandon(); } finally { rejecting = false; }
      }
      const fresh = timer;   // abandon() 可能已换成新 timer
      fresh.running = false;
      fresh.endAt = 0;
      fresh.leftMs = fresh.totalSec * 1000;
      fresh.startedAt = null;
      fresh.task = null;
      fresh.pauseCount = 0;
      fresh.pausedMs = 0;
      fresh.pauseStartedAt = 0;
      fresh.abandoned = false;
      fresh.recovered = false;
      fresh.plan = null;
      fresh.awaitPlan = false;
      persist(true);
      broadcast();
    },
    /** 切换阶段：focus / short / long（不自动开始；进行中的轮次记为放弃） */
    setPhase(payload) {
      if (!canRun('setPhase')) return;
      const phase = payload && payload.phase;
      if (!PHASES[phase]) { reject('setPhase', '未知阶段 ' + String(phase).slice(0, 16)); return; }
      if (timer.phase === phase && !timer.startedAt) return;   // 已是该阶段且未开始：幂等
      if ((timer.running || timer.startedAt) && !rejecting) {
        rejecting = true;
        try { abandon(); } finally { rejecting = false; }
      }
      timer = newTimer(phase);
      timer.plan = null;
      timer.round = stats.rounds + 1;
      persist(true);
      broadcast();
      onEvent({ type: 'phase-changed', phase: phase, totalSec: timer.totalSec });
    },
    /** 自定义时长（秒）——只作用于专注阶段；进行中的专注轮记为放弃 */
    setDuration(payload) {
      if (!canRun('setDuration')) return;
      const raw = payload && payload.sec;
      if (typeof raw !== 'number' || !isFinite(raw)) { reject('setDuration', 'sec 非数字'); return; }
      const sec = clamp(Math.round(raw), 60, 180 * 60);
      prefs.phases.focus = sec;
      savePrefs();
      if (timer.phase === 'focus') {
        if ((timer.running || timer.startedAt) && !rejecting) {
          rejecting = true;
          try { abandon(); } finally { rejecting = false; }
        }
        timer = newTimer('focus');
        timer.totalSec = sec;
        timer.leftMs = sec * 1000;
        timer.plan = null;
        timer.round = stats.rounds + 1;
      }
      persist(true);
      broadcast();
    },
    /** 应用一个多轮计划（番茄法预设）：整段队列待跑，不自动开始（点「开始」开跑） */
    applyPlan(payload) {
      if (!canRun('applyPlan')) return;
      const key = payload && payload.plan;
      const def = DEFAULT_PLANS.find((p) => p.key === key);
      if (!def) { reject('applyPlan', '未知计划 ' + String(key).slice(0, 20)); return; }
      if ((timer.running || timer.startedAt) && !rejecting) {
        rejecting = true;
        try { abandon(); } finally { rejecting = false; }
      }
      const steps = expandPlan(def);
      timer = newTimer(steps[0].phase);
      timer.totalSec = steps[0].sec;
      timer.leftMs = steps[0].sec * 1000;
      timer.plan = { key: def.key, name: def.name, steps: steps, index: 0 };
      timer.awaitPlan = false;             // 用户从选择器选定计划后不再自动弹
      timer.round = stats.rounds + 1;
      persist(true);
      broadcast();
      onEvent({ type: 'plan-set', key: def.key, name: def.name, steps: steps.length });
    },
    /** 放弃本轮（不计入统计） */
    abandon() {
      if (!canRun('abandon')) return;
      abandon();
    },
    /** 结束今天：重置今日统计（需确认，由 UI 负责） */
    resetToday() {
      if (!canRun('resetToday')) return;
      stats = { day: date.todayKey(), rounds: 0, minutes: 0 };
      persistStats();
      timer.round = 1;
      persist(true);
      broadcast();
      log('已结束今天，今日统计清零');
    },
    /** 强制刷新（休眠恢复等） */
    refresh() { tick(); }
  };

  /* ---------------- 心跳 ---------------- */
  function tick() {
    const t = timer;
    const wall = now();
    const m = mono();
    const drift = (wall - lastWall) - (m - lastMono);
    if (Math.abs(drift) > CLOCK_JUMP_MS) {
      clockJumpAt = wall;
      log('检测到系统时间跳变 ' + Math.round(drift) + 'ms' + (t.running ? '（已用单调时钟校正）' : ''));
      if (t.running) {
        // 用单调时钟重算剩余，再对齐墙上时钟
        t.leftMs = currentLeftMs();
        t.startMono = m;
        t.leftAtStartMs = t.leftMs;
        t.endAt = wall + t.leftMs;
      }
      broadcast();
    }
    lastWall = wall;
    lastMono = m;

    rollDayIfNeeded(false);

    if (!t.running) return;
    const prevSec = Math.ceil(t.leftMs / 1000);
    const left = currentLeftMs();
    t.leftMs = left;
    t.endAt = wall + left;
    const nowSec = Math.ceil(left / 1000);
    if (nowSec !== prevSec) {
      broadcastTick();
      persist(false);
    }
    if (left <= 0) complete(false);
  }

  function startTicker() {
    if (ticker) return;
    ticker = setInterval(tick, TICK_MS);
    if (ticker && typeof ticker.unref === 'function') ticker.unref();
  }
  function stopTicker() {
    if (ticker) { clearInterval(ticker); ticker = null; }
  }

  /* ---------------- 对外 ---------------- */
  const api = {
    PHASES,
    init() {
      loadPrefs();
      loadStats();
      loadState();
      // The earlier loose context key is never allowed to reassign an active round.
      store.remove('sisy-active-task');
      lastWall = now();
      lastMono = mono();
      startTicker();
      broadcast();
      return api.snapshot();
    },
    snapshot() {
      const t = timer;
      return {
        revision: revision,
        serverNow: now(),
        clockJumpAt: clockJumpAt,
        smState: stateOf(t),
        lastRejection: lastRejection ? Object.assign({}, lastRejection) : null,
        phases: { focus: prefs.phases.focus, short: prefs.phases.short, long: prefs.phases.long },
        prefs: {
          sound: prefs.sound, notify: prefs.notify, motion: prefs.motion,
          tray: prefs.tray, closeToTray: prefs.closeToTray,
          highContrast: prefs.highContrast, showSeconds: prefs.showSeconds
        },
        stats: { day: stats.day, rounds: stats.rounds, minutes: stats.minutes },
        timer: {
          phase: t.phase,
          phaseLabel: PHASES[t.phase].label,
          totalSec: t.totalSec,
          leftSec: Math.ceil(currentLeftMs() / 1000),
          leftMs: Math.round(currentLeftMs()),
          running: t.running,
          startedAt: t.startedAt,
          pauseCount: t.pauseCount,
          pausedMs: Math.round(t.pausedMs),
          paused: !t.running && !!t.startedAt,
          idle: !t.running && !t.startedAt,
          round: t.round,
          abandoned: t.abandoned,
          recovered: t.recovered,
          task: t.task ? Object.assign({}, t.task) : null,
          awaitPlan: !!t.awaitPlan,
          plan: t.plan ? { name: t.plan.name, key: t.plan.key, index: t.plan.index, total: t.plan.steps.length, rounds: t.plan.steps.filter(function (s) { return s.phase === 'focus'; }).length } : null,
          progress: t.totalSec > 0 ? clamp(1 - currentLeftMs() / (t.totalSec * 1000), 0, 1) : 0
        }
      };
    },
    command(type, payload) {
      const fn = commands[type];
      if (!fn) { reject(type || 'unknown', '未知计时命令'); return api.snapshot(); }
      try { fn(payload || {}); }
      catch (e) { log('计时命令异常 ' + type, e); reject(type, '命令异常: ' + ((e && e.message) || e).slice(0, 80)); }
      return api.snapshot();
    },
    /** One serialized operation: resolve the real task, bind and start (or resume the same task).
     *  opts.noStart = true：只绑定任务、进入待开始状态并广播 await-plan（任务侧弹计划选择器），不自动开跑。 */
    startTask(ref, opts) {
      if (!ref || typeof ref.id !== 'string' || !ref.id || ref.id.length > 128 || typeof ref.day !== 'string' || ref.day !== date.todayKey()) {
        return { ok: false, error: '请选择今天的有效任务。' };
      }
      const data = store.get('sisy-focus-state-v2');
      const day = data && data.days && data.days[ref.day];
      const target = day && Array.isArray(day.tasks) && day.tasks.find(t => t.id === ref.id);
      if (!target || target.done) return { ok: false, error: '任务不存在或已完成，请刷新任务列表。' };
      const noStart = !!(opts && opts.noStart);
      if (timer.startedAt) {
        const same = timer.phase === 'focus' && timer.task && timer.task.id === ref.id && timer.task.day === ref.day;
        if (!same) return { ok: false, code: 'timer-busy', error: '当前轮次尚未结束。请在专注钟中完成或重置本轮，再切换任务。' };
        if (noStart) return { ok: true, snapshot: api.snapshot() };
        if (!timer.running) setRunning(true);
        return { ok: true, snapshot: api.snapshot() };
      }
      if (timer.phase !== 'focus') timer = newTimer('focus');
      timer.task = { id: target.id, day: ref.day, title: target.title.slice(0, 500) };
      timer.plan = null;
      timer.awaitPlan = !!noStart;
      persist(true);
      broadcast();
      if (noStart) {
        onEvent({ type: 'await-plan', task: { id: target.id, day: ref.day, title: target.title.slice(0, 500) } });
        return { ok: true, noStart: true, snapshot: api.snapshot() };
      }
      setRunning(true);
      return { ok: true, snapshot: api.snapshot() };
    },
    setPrefs: setPrefs,
    getPrefs() { return JSON.parse(JSON.stringify(prefs)); },
    getStats() { return Object.assign({}, stats); },
    getHistory() {
      const list = store.get(HISTORY_KEY);
      return Array.isArray(list) ? list.slice() : [];
    },
    pauseTicker: stopTicker,
    resumeTicker() { startTicker(); tick(); },
    flush() { persist(true); }
  };

  return api;
}

module.exports = { createTimer, PHASES, DEFAULT_PLANS, expandPlan, STATE_KEY, STATS_KEY, RUN_KEY, PREFS_KEY };
