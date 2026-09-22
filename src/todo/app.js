/* ============================================================
 * src/todo/app.js · 今日事装配与交互
 * ------------------------------------------------------------
 * 事件全部用委托，渲染交给 render.js，数据交给 state.js。
 * ============================================================ */
(function (global) {
  'use strict';
  var NS = global.DSH || (global.DSH = {});
  var log = NS.log;
  var date = NS.date;
  var store = NS.store;

  function boot() {
    var root = document.getElementById('todo-app');
    if (!root || root.dataset.booted === '1') return;
    root.dataset.booted = '1';

    store.init();

    var state = NS.todo.createState({ store: store, date: date, log: log }).init();
    var render = NS.todo.createRender({ state: state, date: date });
    var el = render.el;

    function refresh() {
      var focused = document.activeElement;
      var row = focused && focused.closest('.todo-item');
      var taskId = row && row.dataset.id;
      var act = focused && focused.dataset.act;
      var sid = focused && focused.dataset.sid;
      render.render();
      if (taskId) {
        var next = Array.from(el.taskList.querySelectorAll('[data-act]')).find(function (node) {
          var item = node.closest('.todo-item');
          return item && item.dataset.id === taskId && node.dataset.act === act && node.dataset.sid === sid;
        });
        (next || el.addInput).focus();
      }
    }
    el.filterBtn.addEventListener('click', function () { render.setOnlyOpen(!render.onlyOpen); refresh(); });
    var draggedTaskId = null;
    function clearDrag() { draggedTaskId = null; el.taskList.querySelectorAll('.drop-before,.drop-after').forEach(function (n) { n.classList.remove('drop-before', 'drop-after'); }); }
    el.taskList.addEventListener('dragstart', function (ev) {
      var handle = ev.target.closest('.drag-handle'), li = handle && handle.closest('.todo-item');
      if (!li || !state.isToday()) { ev.preventDefault(); return; }
      draggedTaskId = li.dataset.id; ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', draggedTaskId);
    });
    el.taskList.addEventListener('dragover', function (ev) {
      if (!draggedTaskId || !state.isToday()) return;
      ev.preventDefault(); ev.dataTransfer.dropEffect = 'move';
      el.taskList.querySelectorAll('.drop-before,.drop-after').forEach(function (n) { n.classList.remove('drop-before', 'drop-after'); });
      var target = ev.target.closest('.todo-item');
      if (target) { var r = target.getBoundingClientRect(); target.classList.add(ev.clientY > r.top + r.height / 2 ? 'drop-after' : 'drop-before'); }
    });
    el.taskList.addEventListener('drop', function (ev) {
      if (!draggedTaskId || !state.isToday()) return;
      ev.preventDefault(); var target = ev.target.closest('.todo-item'), r = target && target.getBoundingClientRect();
      state.moveTask(draggedTaskId, target ? target.dataset.id : null, !!r && ev.clientY > r.top + r.height / 2);
      clearDrag(); refresh();
    });
    el.taskList.addEventListener('dragend', clearDrag);
    el.taskList.addEventListener('keydown', function (ev) {
      if (!ev.target.closest('.drag-handle') || !ev.altKey || !['ArrowUp', 'ArrowDown'].includes(ev.key)) return;
      ev.preventDefault(); var row = ev.target.closest('.todo-item'), rows = Array.from(el.taskList.querySelectorAll('.todo-item'));
      var delta = ev.key === 'ArrowDown' ? 1 : -1, next = rows[rows.indexOf(row) + delta];
      if (next) { state.moveTask(row.dataset.id, next.dataset.id, delta > 0); refresh(); }
    });

    /* ---------------- 顶部导航 ---------------- */
    el.prevDay.addEventListener('click', function () { state.shiftView(-1); refresh(); });
    el.nextDay.addEventListener('click', function () {
      if (state.isToday()) return;
      state.shiftView(1);
      refresh();
    });
    if (el.todayBtn) el.todayBtn.addEventListener('click', function () {
      state.goToday();
      refresh();
    });

    /* ---------------- 添加任务 ---------------- */
    el.addForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!state.isToday()) return;
      var v = (el.addInput.value || '').trim();
      if (!v) return;
      var added = state.addTask(v);
      el.addInput.value = '';
      refresh();
      el.addInput.focus();
      if (added) {
        var row = el.taskList.querySelector('.todo-item[data-id="' + added.id + '"]');
        if (row) row.classList.add('enter');
        if (!editHintShown) {
          editHintShown = true;
          store.set('sisy-hint-edit', true);
          NS.toast.show('小提示：双击任务名可以直接修改', { type: 'info', ms: 5000 });
        }
      }
    });

    /* ---------------- 任务列表：点击 ---------------- */
    var lastDeleted = null;   // { task, index, at } 供撤销按钮 / Ctrl+Z 撤回删除
    var editHintShown = store.get('sisy-hint-edit', false);   // 双击改名提示只弹一次

    /* 撤销删除：插回原位置 */
    function undoDelete(task, index) {
      state.restoreTask(task, index);
      refresh();
      NS.toast.show('已撤销删除', { type: 'ok' });
      lastDeleted = null;
    }

    /* 完成任务时在勾选框上方撒一小把克制的粒子 */
    function celebrate(li) {
      try {
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        var check = li.querySelector('.todo-check');
        if (!check) return;
        var host = li.closest('.card') || document.body;
        var cr = check.getBoundingClientRect();
        var hr = host.getBoundingClientRect();
        var colors = ['#007CFF', '#91D4FF', '#00A1FF'];
        for (var i = 0; i < 10; i++) {
          var bit = document.createElement('span');
          bit.className = 'confetti-bit';
          bit.style.left = (cr.left - hr.left + cr.width / 2) + 'px';
          bit.style.top = (cr.top - hr.top + 4) + 'px';
          bit.style.background = colors[i % colors.length];
          bit.style.setProperty('--dx', (Math.random() * 120 - 60) + 'px');
          bit.style.setProperty('--dy', (Math.random() * -70 - 10) + 'px');
          host.appendChild(bit);
          (function (b) { setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 1000); })(bit);
        }
      } catch (e) { /* 装饰性动画，失败即静默 */ }
    }

    function taskFromEvent(target) {
      var li = target.closest ? target.closest('.todo-item') : null;
      if (!li) return { li: null, task: null };
      return { li: li, task: state.findTask(li.dataset.id) };
    }

    el.taskList.addEventListener('click', function (ev) {
      // 标题被折成一行时，点一下展开 / 收起（回看历史日期也能展开）
      var titleEl = ev.target && ev.target.closest ? ev.target.closest('.task-title, .subtask-title') : null;
      if (titleEl && titleEl.classList.contains('clampable')) {
        var li0 = titleEl.closest('.todo-item');
        if (li0) { render.toggleExpand(li0.dataset.id, titleEl.dataset.sid || null); return; }
      }
      var btn = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
      if (!btn) return;
      if (btn.classList.contains('task-title') || btn.classList.contains('subtask-title')) return;
      var ctx = taskFromEvent(btn);
      if (!ctx.task) return;
      var act = btn.dataset.act;

      if (act === 'toggle') {
        var before = ctx.task.done;
        state.toggleTask(ctx.task.id);
        if (!before && ctx.task.done) celebrate(ctx.li);
        refresh();
      } else if (act === 'collapse') {
        render.toggleCollapse(ctx.task.id);
        refresh();
      } else if (act === 'focus') {
        if (global.dshTimer && global.dshTimer.startTask) {
          // 已绑定到本轮的任务 → 直接恢复计时（「继续本轮专注」）；否则先绑定并弹计划选择器
          var bound = lastFullSnap && lastFullSnap.timer && lastFullSnap.timer.task;
          var same = !!(bound && bound.id === ctx.task.id && bound.day === state.viewDay);
          global.dshTimer.startTask({ id: ctx.task.id, day: state.viewDay }, same ? undefined : { noStart: true }).then(function (result) {
            if (!result.ok) { NS.toast.show(result.error || '无法开始专注', { type: 'warn' }); return; }
            if (global.dshWindow) global.dshWindow.openTimerCompact();
          }).catch(function () { NS.toast.show('专注钟暂时不可用，请稍后重试', { type: 'error' }); });
        } else NS.toast.show('任务关联专注需要在桌面版中使用', { type: 'info' });
      } else if (act === 'delete') {
        var removed = ctx.task;
        var removedIdx = state.tasks().findIndex(function (x) { return x.id === removed.id; });
        state.deleteTask(ctx.task.id);
        lastDeleted = { task: removed, index: removedIdx, at: Date.now() };
        refresh();
        NS.toast.show('已删除「' + (removed.title.length > 14 ? removed.title.slice(0, 14) + '…' : removed.title) + '」', {
          type: 'info', ms: 6000,
          action: { label: '撤销', onClick: function () { undoDelete(removed, removedIdx); } }
        });
      } else if (act === 'edit') {
        startEditTask(ctx.task, ctx.li);
      } else if (act === 'alarm' || act === 'alarm-edit') {
        insertAlarmEdit(ctx.task, ctx.li);
      } else if (act === 'addstep') {
        var ns = state.addSubtask(ctx.task.id);
        render.expandSteps(ctx.task.id);
        refresh();
        if (ns) {
          var li2 = el.taskList.querySelector('.todo-item[data-id="' + ctx.task.id + '"]');
          if (li2) startEditSub(ctx.task, ns.id, li2);
        }
      } else if (act === 'subtoggle') {
        var r = state.toggleSubtask(ctx.task.id, btn.dataset.sid);
        refresh();
        if (r && r.justCompleted) NS.toast.show('这件事的步骤都完成了', { type: 'ok', ms: 2000 });
      } else if (act === 'subedit') {
        startEditSub(ctx.task, btn.dataset.sid, ctx.li);
      } else if (act === 'subdelete') {
        state.deleteSubtask(ctx.task.id, btn.dataset.sid);
        refresh();
      }
    });

    el.taskList.addEventListener('dblclick', function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
      if (!t) return;
      var ctx = taskFromEvent(t);
      if (!ctx.task) return;
      if (t.dataset.act === 'edit') startEditTask(ctx.task, ctx.li);
      else if (t.dataset.act === 'subedit') startEditSub(ctx.task, t.dataset.sid, ctx.li);
    });

    /* ---------------- 行内编辑 ---------------- */
    function startEditTask(task, li) {
      var titleEl = li.querySelector('.task-title');
      if (!titleEl) return;
      var input = render.inlineEdit(task.title, {
        after: function () { state.persist(); refresh(); }
      }, function (v) { state.setTaskTitle(task.id, v); });
      titleEl.replaceWith(input);
      input.focus();
      input.select();
    }

    function startEditSub(task, sid, li) {
      var sub = state.findSub(task, sid);
      if (!sub) return;
      var stEl = li.querySelector('.subtask-title[data-sid="' + sid + '"]');
      if (!stEl) return;
      var input = render.inlineEdit(sub.title, {
        sub: true,
        after: function () { state.persist(); refresh(); }
      }, function (v) { state.setSubTitle(task.id, sid, v); });
      stEl.replaceWith(input);
      input.focus();
      input.select();
    }

    function insertAlarmEdit(task, li) {
      var mainEl = li.querySelector('.task-main');
      if (!mainEl) return;
      var box = document.createElement('div');
      box.className = 'task-meta';
      var input = render.inlineEdit(task.alarm || '', {
        alarm: true,
        after: function () { state.persist(); refresh(); }
      }, function (v) { state.setTaskAlarm(task.id, v); });
      input.setAttribute('aria-label', '闹钟时间');
      box.appendChild(input);
      mainEl.insertBefore(box, mainEl.querySelector('.task-meta') || null);
      input.focus();
      input.select();
    }

    /* ---------------- 月历 ---------------- */
    var calendarDialog = NS.createDialog(el.calendarOverlay, closeCalendar);
    var settingsDialog = NS.createDialog(el.settingsPanel, function () { el.backBtn.click(); });
    var statsDialog = NS.createDialog(el.statsPanel, function () { el.statsBack.click(); });
    function closeCalendar() { el.calendarOverlay.classList.remove('show'); calendarDialog.close(); }
    el.calToggle.addEventListener('click', function () {
      render.syncCalMonthToView();
      render.renderCalendar();
      el.calendarOverlay.classList.add('show');
      calendarDialog.open(el.calClose);
    });
    el.calClose.addEventListener('click', closeCalendar);
    el.calPrev.addEventListener('click', function () { render.setCalMonth(-1); });
    el.calNext.addEventListener('click', function () { render.setCalMonth(1); });
    el.calDays.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('[data-act="calpick"]') : null;
      if (!btn) return;
      state.setViewDay(btn.dataset.day);
      closeCalendar();
      refresh();
    });

    /* ---------------- 每日任务设置 ---------------- */
    el.settingsBtn.addEventListener('click', function () {
      el.settingsPanel.classList.add('show');
      render.renderSettings();
      loadDataInfo();
      settingsDialog.open(el.backBtn);
    });
    el.backBtn.addEventListener('click', function () {
      el.settingsPanel.classList.remove('show');
      settingsDialog.close();
      state.syncDaily();
      refresh();
    });
    var statsRange = 'week', statsRequest = 0, tlDayKey = date.todayKey();
    function readHistory() {
      return global.dshTimer && global.dshTimer.history ? global.dshTimer.history() : Promise.resolve(store.get('sisy-timer-history', []));
    }
    function renderStats() {
      var request = ++statsRequest;
      el.statsPanel.querySelectorAll('[data-range]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.range === statsRange)); });
      if (el.dayView) el.dayView.hidden = statsRange !== 'day';
      if (el.rangeView) el.rangeView.hidden = statsRange === 'day';
      if (statsRange === 'day') { renderDayTimeline(); return; }
      el.statsNote.textContent = '正在读取记录…';
      readHistory().then(function (history) {
        if (request !== statsRequest) return;
        var result = NS.statistics.summary(history, state.records(), statsRange);
        el.statMinutes.textContent = result.minutes;
        el.statRounds.textContent = result.rounds;
        el.statTasks.textContent = result.tasks;
        el.statStreak.textContent = result.streak;
        el.statHours.replaceChildren();
        result.bins.forEach(function (value, i) {
          var bar = document.createElement('div'); bar.className = 'hour-bar';
          var label = String(i * 2).padStart(2, '0') + ':00–' + String(i * 2 + 2).padStart(2, '0') + ':00';
          bar.setAttribute('role', 'listitem'); bar.tabIndex = 0;
          bar.setAttribute('aria-label', label + '，' + value + ' 分钟'); bar.title = label + ' · ' + value + ' 分钟';
          bar.style.setProperty('--h', (result.peak ? value / result.peak * 100 : 0) + '%');
          var fill = document.createElement('i'), caption = document.createElement('span');
          fill.setAttribute('aria-hidden', 'true'); caption.textContent = String(i * 2).padStart(2, '0');
          bar.append(fill, caption); el.statHours.appendChild(bar);
        });
        var peak = result.peakIndex < 0 ? '暂无完成的专注记录。' : '最常专注：' + result.peakIndex * 2 + '–' + (result.peakIndex * 2 + 2) + ' 点。';
        el.statsNote.textContent = result.since + ' 至 ' + result.until + '。' + peak + '统计包含恢复完成的轮次，按开始时段归组；连续天数可延续至昨天。历史仅保留最近 300 轮，早期记录不足或清空汇总后，可能与今日累计不同。';
      }).catch(function () { if (request === statsRequest) el.statsNote.textContent = '读取记录失败，请关闭后重试。'; });
    }
    function refreshHistory() {
      readHistory().then(function (history) { render.setTaskTotals(NS.statistics.taskTotals(history)); refresh(); }).catch(function () { NS.toast.show('专注记录暂时无法读取，请稍后重试', { type: 'warn' }); });
    }

    /* ---------------- 每日时间轴 ---------------- */
    var $id = function (id) { return document.getElementById(id); };
    var tlForm = $id('tlForm'), tlTitle = $id('tlTitle'), tlStart = $id('tlStart'), tlEnd = $id('tlEnd');
    var editing = null;   // {mode:'edit'|'add', key?}

    function loadOverrides() {
      var o = store.get('sisy-timeline-overrides', null);
      return (o && typeof o === 'object')
        ? { edits: Array.isArray(o.edits) ? o.edits : [], manual: Array.isArray(o.manual) ? o.manual : [] }
        : { edits: [], manual: [] };
    }
    function saveOverrides(o) {
      var r = store.set('sisy-timeline-overrides', o);
      if (r && r.ok === false) NS.toast.show('时间轴修正保存失败', { type: 'error' });
      return r;
    }
    function renderDayTimeline() {
      var request = statsRequest;
      if (el.tlDay) el.tlDay.textContent = date.fullLabel(tlDayKey) + (tlDayKey === date.todayKey() ? '（今天）' : '');
      el.statsNote.textContent = '正在读取记录…';
      readHistory().then(function (history) {
        if (request !== statsRequest) return;
        var blocks = NS.statistics.dayTimeline(history, tlDayKey, loadOverrides());
        render.renderTimeline(blocks);
        var mins = blocks.reduce(function (a, b) { return a + b.minutes; }, 0);
        el.statsNote.textContent = '共 ' + blocks.length + ' 个时段 · ' + mins + ' 分钟。重叠时段并排显示；「改时间 / 隐藏」只修正显示，不动专注记录。';
      }).catch(function () { if (request === statsRequest) el.statsNote.textContent = '读取记录失败，请关闭后重试。'; });
    }
    function openTlForm(mode, blk) {
      editing = { mode: mode, key: blk ? blk.dataset.key : null };
      tlForm.hidden = false;
      tlTitle.disabled = (mode === 'edit');
      tlTitle.value = mode === 'edit' ? ((blk && blk.querySelector('.tl-title') || {}).textContent || '') : '';
      tlStart.value = (blk && blk.dataset.start) || '09:00';
      tlEnd.value = (blk && blk.dataset.end) || '10:00';
      (mode === 'add' ? tlTitle : tlStart).focus();
    }
    tlForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!editing) return;
      var s = tlStart.value, e = tlEnd.value;
      if (!s || !e) return;
      if (!(NS.statistics.toMin(e) > NS.statistics.toMin(s))) { NS.toast.show('结束时间要晚于开始时间', { type: 'warn' }); return; }
      var ov = loadOverrides();
      if (editing.mode === 'add') {
        var title = (tlTitle.value || '').trim();
        if (!title) { NS.toast.show('补录时段请填写名称', { type: 'warn' }); return; }
        ov.manual.push({ id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), day: tlDayKey, start: s, end: e, title: title.slice(0, 200) });
      } else {
        var found = null;
        ov.edits.forEach(function (x) { if (x.key === editing.key) found = x; });
        if (!found) { found = { key: editing.key }; ov.edits.push(found); }
        found.start = s; found.end = e;
      }
      saveOverrides(ov);
      tlForm.hidden = true; editing = null;
      renderDayTimeline();
    });
    $id('tlCancel').addEventListener('click', function () { tlForm.hidden = true; editing = null; });
    $id('tlAdd').addEventListener('click', function () { openTlForm('add', null); });
    $id('tlPrev').addEventListener('click', function () { tlDayKey = date.shiftDay(tlDayKey, -1); renderDayTimeline(); });
    $id('tlNext').addEventListener('click', function () { tlDayKey = date.shiftDay(tlDayKey, 1); renderDayTimeline(); });
    $id('tlTodayBtn').addEventListener('click', function () { tlDayKey = date.todayKey(); renderDayTimeline(); });
    el.timeline.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-tlact]');
      if (!btn) return;
      var blk = btn.closest('.tl-block');
      if (!blk) return;
      var act = btn.dataset.tlact;
      if (act === 'edit') { openTlForm('edit', blk); return; }
      if (act === 'hide' || act === 'del') {
        var ov = loadOverrides();
        if (act === 'del') {
          ov.manual = ov.manual.filter(function (m) { return m.id !== blk.dataset.mid; });
        } else {
          var found = null;
          ov.edits.forEach(function (x) { if (x.key === blk.dataset.key) found = x; });
          if (!found) { found = { key: blk.dataset.key }; ov.edits.push(found); }
          found.hidden = true;
        }
        saveOverrides(ov);
        renderDayTimeline();
        return;
      }
      if (act === 'task') {
        noteCall('copyNote', 'task', { taskId: blk.dataset.taskId, taskDay: blk.dataset.taskDay || tlDayKey });
      }
    });

    /* ---------------- 笔记导出（Obsidian / Notion 联动） ---------------- */
    function noteCall(fn, kind, payload) {
      if (!global.dshData || !global.dshData[fn]) { NS.toast.show('当前是浏览器模式，笔记功能不可用', { type: 'warn' }); return Promise.resolve(null); }
      return global.dshData[fn](kind, payload || {}).then(function (r) {
        if (!r || !r.ok) {
          if (r && r.canceled) return r;
          NS.toast.show((r && r.error) || '操作失败', { type: 'error' });
          return r;
        }
        if (fn === 'copyNote') NS.toast.show('已复制到剪贴板（' + (r.name || kind) + '）', { type: 'ok' });
        else if (fn === 'saveNote') NS.toast.show('已保存 ' + r.path, {
          type: 'ok', ms: 8000,
          action: { label: '打开', onClick: function () { global.dshData.reveal(r.path); } }
        });
        return r;
      }).catch(function (e) { log.error('笔记操作失败', e); NS.toast.show('笔记操作失败', { type: 'error' }); return null; });
    }
    $id('noteDailyCopy').addEventListener('click', function () { noteCall('copyNote', 'daily', { day: tlDayKey }); });
    $id('noteDailySave').addEventListener('click', function () { noteCall('saveNote', 'daily', { day: tlDayKey }); });
    $id('noteWeeklyCopy').addEventListener('click', function () { noteCall('copyNote', 'weekly', {}); });

    /* ---------------- 笔记模板编辑 ---------------- */
    var tplKind = 'daily';
    var TPL_VARS = {
      daily: '{{date}} {{date_cn}} {{weekday}} {{focus_minutes}} {{focus_rounds}} {{tasks_done_count}} {{tasks_total_count}}｜循环块 {{#timeline}}{{start}} {{end}} {{title}} {{minutes}}{{/timeline}}、{{#tasks_done}}{{title}} {{minutes}}{{/tasks_done}}',
      task: '{{task_title}} {{task_id}} {{task_minutes}} {{date}} {{date_cn}} {{focus_minutes}} {{focus_rounds}}｜循环块 {{#timeline}}{{start}} {{end}} {{minutes}}{{/timeline}}',
      weekly: '{{week_since}} {{week_until}} {{focus_minutes}} {{focus_rounds}} {{tasks_done_count}} {{streak}} {{peak_range}}｜循环块 {{#tasks_done}}{{title}} {{minutes}}{{/tasks_done}}'
    };
    var tplText = $id('tplText'), tplVars = $id('tplVars'), tplPreviewOut = $id('tplPreviewOut');
    function loadTpl(kind) {
      tplKind = kind;
      document.querySelectorAll('[data-tpl]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.tpl === kind)); });
      var t = NS.template.pick(store.get('sisy-export-template', null), kind);
      tplText.value = t.text;
      tplVars.textContent = '变量：' + TPL_VARS[kind];
      tplPreviewOut.hidden = true;
    }
    document.querySelectorAll('[data-tpl]').forEach(function (b) {
      b.addEventListener('click', function () { loadTpl(b.dataset.tpl); });
    });
    $id('tplSave').addEventListener('click', function () {
      var stored = store.get('sisy-export-template', null) || {};
      var templates = Object.assign({}, stored.templates || {});
      var def = NS.template.DEFAULT_TEMPLATES[tplKind] || {};
      templates[tplKind] = { name: (templates[tplKind] && templates[tplKind].name) || def.name || tplKind, text: tplText.value };
      var r = store.set('sisy-export-template', { templates: templates });
      if (r && r.ok === false) NS.toast.show('模板保存失败：' + (r.error || ''), { type: 'error' });
      else NS.toast.show('模板已保存', { type: 'ok' });
    });
    $id('tplReset').addEventListener('click', function () {
      var stored = store.get('sisy-export-template', null) || {};
      var templates = Object.assign({}, stored.templates || {});
      delete templates[tplKind];
      store.set('sisy-export-template', { templates: templates });
      loadTpl(tplKind);
      NS.toast.show('已恢复默认模板', { type: 'ok' });
    });
    $id('tplPreview').addEventListener('click', function () {
      if (!global.dshData || !global.dshData.renderNote) { NS.toast.show('当前是浏览器模式，预览不可用', { type: 'warn' }); return; }
      var payload = { templateText: tplText.value };
      var ready = Promise.resolve(payload);
      if (tplKind === 'task') {
        ready = readHistory().then(function (history) {
          var h = null;
          (history || []).slice().reverse().forEach(function (x) { if (!h && x && x.taskId) h = x; });
          if (!h) return null;
          payload.taskId = h.taskId;
          payload.taskDay = h.taskDay || tlDayKey;
          return payload;
        });
      } else if (tplKind === 'daily') {
        payload.day = tlDayKey;
      }
      ready.then(function (p) {
        if (!p) { tplPreviewOut.hidden = false; tplPreviewOut.textContent = '还没有带任务的专注记录，先做一轮任务专注再预览。'; return; }
        return global.dshData.renderNote(tplKind, p).then(function (r) {
          tplPreviewOut.hidden = false;
          tplPreviewOut.textContent = (r && r.ok) ? r.text : ((r && r.error) || '预览失败');
        });
      });
    });
    loadTpl('daily');

    el.statsBtn.addEventListener('click', function () { el.statsPanel.hidden = false; statsDialog.open(el.statsBack); renderStats(); });
    el.statsBack.addEventListener('click', function () { ++statsRequest; el.statsPanel.hidden = true; statsDialog.close(); });
    el.statsPanel.addEventListener('click', function (ev) { var b = ev.target.closest('[data-range]'); if (!b) return; statsRange = b.dataset.range; renderStats(); });
    if (global.dshTimer) {
      var currentRef = '';
      var lastFullSnap = null;
      function updateTask(snap) {
        if (!snap) return;
        // 轻量 tick 只带剩余时间字段，跳过（任务绑定只在完整快照里变化）
        if (snap.tick === true) return;
        lastFullSnap = snap;
        var task = snap.timer && snap.timer.task, ref = task ? task.day + '/' + task.id : '';
        if (ref !== currentRef) { currentRef = ref; render.setActiveTask(task); refresh(); }
      }
      global.dshTimer.onState(updateTask);
      global.dshTimer.getState().then(updateTask).catch(function () {});
      global.dshTimer.onEvent(function (event) { if (event.type === 'done' || event.type === 'abandoned') { refreshHistory(); if (!el.statsPanel.hidden) renderStats(); } });
    }
    refreshHistory();
    el.dailyAddBtn.addEventListener('click', function () {
      var v = (el.dailyInput.value || '').trim();
      if (!v) return;
      state.addDaily(v);
      el.dailyInput.value = '';
      render.renderSettings();
      refresh();
    });
    el.dailyInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); el.dailyAddBtn.click(); }
      ev.stopPropagation();
    });
    el.settingsList.addEventListener('click', function (ev) {
      var del = ev.target && ev.target.closest ? ev.target.closest('[data-act="dailydelete"]') : null;
      if (!del) return;
      state.removeDaily(del.dataset.did);
      render.renderSettings();
      refresh();
    });
    el.settingsList.addEventListener('dblclick', function (ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest('[data-act="dailyedit"]') : null;
      if (!t) return;
      var did = t.dataset.did;
      var cfg = state.dailyConfig();
      var cur = '';
      cfg.tasks.forEach(function (x) { if (x.id === did) cur = x.title; });
      var input = render.inlineEdit(cur, {
        after: function () { render.renderSettings(); refresh(); }
      }, function (v) { state.renameDaily(did, v); });
      t.replaceWith(input);
      input.focus();
      input.select();
    });

    /* ---------------- 数据备份 ---------------- */
    function loadDataInfo() {
      if (!global.dshApp || !global.dshApp.info) { render.renderData(null); return; }
      global.dshApp.info().then(function (info) { render.renderData(info); })
        .catch(function (e) { log.warn('读取应用信息失败', e); render.renderData(null); });
    }

    function handleDataAction(act) {
      var api = global.dshData;
      if (!api) { NS.toast.show('当前是浏览器模式，文件导入导出不可用', { type: 'warn' }); return; }

      if (act === 'data-export') {
        api.exportFile().then(function (r) {
          if (r.canceled) return;
          if (!r.ok) { NS.toast.show('导出失败：' + (r.error || '未知错误'), { type: 'error' }); return; }
          NS.toast.show('已导出到 ' + r.path, {
            type: 'ok', ms: 8000,
            action: { label: '打开', onClick: function () { api.reveal(r.path); } }
          });
        }).catch(function (e) { log.error('导出异常', e); NS.toast.show('导出异常，请查看日志', { type: 'error' }); });
        return;
      }

      if (act === 'data-import') {
        api.pickImportFile().then(function (r) {
          if (r.canceled) return;
          if (!r.ok) { NS.toast.show(r.error || '读取备份失败', { type: 'error' }); return; }
          var s = r.summary || {};
          var msg = '备份内容：' + (s.days || 0) + ' 天 / ' + (s.tasks || 0) + ' 条任务 / 每日任务 ' + (s.dailyTemplates || 0) + ' 条\n' +
            '导出时间：' + (s.exportedAt ? new Date(s.exportedAt).toLocaleString() : '未知') + '\n\n' +
            '导入前会自动备份当前数据（可撤销）。\n继续吗？';
          if (!global.confirm(msg)) return;
          var replace = global.confirm('要把现有数据【整体替换】成备份内容吗？\n\n确定 = 替换（现有任务会被清掉）\n取消 = 合并（保留现有任务，同名按备份覆盖）');
          api.applyImport(r.bundle, replace ? 'replace' : 'merge').then(function (res) {
            if (!res.ok) { NS.toast.show('导入失败：' + (res.error || ''), { type: 'error' }); return; }
            NS.toast.show('已导入 ' + res.applied + ' 项数据，正在刷新…', { type: 'ok' });
          }).catch(function (e) { log.error('导入异常', e); NS.toast.show('导入异常，请查看日志', { type: 'error' }); });
        }).catch(function (e) { log.error('选择备份文件异常', e); NS.toast.show('读取备份文件异常', { type: 'error' }); });
        return;
      }

      if (act === 'data-reveal') {
        api.reveal(null);
        if (global.dshApp && global.dshApp.info) {
          global.dshApp.info().then(function (info) {
            if (info.backupDir) api.reveal(info.backupDir);
          });
        }
        return;
      }

      if (act === 'data-log') {
        if (global.dshLog && global.dshLog.reveal) global.dshLog.reveal();
        return;
      }

      if (act === 'data-clear') {
        if (!global.confirm('清空全部数据？\n\n包括今日事任务、每日任务、专注统计。\n清空前会自动备份到数据目录。')) return;
        if (!global.confirm('真的要清空吗？这一步不可撤销（但可以在备份文件夹里找回）。')) return;
        api.clearAll(null).then(function (r) {
          if (!r.ok) { NS.toast.show('清空失败', { type: 'error' }); return; }
          NS.toast.show('已清空 ' + r.removed + ' 项数据', {
            type: 'ok', ms: 9000,
            action: { label: '打开备份', onClick: function () { if (r.preBackup) api.reveal(r.preBackup); } }
          });
        }).catch(function (e) { log.error('清空异常', e); NS.toast.show('清空异常', { type: 'error' }); });
        return;
      }
    }

    el.settingsPanel.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('[data-act^="data-"]') : null;
      if (!btn) return;
      handleDataAction(btn.dataset.act);
    });

    /* ---------------- 跨天 ---------------- */
    var lastToday = date.todayKey();
    setInterval(function () {
      var now = date.todayKey();
      if (now === lastToday) return;
      var prev = lastToday;
      lastToday = now;
      log.info('跨天：' + prev + ' -> ' + now);
      state.handleDayRollover(prev);
      refresh();
    }, 30000);

    /* ---------------- 键盘 ---------------- */
    document.addEventListener('keydown', function (ev) {
      if (ev.target && /^(INPUT|TEXTAREA)$/.test(ev.target.tagName)) return;
      if (ev.key === 'Escape') {
        if (el.calendarOverlay.classList.contains('show')) closeCalendar();
        else if (el.settingsPanel.classList.contains('show')) el.backBtn.click();
      } else if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && ev.key.toLowerCase() === 'z') {
        if (lastDeleted && Date.now() - lastDeleted.at < 60000 && state.findTask(lastDeleted.task.id) === null) {
          ev.preventDefault();
          undoDelete(lastDeleted.task, lastDeleted.index);
        }
      }
    });

    /* ---------------- 尺寸变化：重新判断哪些标题需要折叠 ---------------- */
    var clampT = null;
    global.addEventListener('resize', function () {
      if (clampT) clearTimeout(clampT);
      clampT = setTimeout(function () { clampT = null; render.applyClamp(); }, 150);
    });

    /* ---------------- 保存失败提示 ---------------- */
    store.onSaveError(function () {
      NS.toast.show('数据保存失败，请在「⚙ 设置 → 数据备份」里导出备份', { type: 'error', ms: 8000 });
    });

    refresh();
    log.info('今日事已启动 · 存储后端 ' + store.backendKind + ' · 查看日期 ' + state.viewDay);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
