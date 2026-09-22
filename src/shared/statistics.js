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
      var mins = Math.max(0, Number(h.plannedMinutes) || 0);
      totals[h.taskDay + '/' + h.taskId] = (totals[h.taskDay + '/' + h.taskId] || 0) + mins;
      totals[h.taskId] = (totals[h.taskId] || 0) + mins;   // 跨日聚合：任务顺延后仍能看到累计分钟
    });
    return totals;
  }

  /* ---------------- 每日时间轴 ---------------- */
  var MERGE_GAP_MS = 15 * 60 * 1000;   // 同任务相邻段间隔 ≤15 分钟（含计划内休息）合并为一个时段
  function toMin(hhmm) {
    if (typeof hhmm !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) return null;
    return (+hhmm.slice(0, 2)) * 60 + (+hhmm.slice(3, 5));
  }
  function toHhmm(min) {
    min = Math.max(0, Math.min(1440, Math.round(min)));
    var h = Math.floor(min / 60), m = min % 60;
    return (h === 24) ? '24:00' : String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  function startOf(h) {
    var begun = new Date(h.startedAt), fin = new Date(h.finishedAt);
    if (isFinite(begun.getTime())) return begun;
    if (isFinite(fin.getTime())) return new Date(fin.getTime() - (Math.max(0, Number(h.actualMinutes) || 0) * 60000));
    return null;
  }

  /** 某日时间轴：派生块（同任务相邻段合并、abandoned 独立、未绑定任务独立）+ 时间轴修正层。纯函数。 */
  function dayTimeline(history, day, overrides) {
    if (!parseKey(day)) return [];
    var segs = [];
    (Array.isArray(history) ? history : []).forEach(function (h) {
      if (!h || h.day !== day) return;
      var fin = new Date(h.finishedAt);
      if (!isFinite(fin.getTime())) return;
      segs.push({ h: h, start: startOf(h) || fin, end: fin });
    });
    segs.sort(function (a, b) { return a.start - b.start || a.end - b.end; });

    var blocks = [];
    var open = null;   // 正在合并的块
    function flush() { if (open) { blocks.push(open); open = null; } }
    segs.forEach(function (s) {
      var h = s.h;
      var focus = h.phase === 'focus';
      var merged = !!h.taskId && h.result !== 'abandoned';
      if (!merged) {
        flush();
        blocks.push(makeBlock(h, s.start, s.end, focus));
        return;
      }
      if (open && open.taskId === h.taskId && (s.start - open._end) <= MERGE_GAP_MS && (s.start - open._end) >= 0) {
        open._end = s.end;
        var m = blockMin(s.start, s.end);
        if (m.endMin > open.endMin) open.endMin = m.endMin;
        if (focus) { open.segments += 1; open.minutes += mins(h); }
      } else {
        flush();
        open = makeBlock(h, s.start, s.end, focus);
        open._end = s.end;
      }
    });
    flush();
    // 纯休息合并块（无 focus 段）不构成「做了什么」
    blocks = blocks.filter(function (b) { return b.segments > 0; });
    return applyTimelineOverrides(blocks, overrides || null, day);
  }

  function mins(h) { return Math.max(0, Number(h.plannedMinutes) || 0); }

  function blockMin(start, end) {
    var sm = start.getHours() * 60 + start.getMinutes();
    var em = end.getHours() * 60 + end.getMinutes() + (end > start && end.getDate() !== start.getDate() ? 1440 : 0);
    return { startMin: sm, endMin: Math.min(1440, Math.max(sm + 1, em)) };
  }

  function makeBlock(h, start, end, focus) {
    var day = parseKey(h.day) || key(end);
    var m = blockMin(start, end);
    return {
      key: day + '|' + (h.taskId || '~') + '|' + (h.startedAt || h.finishedAt),
      taskId: h.taskId || null,
      taskDay: parseKey(h.taskDay) || null,
      title: h.taskTitle || (h.taskId ? '（未命名任务）' : '未定任务的专注'),
      result: h.result || 'done',
      segments: focus ? 1 : 0,
      minutes: focus ? mins(h) : 0,
      startMin: m.startMin,
      endMin: m.endMin,
      edited: false
    };
  }

  /** 应用时间轴修正层：edits 改起止/隐藏派生块，manual 追加补录块；输出按起始排序（含重叠，分列由 layoutTimeline 处理） */
  function applyTimelineOverrides(blocks, overrides, day) {
    var out = blocks.slice();
    if (overrides && Array.isArray(overrides.edits)) {
      overrides.edits.forEach(function (e) {
        if (!e || !e.key) return;
        out = out.map(function (b) {
          if (b.key !== e.key) return b;
          var nb = Object.assign({}, b);
          if (e.start != null && toMin(e.start) != null) { nb.startMin = toMin(e.start); nb.edited = true; }
          if (e.end != null && toMin(e.end) != null) { nb.endMin = Math.max(toMin(e.end), nb.startMin + 1); nb.edited = true; }
          if (e.hidden) nb.hidden = true;
          return nb;
        });
      });
    }
    if (overrides && Array.isArray(overrides.manual)) {
      overrides.manual.forEach(function (m) {
        if (!m || m.day !== day) return;
        var s = toMin(m.start), e = toMin(m.end);
        if (s == null || e == null || e <= s) return;
        out.push({
          key: 'manual|' + m.id, id: m.id, taskId: null, taskDay: null,
          title: m.title || '手动补录', result: 'manual', segments: 1,
          minutes: e - s, startMin: s, endMin: e, edited: false
        });
      });
    }
    return out.filter(function (b) { return !b.hidden; })
      .sort(function (a, b) { return a.startMin - b.startMin || a.endMin - b.endMin; });
  }

  /** 重叠块并排分列：返回带 col/cols 的浅拷贝数组（日历事件式布局） */
  function layoutTimeline(blocks) {
    var list = (blocks || []).map(function (b) { return Object.assign({}, b); });
    var cluster = [], clusterEnd = -1, cols = [];
    function flushCluster() {
      cluster.forEach(function (b) { b.cols = Math.max(1, cols.length); });
      cluster = []; cols = []; clusterEnd = -1;
    }
    list.forEach(function (b) {
      if (cluster.length && b.startMin >= clusterEnd) flushCluster();
      var placed = false;
      for (var i = 0; i < cols.length; i++) {
        if (cols[i] <= b.startMin) { cols[i] = b.endMin; b.col = i; placed = true; break; }
      }
      if (!placed) { b.col = cols.length; cols.push(b.endMin); }
      cluster.push(b);
      clusterEnd = Math.max(clusterEnd, b.endMin);
    });
    flushCluster();
    return list;
  }

  var api = { summary: summary, taskTotals: taskTotals, dayTimeline: dayTimeline, applyTimelineOverrides: applyTimelineOverrides, layoutTimeline: layoutTimeline, toMin: toMin, toHhmm: toHhmm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { var NS = root.DSH || (root.DSH = {}); NS.statistics = api; }
})(typeof window !== 'undefined' ? window : globalThis);
