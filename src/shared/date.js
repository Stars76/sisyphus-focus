/* ============================================================
 * src/shared/date.js · 日期键工具（统一零填充 YYYY-MM-DD）
 * ------------------------------------------------------------
 * 旧的键是 2026-9-8（不补零），新的统一为 2026-09-08。
 * normalizeKey() 负责把旧键安全地转成新键，供迁移使用。
 * ============================================================ */
(function (global) {
  'use strict';
  var NS = global.DSH || (global.DSH = {});
  if (NS.date) {
    // Node（主进程/测试）下也 require 同一份实现
    if (typeof module !== 'undefined' && module.exports) module.exports = NS.date;
    return;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** Date -> "2026-09-08"（本地时区） */
  function dayKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /** 今日键；可传入 Date（测试注入假时钟时用），缺省取当前时间 */
  function todayKey(d) { return dayKey(d || new Date()); }

  /** "2026-09-08" -> 本地零点 Date；非法返回 null */
  function parseDayKey(key) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(key || ''));
    if (!m) return null;
    var y = +m[1], mo = +m[2], da = +m[3];
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
    var d = new Date(y, mo - 1, da);
    // 反向校验，排除 2026-02-31 这类
    if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null;
    return d;
  }

  function isValidKey(key) { return !!parseDayKey(key); }

  /** 把 2026-9-8 这类旧键补零；非法返回 null；已是新格式原样返回 */
  function normalizeKey(key) {
    var d = parseDayKey(key);
    return d ? dayKey(d) : null;
  }

  /** 是否是「旧的不补零格式」 */
  function isLegacyKey(key) {
    var s = String(key || '');
    if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) return false;
    return s !== normalizeKey(s);
  }

  function shiftDay(key, delta) {
    var d = parseDayKey(key);
    if (!d) return key;
    d.setDate(d.getDate() + delta);
    return dayKey(d);
  }

  /** "2026-09-08" -> "9月8日" */
  function dayLabel(key) {
    var d = parseDayKey(key);
    if (!d) return String(key || '');
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  var WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  function weekdayLabel(key) {
    var d = parseDayKey(key);
    return d ? WEEK[d.getDay()] : '';
  }

  /** 完整中文日期：2026年9月8日 周二 */
  function fullLabel(key) {
    var d = parseDayKey(key);
    if (!d) return String(key || '');
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + WEEK[d.getDay()];
  }

  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

  /** 两个 key 相差天数（b - a） */
  function diffDays(a, b) {
    var da = parseDayKey(a), db = parseDayKey(b);
    if (!da || !db) return NaN;
    return Math.round((db - da) / 86400000);
  }

  /** 毫秒 -> "mm:ss" 或 "h:mm:ss" */
  function fmtClock(totalSec) {
    var s = Math.max(0, Math.round(totalSec));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return h + ':' + pad2(m) + ':' + pad2(sec);
    return pad2(m) + ':' + pad2(sec);
  }

  NS.date = {
    pad2: pad2,
    dayKey: dayKey,
    todayKey: todayKey,
    parseDayKey: parseDayKey,
    isValidKey: isValidKey,
    normalizeKey: normalizeKey,
    isLegacyKey: isLegacyKey,
    shiftDay: shiftDay,
    dayLabel: dayLabel,
    weekdayLabel: weekdayLabel,
    fullLabel: fullLabel,
    daysInMonth: daysInMonth,
    diffDays: diffDays,
    fmtClock: fmtClock
  };

  // 同一实现同时以 CommonJS 导出，供主进程/测试 require（见 src/main/util.js）
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.date;
})(typeof window !== 'undefined' ? window : globalThis);
