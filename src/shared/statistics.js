/* Pure, local-calendar summaries. Shared by rendering and regression tests. */
(function (root) {
  'use strict';
  function key(date) { return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0'); }
  function parseKey(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    var d = new Date(value + 'T12:00:00');
    return isFinite(d.getTime()) && key(d) === value ? value : null;
  }
  function completed(h) { return h && h.phase === 'focus' && (h.result === 'done' || h.result === 'recovered'); }
  function summary(history, records, period, now) {
    now = new Date(now == null ? Date.now() : now);
    var today = key(now), start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === 'month') start.setDate(1);
    else start.setDate(start.getDate() - (start.getDay() + 6) % 7);
    var since = key(start), hours = Array(24).fill(0), minutes = 0, rounds = 0, tasks = 0, active = new Set();
    (Array.isArray(history) ? history : []).forEach(function (h) {
      if (!completed(h)) return;
      var finished = new Date(h.finishedAt), day = parseKey(h.day) || (isFinite(finished.getTime()) ? key(finished) : null);
      if (!day || day > today || (isFinite(finished.getTime()) && finished > now)) return;
      active.add(day);
      if (day < since) return;
      var credited = Math.max(0, Number(h.plannedMinutes) || 0);
      minutes += credited; rounds++;
      var begun = new Date(h.startedAt), at = isFinite(begun.getTime()) ? begun : finished;
      if (isFinite(at.getTime())) hours[at.getHours()] += credited;
    });
    Object.keys(records || {}).forEach(function (day) {
      if (!parseKey(day) || day < since || day > today) return;
      var list = records[day] && records[day].tasks;
      if (Array.isArray(list)) tasks += list.filter(function (t) { return t && t.done; }).length;
    });
    var cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate()), streak = 0;
    if (!active.has(key(cursor))) cursor.setDate(cursor.getDate() - 1);
    while (active.has(key(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
    var bins = Array.from({ length: 12 }, function (_, i) { return hours[i * 2] + hours[i * 2 + 1]; });
    var peak = Math.max.apply(null, bins), peakIndex = peak > 0 ? bins.indexOf(peak) : -1;
    return { since: since, until: today, minutes: minutes, rounds: rounds, tasks: tasks, streak: streak, hours: hours, bins: bins, peakIndex: peakIndex, peak: peak };
  }
  function taskTotals(history) {
    var totals = Object.create(null);
    (Array.isArray(history) ? history : []).forEach(function (h) {
      if (!completed(h) || !h.taskId || !parseKey(h.taskDay)) return;
      var id = h.taskDay + '/' + h.taskId;
      totals[id] = (totals[id] || 0) + Math.max(0, Number(h.plannedMinutes) || 0);
    });
    return totals;
  }
  var api = { summary: summary, taskTotals: taskTotals };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { var NS = root.DSH || (root.DSH = {}); NS.statistics = api; }
})(typeof window !== 'undefined' ? window : globalThis);
