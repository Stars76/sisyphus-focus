/* ============================================================
 * src/main/alarm.js · 任务闹钟调度器（主进程）
 * ------------------------------------------------------------
 * 职责：周期性扫描「今天」的任务闹钟（task.alarm = "HH:MM"），
 * 到点触发一次系统通知。除了任务行内的设置入口，应用别处不
 * 出现任何闹钟相关 UI——提醒的唯一载体就是这条系统通知。
 *
 * 语义约定：
 *   - 只在应用运行期间生效（托盘常驻时窗口关了也生效）；
 *     睡眠/休眠期间自然错过的时间点不补（唤醒后只对「当前时刻正好到点」响应）。
 *   - 已完成的任务不提醒；同一任务同一时刻，当天只响一次。
 *   - 数据只读不写：闹钟字段随任务保存/删除而自然消失。
 * ============================================================ */
'use strict';

const schema = require('./schema');
const ALARM_RE = schema.ALARM_RE;
const TICK_MS = 15000;   // 15 秒扫一次，到点误差 ≤15 秒

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

function createAlarm(deps) {
  const store = deps.store;
  const log = deps.log || function () { };
  const notify = deps.notify || function () { };
  const date = deps.date || require('./util');

  let timer = null;
  let fired = new Set();     // day/alarm/taskId
  let lastDay = null;

  function nowHm() {
    const d = new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function tick() {
    let state;
    try { state = store.get(schema.KEYS.STATE_V2); } catch (e) { return; }
    const day = date.todayKey();
    if (lastDay !== day) { lastDay = day; fired = new Set(); }
    const hm = nowHm();
    const dd = state && state.days && state.days[day];
    if (!dd || !Array.isArray(dd.tasks)) return;
    dd.tasks.forEach(function (t) {
      if (!t || typeof t.id !== 'string' || !t.id || !t.alarm || t.done) return;
      if (t.alarm !== hm) return;
      const key = day + '/' + t.alarm + '/' + t.id;
      if (fired.has(key)) return;
      fired.add(key);
      const title = t.title || '这件事';
      try {
        notify('⏰ 闹钟：' + title, '到点了，该做「' + title + '」了');
      } catch (e) { log('闹钟通知失败', e); }
      log('闹钟触发', t.id, t.alarm);
    });
  }

  return {
    start() {
      if (timer) return;
      lastDay = date.todayKey();
      fired = new Set();
      tick();                                     // 启动立即扫一次（进程中途重启不丢当前分钟）
      timer = setInterval(tick, TICK_MS);
      if (timer && typeof timer.unref === 'function') timer.unref();
    },
    stop() {
      if (timer) { clearInterval(timer); timer = null; }
    }
  };
}

module.exports = { createAlarm, ALARM_RE };