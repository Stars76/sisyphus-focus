/* ============================================================
 * src/todo/render.js · 今日事渲染层（只画 DOM，不改数据）
 * ------------------------------------------------------------
 * 所有交互都用 data-act 标记，由 app.js 统一事件委托处理。
 * ============================================================ */
(function (global) {
  'use strict';
  var NS = global.DSH || (global.DSH = {});
  NS.todo = NS.todo || {};
  if (NS.todo.createRender) return;

  function $(id) { return document.getElementById(id); }

  function createRender(deps) {
    var state = deps.state;
    var date = deps.date;
    var log = NS.log;

    var el = {
      root: $('todo-app'),
      dayLabel: $('dayLabel'),
      prevDay: $('prevDay'),
      nextDay: $('nextDay'),
      todayBtn: $('todayBtn'),
      addForm: $('addForm'),
      addInput: $('addInput'),
      taskList: $('taskList'),
      taskCount: $('taskCount'),
      taskProgress: $('taskProgress'),
      listHeading: $('listHeading'),
      filterBtn: $('filterBtn'),
      settingsBtn: $('settingsBtn'),
      statsBtn: $('statsBtn'), statsPanel: $('statsPanel'), statsBack: $('statsBack'),
      statMinutes: $('statMinutes'), statRounds: $('statRounds'), statTasks: $('statTasks'), statStreak: $('statStreak'), statHours: $('statHours'), statsNote: $('statsNote'),
      calToggle: $('calToggle'),
      calendarOverlay: $('calendarOverlay'),
      calTitle: $('calTitle'),
      calDays: $('calDays'),
      calPrev: $('calPrev'),
      calNext: $('calNext'),
      calClose: $('calClose'),
      settingsPanel: $('settingsPanel'),
      backBtn: $('backBtn'),
      settingsList: $('settingsList'),
      dailyForm: $('dailyForm'),
      dailyAddBtn: $('dailyAddBtn'),
      dailyInput: $('dailyInput'),
      dataList: $('dataList'),
      dataInfo: $('dataInfo'),
      dayView: $('dayView'), rangeView: $('rangeView'),
      timeline: $('timeline'), tlDay: $('tlDay')
    };

    var calMonth = new Date();
    var viewPrefs = NS.store.get('sisy-todo-view', {}) || {};
    var onlyOpen = !!viewPrefs.onlyOpen, collapsed = new Set(Array.isArray(viewPrefs.collapsed) ? viewPrefs.collapsed : []);
    var activeTask = null, taskTotals = Object.create(null);
    function viewKey(id) { return state.viewDay + '/' + id; }
    function saveView() { NS.store.set('sisy-todo-view', { onlyOpen: onlyOpen, collapsed: Array.from(collapsed).slice(-1000) }); }

    /* ---------------- 每日时间轴（重叠块并排分列，日历事件式布局） ---------------- */
    function renderTimeline(blocks) {
      var wrap = el.timeline;
      if (!wrap) return;
      wrap.replaceChildren();
      if (!blocks || !blocks.length) {
        var empty = document.createElement('p');
        empty.className = 'tl-empty';
        empty.textContent = '这一天还没有专注时段。开始一次任务专注，或点「补录时段」手动添加。';
        wrap.appendChild(empty);
        return;
      }
      var laid = NS.statistics.layoutTimeline(blocks);
      var axis = document.createElement('div');
      axis.className = 'tl-axis'; axis.setAttribute('aria-hidden', 'true');
      for (var h = 0; h <= 21; h += 3) {
        var tick = document.createElement('span');
        tick.className = 'tl-tick';
        tick.style.top = (h / 24 * 100) + '%';
        tick.textContent = (h < 10 ? '0' : '') + h + ':00';
        axis.appendChild(tick);
      }
      wrap.appendChild(axis);
      var track = document.createElement('div');
      track.className = 'tl-track';
      laid.forEach(function (b) {
        var blk = document.createElement('div');
        blk.className = 'tl-block' + (b.result === 'abandoned' ? ' warn' : '') + (b.result === 'manual' ? ' manual' : '');
        blk.setAttribute('role', 'listitem');
        blk.dataset.key = b.key;
        blk.dataset.start = NS.statistics.toHhmm(b.startMin);
        blk.dataset.end = NS.statistics.toHhmm(b.endMin);
        if (b.taskId) blk.dataset.taskId = b.taskId;
        if (b.taskDay) blk.dataset.taskDay = b.taskDay;
        if (b.result === 'manual' && b.id) blk.dataset.mid = b.id;
        blk.style.top = (b.startMin / 1440 * 100) + '%';
        blk.style.height = Math.max((b.endMin - b.startMin) / 1440 * 100, 2.4) + '%';
        blk.style.left = 'calc(' + (b.col * 100 / b.cols) + '% + 2px)';
        blk.style.width = 'calc(' + (100 / b.cols) + '% - 4px)';
        var range = NS.statistics.toHhmm(b.startMin) + '–' + NS.statistics.toHhmm(b.endMin);
        var time = document.createElement('div');
        time.className = 'tl-time';
        time.textContent = range + ' · ' + b.minutes + ' 分钟'
          + (b.result === 'abandoned' ? ' · 中断' : '') + (b.edited ? ' · 已修正' : '');
        var title = document.createElement('div');
        title.className = 'tl-title';
        title.textContent = b.title;
        var acts = document.createElement('div');
        acts.className = 'tl-acts';
        [['edit', '改时间'], ['hide', '隐藏']].concat(
          b.result === 'manual' ? [['del', '删除']] : [],
          b.taskId ? [['task', '任务记录']] : []
        ).forEach(function (a) {
          var btn = document.createElement('button');
          btn.type = 'button'; btn.dataset.tlact = a[0]; btn.textContent = a[1];
          acts.appendChild(btn);
        });
        blk.append(time, title, acts);
        blk.title = range + ' · ' + b.title;
        track.appendChild(blk);
      });
      wrap.appendChild(track);
    }
    calMonth.setDate(1);
    calMonth.setHours(0, 0, 0, 0);

    function icon(name) {
      var i = document.createElement('sisy-icon');
      i.setAttribute('name', name);
      return i;
    }
    function iconBtn(act, name, title, extraClass) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'icon-btn' + (extraClass ? ' ' + extraClass : '');
      b.dataset.act = act;
      b.title = title;
      b.setAttribute('aria-label', title);
      b.appendChild(icon(name));
      return b;
    }

    /* ---------------- 任务列表 ---------------- */
    function renderTaskList() {
      var today = state.isToday();
      var tasks = state.tasks();
      var visibleTasks = onlyOpen ? tasks.filter(function (t) { return !t.done; }) : tasks;
      var finished = tasks.filter(function (t) { return t.done; }).length;
      el.taskCount.textContent = tasks.length ? finished + ' / ' + tasks.length + ' 已完成' : '还没有任务';
      el.taskProgress.max = tasks.length || 1;
      el.taskProgress.value = finished;
      el.taskProgress.hidden = !tasks.length;
      el.listHeading.textContent = today ? (tasks.length && finished === tasks.length ? '今天的任务都完成了' : '今天的任务') : '这一天的记录';
      el.filterBtn.setAttribute('aria-pressed', String(onlyOpen)); el.filterBtn.textContent = onlyOpen ? '显示全部' : '只看未完成';
      el.taskList.innerHTML = '';

      if (!visibleTasks.length) {
        var empty = document.createElement('li');
        empty.className = 'todo-empty';
        var mark = document.createElement('span'); mark.className = 'empty-mark'; mark.setAttribute('aria-hidden', 'true'); mark.appendChild(icon(today ? 'AddIcon' : 'CalendarIcon'));
        var heading = document.createElement('p'); heading.className = 'empty-title'; heading.textContent = tasks.length && onlyOpen ? '没有未完成的任务' : (today ? '从一件小事开始' : '这一天没有记录');
        var detail = document.createElement('p'); detail.className = 'empty-detail'; detail.textContent = tasks.length && onlyOpen ? '点击「显示全部」查看已经完成的事。' : (today ? '在上方写下想做的事。太大的任务，可以再拆成几个小步骤。' : '用上方日期切换，或回到今天继续。');
        empty.append(mark, heading, detail);
        el.taskList.appendChild(empty);
        return;
      }

      var nextTask = visibleTasks.find(function (task) { return !task.done; });
      visibleTasks.forEach(function (task) {
        var li = document.createElement('li');
        li.className = 'todo-item' + (task.done ? ' done' : '');
        li.dataset.id = task.id;
        var current = activeTask && activeTask.id === task.id && activeTask.day === state.viewDay;
        if (current) li.classList.add('current-task');
        else if (today && !activeTask && task === nextTask) li.classList.add('next-task');
        if (collapsed.has(viewKey(task.id))) li.classList.add('collapsed');

        var head = document.createElement('div');
        head.className = 'task-head';
        if (today) {
          var handle = iconBtn('move', 'MoveIcon', '拖动排序，或按 Alt + ↑ / ↓', 'drag-handle');
          handle.draggable = true; head.appendChild(handle);
        }

        var check = document.createElement('button');
        check.className = 'todo-check';
        check.type = 'button';
        check.dataset.act = 'toggle';
        check.setAttribute('aria-label', task.done ? '标回未完成' : '完成任务');
        check.setAttribute('aria-pressed', String(!!task.done));
        check.appendChild(icon('CheckIcon'));
        head.appendChild(check);

        var main = document.createElement('div');
        main.className = 'task-main';
        var titleRow = document.createElement('div');
        titleRow.className = 'task-title-row';
        if (current || (today && !activeTask && task === nextTask)) {
          var badge = document.createElement('span'); badge.className = 'task-context';
          badge.textContent = current ? '本轮专注' : '接下来'; titleRow.appendChild(badge);
        }
        var title = document.createElement('span');
        title.className = 'task-title';
        title.textContent = task.title;
        title.dataset.act = 'edit'; title.title = '双击修改';
        titleRow.appendChild(title);

        /* 紧凑徽标组：只挤在标题行的最右侧，不单独占一行、不抢任务本体空间 */
        var badges = document.createElement('span');
        badges.className = 'task-badges';
        var subs = task.subtasks || [];
        var total = taskTotals[task.id] || taskTotals[viewKey(task.id)] || 0;
        if (total) {
          var cr = document.createElement('span');
          cr.className = 'task-credit';
          cr.textContent = '⏱ ' + total;
          cr.title = '本轮专注已计入 ' + total + ' 分钟';
          badges.appendChild(cr);
        }
        if (task.done) {
          var doneBadge = document.createElement('span');
          doneBadge.className = 'task-step-badge done';
          doneBadge.textContent = subs.length ? '完成' : '已完成';
          doneBadge.title = subs.length ? '全部步骤已完成' : '任务已完成';
          badges.appendChild(doneBadge);
        } else if (subs.length) {
          var doneCount = subs.filter(function (s) { return s.done; }).length;
          var nx = null;
          for (var i = 0; i < subs.length; i++) { if (!subs[i].done) { nx = subs[i]; break; } }
          var stepBadge = document.createElement('span');
          stepBadge.className = 'task-step-badge';
          stepBadge.textContent = doneCount + '/' + subs.length;
          stepBadge.title = nx ? ('已完成 ' + doneCount + '/' + subs.length + ' 步 · 下一步：' + nx.title) : ('已完成全部 ' + subs.length + ' 步');
          badges.appendChild(stepBadge);
        }
        if (task.alarm) {
          var alarm = document.createElement('span');
          alarm.className = 'task-alarm';
          alarm.dataset.act = 'alarm-edit';
          alarm.title = '闹钟 ' + task.alarm + '，点击修改或清除';
          alarm.setAttribute('role', 'button');
          alarm.setAttribute('aria-label', '闹钟 ' + task.alarm + '，点击修改或清除');
          alarm.appendChild(icon('AlarmIcon'));
          var at = document.createElement('span');
          at.textContent = task.alarm;
          alarm.appendChild(at);
          badges.appendChild(alarm);
        }
        if (task.rolledFrom) {
          var rolled = document.createElement('span');
          rolled.className = 'task-rolled';
          rolled.textContent = '顺延';
          rolled.title = '来自 ' + task.rolledFrom + '：未完成自动顺延到今天';
          badges.appendChild(rolled);
        }
        if (badges.childNodes.length) titleRow.appendChild(badges);

        main.appendChild(titleRow);
        head.appendChild(main);

        var actions = document.createElement('div');
        actions.className = 'task-actions';
        if (subs.length) {
          var fold = iconBtn('collapse', 'RightIcon', '展开或收起步骤', 'collapse-task');
          fold.setAttribute('aria-expanded', String(!collapsed.has(viewKey(task.id)))); actions.appendChild(fold);
        }
        if (today && !task.done) actions.appendChild(iconBtn('focus', 'TimerIcon', current ? '继续本轮专注' : '开始专注', 'focus-task'));
        actions.appendChild(iconBtn('addstep', 'AddIcon', '添加小步骤', 'addstep'));
        actions.appendChild(iconBtn('alarm', 'AlarmIcon', task.alarm ? '修改闹钟' : '设置闹钟', 'hover-only'));
        actions.appendChild(iconBtn('edit', 'EditIcon', '修改', 'hover-only'));
        actions.appendChild(iconBtn('delete', 'DeleteIcon', '删除', 'hover-only'));
        head.appendChild(actions);
        li.appendChild(head);

        if (subs.length && !collapsed.has(viewKey(task.id))) {
          var ul = document.createElement('ul');
          ul.className = 'subtasks';
          subs.forEach(function (s) {
            var sli = document.createElement('li');
            sli.className = 'subtask' + (s.done ? ' done' : '');

            var sbtn = document.createElement('button');
            sbtn.className = 'todo-check';
            sbtn.type = 'button';
            sbtn.dataset.act = 'subtoggle';
            sbtn.dataset.sid = s.id;
            sbtn.setAttribute('aria-label', s.title || '小步骤');
            sbtn.setAttribute('aria-pressed', String(!!s.done));
            sbtn.appendChild(icon('CheckIcon'));
            sli.appendChild(sbtn);

            var st = document.createElement('span');
            st.className = 'subtask-title';
            st.textContent = s.title || '（未命名步骤）';
            st.dataset.sid = s.id;                 // 始终带上，展开状态按 sid 记
            st.dataset.act = 'subedit'; st.title = '双击修改';
            sli.appendChild(st);

            var se = iconBtn('subedit', 'EditIcon', '修改步骤', 'hover-only subedit');
            se.dataset.sid = s.id;
            sli.appendChild(se);

            var sd = iconBtn('subdelete', 'DeleteIcon', '删除', 'hover-only subdel');
            sd.dataset.sid = s.id;
            sli.appendChild(sd);

            ul.appendChild(sli);
          });
          li.appendChild(ul);
        }

        el.taskList.appendChild(li);
      });
    }

    /* ---------------- 顶部日期 ---------------- */
    function renderHeader() {
      var today = state.isToday();
      el.root.classList.toggle('is-today', today);
      el.addForm.classList.toggle('readonly', !today);

      el.dayLabel.textContent = date.dayLabel(state.viewDay) + ' ' + date.weekdayLabel(state.viewDay) + ' ';
      if (today) {
        var b = document.createElement('b');
        b.textContent = '今天';
        el.dayLabel.appendChild(b);
      }
      el.nextDay.disabled = today;
      if (el.todayBtn) el.todayBtn.hidden = today;
    }

    /* ---------------- 月历 ---------------- */
    function buildCalendar() {
      var y = calMonth.getFullYear();
      var m = calMonth.getMonth();
      el.calTitle.textContent = y + '年' + (m + 1) + '月';
      el.calDays.innerHTML = '';
      var firstDay = new Date(y, m, 1).getDay();
      var totalDays = date.daysInMonth(y, m);
      var prevDays = date.daysInMonth(y, m - 1);
      var todayK = date.todayKey();
      var viewK = state.viewDay;

      function otherCell(n) {
        var btn = document.createElement('button');
        btn.className = 'cal-day other-month';
        btn.type = 'button';
        btn.textContent = n;
        btn.disabled = true;
        el.calDays.appendChild(btn);
      }

      for (var i = firstDay - 1; i >= 0; i--) otherCell(prevDays - i);

      for (var d = 1; d <= totalDays; d++) {
        var dk = y + '-' + date.pad2(m + 1) + '-' + date.pad2(d);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cal-day' +
          (dk === todayK ? ' today' : '') +
          (state.hasTasks(dk) ? ' has-tasks' : '') +
          (dk === viewK ? ' selected' : '');
        btn.textContent = d;
        btn.dataset.day = dk;
        btn.dataset.act = 'calpick';
        btn.title = date.fullLabel(dk);
        el.calDays.appendChild(btn);
      }

      var remaining = (7 - ((firstDay + totalDays) % 7)) % 7;
      for (var j = 1; j <= remaining; j++) otherCell(j);
    }

    function setCalMonth(delta) {
      calMonth.setMonth(calMonth.getMonth() + delta);
      if (el.calendarOverlay.classList.contains('show')) buildCalendar();
    }

    /* ---------------- 每日任务设置 ---------------- */
    function renderSettings() {
      var cfg = state.dailyConfig();
      el.settingsList.innerHTML = '';
      if (!cfg.tasks.length) {
        var empty = document.createElement('li');
        empty.className = 'settings-item';
        empty.style.color = 'var(--ink-3)';
        empty.style.fontSize = '12px';
        empty.textContent = '还没有每日任务，在下面添加一个';
        el.settingsList.appendChild(empty);
      }
      cfg.tasks.forEach(function (t) {
        var li = document.createElement('li');
        li.className = 'settings-item';

        var title = document.createElement('span');
        title.className = 'task-title';
        title.textContent = t.title;
        title.style.cursor = 'text';
        title.dataset.act = 'dailyedit';
        title.dataset.did = t.id;
        title.title = '双击修改';
        li.appendChild(title);

        var del = iconBtn('dailydelete', 'DeleteIcon', '删除');
        del.dataset.did = t.id;
        li.appendChild(del);
        el.settingsList.appendChild(li);
      });
    }

    /* ---------------- 数据备份区 ---------------- */
    function renderData(info) {
      if (!el.dataList) return;
      el.dataList.innerHTML = '';
      var rows = [
        { act: 'data-export', label: '导出备份', hint: '保存全部任务、每日任务与专注记录' },
        { act: 'data-import', label: '从备份导入…', hint: '导入前自动备份；需要恢复时可重新导入旧备份' },
        { act: 'data-reveal', label: '打开备份文件夹', hint: '查看启动时的每日备份和导入前备份' },
        { act: 'data-log', label: '打开日志文件', hint: '排查异常时用' },
        { act: 'data-clear', label: '清空全部数据', hint: '危险操作，会先自动备份', danger: true }
      ];
      rows.forEach(function (r) {
        var li = document.createElement('li');
        li.className = 'settings-item data-item';
        var box = document.createElement('div');
        box.className = 'data-row';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'data-btn' + (r.danger ? ' danger' : '');
        btn.dataset.act = r.act;
        btn.textContent = r.label;
        box.appendChild(btn);
        var hint = document.createElement('span');
        hint.className = 'data-hint';
        hint.textContent = r.hint;
        box.appendChild(hint);
        li.appendChild(box);
        el.dataList.appendChild(li);
      });

      if (el.dataInfo) {
        el.dataInfo.innerHTML = '';
        if (info) {
          var lines = [
            '数据文件：' + (info.storeFile || '-'),
            '备份目录：' + (info.backupDir || '-'),
            '版本：v' + (info.version || '?') + ' · Electron ' + (info.electron || '?')
          ];
          lines.forEach(function (t) {
            var d = document.createElement('div');
            d.textContent = t;
            el.dataInfo.appendChild(d);
          });
        }
      }
    }

    /* ---------------- 行内编辑 ---------------- */
    function inlineEdit(currentText, opts, onCommit) {
      opts = opts || {};
      var input = document.createElement('input');
      input.className = 'edit-input' + (opts.sub ? ' sub' : '') + (opts.min ? ' min' : '');
      input.setAttribute('aria-label', opts.min ? '步骤分钟数' : (opts.sub ? '步骤名称' : '任务名称'));
      input.value = currentText;
      // 标题/步骤文字不设长度上限（只有分钟数输入框限 3 位）
      if (opts.min) { input.maxLength = 3; input.type = 'number'; input.min = '1'; input.max = '180'; }
      if (opts.alarm) { input.maxLength = 5; input.type = 'text'; input.placeholder = 'HH:MM，如 08:30（清空即取消）'; }
      var committed = false;
      function commit(save) {
        if (committed) return;
        committed = true;
        if (save) {
          var v = input.value.trim();
          if (opts.min) {
            var n = Math.round(+v);
            if (n >= 1 && n <= 180) onCommit(n);
          } else if (opts.alarm) {
            var re = /^([01]\d|2[0-3]):[0-5]\d$/;
            if (v && re.test(v)) onCommit(v);
            else if (!v) onCommit('');        // 清空 = 取消闹钟
          } else if (v) {
            onCommit(v);
          }
        }
        if (opts.after) opts.after();
      }
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); commit(true); }
        else if (ev.key === 'Escape') { commit(false); }
        ev.stopPropagation();
      });
      input.addEventListener('blur', function () { commit(true); });
      input.addEventListener('click', function (ev) { ev.stopPropagation(); });
      return input;
    }

    /* ---------------- 单行折叠 / 点击展开 ---------------- */
    var expandedIds = {};   // 本会话内记住哪些标题被展开了

    function clampKey(el, li) {
      return el.classList.contains('subtask-title')
        ? (li.dataset.id + '/' + (el.dataset.sid || ''))
        : li.dataset.id;
    }

    /**
     * 标题默认只显示一行（CSS nowrap + ellipsis），超出时允许点击展开。
     * 每次渲染 / 窗口尺寸变化后都要重算：宽度变了，能放下的字数也变了。
     */
    function applyClamp() {
      var nodes = el.taskList.querySelectorAll('.task-title, .subtask-title');
      Array.prototype.forEach.call(nodes, function (t) {
        var li = t.closest ? t.closest('.todo-item') : null;
        if (!li) return;
        var key = clampKey(t, li);
        var expanded = !!expandedIds[key];

        t.classList.toggle('expanded', expanded);          // 先应用状态，再量宽度
        var overflows = t.scrollWidth > t.clientWidth + 1;
        var clickable = expanded || overflows;
        t.classList.toggle('clampable', clickable);

        if (expanded) {
          t.title = '点击收起';
        } else if (overflows) {
          t.title = t.textContent + '\n（双击修改）';
        } else {
          t.title = '双击修改';
        }
      });
    }

    function toggleExpand(taskId, sid) {
      var key = sid ? (taskId + '/' + sid) : taskId;
      expandedIds[key] = !expandedIds[key];
      applyClamp();
      return expandedIds[key];
    }

    return {
      el: el,
      render: function () { renderHeader(); renderTaskList(); applyClamp(); },
      applyClamp: applyClamp,
      toggleExpand: toggleExpand,
      renderCalendar: buildCalendar,
      renderSettings: renderSettings,
      renderData: renderData,
      setCalMonth: setCalMonth,
      inlineEdit: inlineEdit,
      get calMonth() { return calMonth; },
      syncCalMonthToView: function () {
        var d = date.parseDayKey(state.viewDay);
        if (d) { calMonth = new Date(d.getFullYear(), d.getMonth(), 1); }
      },
      get onlyOpen() { return onlyOpen; },
      setOnlyOpen: function (v) { onlyOpen = !!v; saveView(); },
      toggleCollapse: function (id) { var key = viewKey(id); if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key); saveView(); },
      expandSteps: function (id) { collapsed.delete(viewKey(id)); saveView(); },
      setActiveTask: function (task) { activeTask = task; },
      setTaskTotals: function (totals) { taskTotals = totals; },
      renderTimeline: renderTimeline
    };
  }

  NS.todo.createRender = createRender;
})(typeof window !== 'undefined' ? window : globalThis);
