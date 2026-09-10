/* ============================================================
 * src/timer/ui.js · 专注钟界面装配（DOM 渲染 + 交互）
 * ------------------------------------------------------------
 * 只负责「显示」与「发命令」，不持有计时状态。
 * ============================================================ */
(function (global) {
  'use strict';
  var NS = global.DSH || (global.DSH = {});
  NS.timer = NS.timer || {};
  if (NS.timer.createUI) return;

  var log = NS.log;
  var date = NS.date;

  function $(id) { return document.getElementById(id); }
  function txt(el, s) { if (el && el.textContent !== s) el.textContent = s; }

  function createUI(deps) {
    var state = deps.state;      // DSH.timer.state
    var flow = deps.flow;
    var audio = deps.audio;
    var toast = NS.toast;

    var el = {
      root: $('timer-app'),
      field: $('field'),
      chip: $('stateChip'),
      stateText: $('stateText'),
      time: $('timeText'),
      taskName: $('activeTaskName'),
      center: document.querySelector('.center'),
      dock: document.querySelector('.dock'),
      setupPanel: $('setupPanel'),
      phaseRow: $('phaseRow'),
      breakRow: $('breakRow'),
      customMin: $('customMin'),
      customHint: $('customHint'),
      applyCustomMin: $('applyCustomMin'),
      closeSetup: $('closeSetup'),
      closeSettings: $('closeSettings'),
      startBtn: $('startBtn'),
      setupBtn: $('setupBtn'),
      resetBtn: $('resetBtn'),
      doneScreen: $('doneScreen'),
      doneEmoji: $('doneEmoji'),
      doneTitle: $('doneTitle'),
      doneSub: $('doneSub'),
      doneDetail: $('doneDetail'),
      doneAgain: $('doneAgain'),
      doneBreak: $('doneBreak'),
      doneEnd: $('doneEnd'),
      verText: $('verText'),
      setBtn: $('setBtn'),
      setPanel: $('setPanel'),
      setSound: $('setSound'),
      setNotify: $('setNotify'),
      setMotion: $('setMotion'),
      setHC: $('setHC'),
      setSeconds: $('setSeconds'),
      setTray: $('setTray'),
      setCloseTray: $('setCloseTray'),
      setHint: $('setHint'),
      pinBtn: $('pinBtn'),
      wcloseBtn: $('wcloseBtn')
    };

    var lastSnap = null;
    var setupOpen = false;
    var doneVisible = false;
    var lastDonePayload = null;
    var settingsDialog = NS.createDialog(el.setPanel, closeSettings);
    var setupDialog = NS.createDialog(el.setupPanel, closeSetup);
    var doneDialog = NS.createDialog(el.doneScreen, hideDone);
    function closeSettings() {
      el.setPanel.hidden = true;
      el.setBtn.setAttribute('aria-expanded', 'false');
      settingsDialog.close();
    }
    function closeSetup() {
      setupOpen = false;
      el.setupPanel.hidden = true;
      el.setupBtn.setAttribute('aria-expanded', 'false');
      setupDialog.close();
    }

    /* ---------------- 文本工具 ---------------- */
    function mmss(ms, showSeconds) {
      var sec = Math.max(0, Math.round(ms / 1000));
      if (!showSeconds) sec = Math.ceil(sec / 60) * 60;
      return date.fmtClock(sec);
    }

    function chipState(t, snap) {
      if (doneVisible) return { key: 'idle', text: '待机中' };
      if (t.phase !== 'focus') {
        return t.running
          ? { key: 'break', text: (t.phase === 'short' ? '短休息中' : '长休息中') }
          : { key: 'idle', text: t.idle ? '待机中' : '休息已暂停' };
      }
      if (t.running) return t.recovered ? { key: 'recovered', text: '恢复中' } : { key: 'running', text: '专注中' };
      if (t.paused) return { key: 'paused', text: '已暂停' };
      return { key: 'idle', text: '待机中' };
    }

    /* ---------------- 数字居中 ----------------
     * 以符号海区域（dock 上沿以上 = .field）为基准居中数字；
     * 数字已在 .field 几何居中，不做下移到窗口中心的移动。
     */
    function fitCenter() {
      if (!el.center) return;
      if (el.center.style.transform !== '') el.center.style.transform = '';
    }

    /* ---------------- 主渲染 ---------------- */
    function render(snap, remainMs) {
      if (!snap) return;
      lastSnap = snap;
      var t = snap.timer;
      var prefs = snap.prefs;
      var remain = (typeof remainMs === 'number') ? remainMs : t.leftMs;

      document.body.classList.toggle('hc', !!prefs.highContrast);
      document.body.dataset.motion = prefs.motion;
      document.body.dataset.task = t.task ? 'true' : 'false';
      txt(el.taskName, t.task ? t.task.title : '');
      el.taskName.hidden = !t.task;
      el.taskName.title = t.task ? t.task.title : '';
      flow && flow.setPaused && flow.setPaused(!!t.paused);

      /* 状态徽章：进行中/暂停时带剩余时间，空闲仅『待机中』 */
      var st = chipState(t, snap);
      if (el.chip) el.chip.dataset.state = st.key;
      var stText = st.text;
      if (t.running || t.paused) {
        stText = st.text + ' · ' + mmss(remain, false);
      }
      txt(el.stateText, stText);

      /* 时间 */
      txt(el.time, mmss(remain, prefs.showSeconds));

      var isBreak = t.phase !== 'focus';

      /* 按钮 */
      var idle = t.idle;
      txt(el.startBtn, t.running ? '暂停' : (idle ? (isBreak ? '开始休息' : '开始') : '继续'));
      el.startBtn.dataset.mode = isBreak ? 'break' : 'focus';
      el.startBtn.hidden = doneVisible;
      el.setupBtn.hidden = !idle || doneVisible;
      el.resetBtn.hidden = idle || doneVisible;
      txt(el.setupBtn, Math.round(t.totalSec / 60) + ' 分钟');
      if (el.setupBtn.hidden && setupOpen) closeSetup();
      el.setupPanel.hidden = !setupOpen || doneVisible;

      /* 时长选择高亮 */
      var mins = Math.round(t.totalSec / 60);
      var chips = el.phaseRow.querySelectorAll('[data-min]');
      for (var i = 0; i < chips.length; i++) {
        chips[i].setAttribute('aria-pressed', (+chips[i].dataset.min === mins && t.phase === 'focus') ? 'true' : 'false');
      }
      var bchips = el.breakRow.querySelectorAll('[data-phase]');
      for (var j = 0; j < bchips.length; j++) {
        bchips[j].setAttribute('aria-pressed', bchips[j].dataset.phase === t.phase ? 'true' : 'false');
      }

      /* 今日统计（已在状态栏第二行输出，这里不再重复） */

      paintSettings(snap);
      fitCenter();
    }

    /* ---------------- 完成界面 ---------------- */
    function showDone(ev) {
      closeSettings();
      closeSetup();
      lastDonePayload = ev;
      doneVisible = true;
      var isBreak = ev.phase !== 'focus';
      txt(el.doneEmoji, isBreak ? '☕' : '🎉');
      txt(el.doneTitle, isBreak ? '休息结束' : '专注完成！');

      el.doneSub.innerHTML = '';
      function seg(s, bold) {
        if (bold) { var b = document.createElement('b'); b.textContent = s; el.doneSub.appendChild(b); }
        else el.doneSub.appendChild(document.createTextNode(s));
      }
      if (isBreak) {
        seg('休息 '); seg(ev.plannedMinutes + ' 分钟', true);
        seg(' · 今日已专注 '); seg(ev.minutesToday + ' 分钟', true);
      } else {
        seg('本轮 '); seg(ev.plannedMinutes + ' 分钟', true);
        seg(' · 今日第 '); seg(ev.rounds + ' 轮', true);
        seg(' · 累计 '); seg(ev.minutesToday + ' 分钟', true);
      }
      if (ev.taskTitle) { seg(' · '); seg(ev.taskTitle, false); }

      /* 中断记录：实际时长 / 暂停次数 / 总暂停时间 */
      el.doneDetail.innerHTML = '';
      var line1 = document.createElement('div');
      line1.innerHTML = '实际用时 <b>' + ev.actualMinutes + ' 分钟</b>' +
        (ev.pauseCount > 0
          ? ' · 暂停 <b>' + ev.pauseCount + ' 次</b> · 共 <b>' + Math.round(ev.pausedMs / 60000) + ' 分钟</b>'
          : ' · 中途没有暂停');
      el.doneDetail.appendChild(line1);
      var line2 = document.createElement('div');
      line2.textContent = '开始 ' + (ev.startedAt ? new Date(ev.startedAt).toTimeString().slice(0, 5) : '--:--') +
        ' · 结束 ' + new Date(ev.finishedAt).toTimeString().slice(0, 5);
      el.doneDetail.appendChild(line2);

      el.doneBreak.textContent = '休息 ' + Math.round((lastSnap ? lastSnap.phases.short : 300) / 60) + ' 分钟';
      el.doneScreen.hidden = false;
      if (lastSnap) render(lastSnap, lastSnap.timer.leftMs);
      doneDialog.open(el.doneBreak);
    }

    function hideDone() {
      doneVisible = false;
      el.doneScreen.hidden = true;
      if (lastSnap) render(lastSnap, lastSnap.timer.leftMs);
      doneDialog.close();
    }

    function celebrate() {
      try {
        var rect = el.field.getBoundingClientRect();
        var colors = ['#007CFF', '#91D4FF', '#002E58', '#00A1FF'];
        for (var i = 0; i < 16; i++) {
          var bit = document.createElement('span');
          bit.className = 'confetti-bit';
          bit.style.left = (rect.width / 2) + 'px';
          bit.style.top = (rect.height * 0.35) + 'px';
          bit.style.background = colors[i % colors.length];
          bit.style.setProperty('--dx', (Math.random() * 200 - 100) + 'px');
          bit.style.setProperty('--dy', (Math.random() * -130 - 20) + 'px');
          el.field.appendChild(bit);
          (function (b) { setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 1000); })(bit);
        }
      } catch (e) { if (log) log.warn('庆祝动画失败', e); }
    }

    /* ---------------- 设置面板 ---------------- */
    function paintSettings(snap) {
      var p = snap.prefs;
      function toggle(node, on) {
        if (!node) return;
        node.classList.toggle('on', !!on);
        node.setAttribute('aria-checked', on ? 'true' : 'false');
      }
      toggle(el.setSound, p.sound);
      toggle(el.setNotify, p.notify);
      toggle(el.setHC, p.highContrast);
      toggle(el.setSeconds, p.showSeconds);
      toggle(el.setTray, p.tray);
      toggle(el.setCloseTray, p.closeToTray);
      var chips = el.setMotion.querySelectorAll('[data-m]');
      for (var i = 0; i < chips.length; i++) {
        chips[i].setAttribute('aria-pressed', chips[i].dataset.m === p.motion ? 'true' : 'false');
      }
    }

    /* ---------------- 事件绑定 ---------------- */
    function bind() {
      el.startBtn.addEventListener('click', function () {
        audio && audio.unlock();
        state.cmd('toggle');
      });

      el.resetBtn.addEventListener('click', function () { state.cmd('reset'); });
      el.setupBtn.addEventListener('click', function () {
        setupOpen = true;
        el.setupPanel.hidden = false;
        el.setupBtn.setAttribute('aria-expanded', 'true');
        setupDialog.open(el.phaseRow.querySelector('[aria-pressed="true"]') || el.closeSetup);
      });
      el.closeSetup.addEventListener('click', closeSetup);

      el.phaseRow.addEventListener('click', function (ev) {
        var chip = ev.target && ev.target.closest ? ev.target.closest('[data-min]') : null;
        if (!chip) return;
        closeSetup();
        state.cmd('setDuration', { sec: (+chip.dataset.min) * 60 });
        state.cmd('setPhase', { phase: 'focus' });
        setupOpen = false;
      });

      el.breakRow.addEventListener('click', function (ev) {
        var chip = ev.target && ev.target.closest ? ev.target.closest('[data-phase]') : null;
        if (!chip) return;
        closeSetup();
        state.cmd('setPhase', { phase: chip.dataset.phase });
        setupOpen = false;
      });

      function applyCustom() {
        var n = Number(el.customMin.value);
        if (!Number.isInteger(n) || n < 1 || n > 180) {
          el.customMin.setAttribute('aria-invalid', 'true');
          txt(el.customHint, '请输入 1–180 之间的整数分钟。');
          el.customMin.focus();
          return;
        }
        el.customMin.removeAttribute('aria-invalid');
        txt(el.customHint, '1–180 分钟，按自己的节奏来。');
        el.customMin.value = '';
        closeSetup();
        state.cmd('setDuration', { sec: n * 60 });
        state.cmd('setPhase', { phase: 'focus' });
        setupOpen = false;
      }
      el.customMin.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); applyCustom(); }
        ev.stopPropagation();
      });
      el.applyCustomMin.addEventListener('click', applyCustom);

      /* 完成界面 */
      el.doneAgain.addEventListener('click', function () {
        hideDone();
        state.cmd('setPhase', { phase: 'focus' });
        state.cmd('start');
      });
      el.doneBreak.addEventListener('click', function () {
        hideDone();
        state.cmd('setPhase', { phase: 'short' });
        state.cmd('start');
      });
      el.doneEnd.addEventListener('click', function () {
        hideDone();
      });

      /* 设置面板 */
      el.setBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        el.setPanel.hidden = false;
        el.setBtn.setAttribute('aria-expanded', 'true');
        if (lastSnap) paintSettings(lastSnap);
        settingsDialog.open(el.closeSettings);
      });
      el.closeSettings.addEventListener('click', closeSettings);
      el.setSound.addEventListener('click', function () {
        var on = !(lastSnap && lastSnap.prefs.sound);
        if (on) audio && audio.unlock();
        state.setPrefs({ sound: on });
      });
      el.setNotify.addEventListener('click', function () {
        var on = !(lastSnap && lastSnap.prefs.notify);
        state.setPrefs({ notify: on });
      });
      el.setHC.addEventListener('click', function () {
        state.setPrefs({ highContrast: !(lastSnap && lastSnap.prefs.highContrast) });
        flow && flow.invalidateSprites();
        flow && flow.draw();
      });
      el.setSeconds.addEventListener('click', function () {
        state.setPrefs({ showSeconds: !(lastSnap && lastSnap.prefs.showSeconds) });
      });
      el.setTray.addEventListener('click', function () {
        state.setTray(!(lastSnap && lastSnap.prefs.tray));
      });
      el.setCloseTray.addEventListener('click', function () {
        state.setPrefs({ closeToTray: !(lastSnap && lastSnap.prefs.closeToTray) });
      });
      el.setMotion.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-m]') : null;
        if (!b) return;
        state.setPrefs({ motion: b.dataset.m });
      });

      /* 紧凑小窗按钮 */
      if (global.dshTimer) {
        var pinBtn = el.pinBtn;
        var wclose = el.wcloseBtn;
        if (pinBtn && global.dshTimer.getPin) {
          function refreshPin(on) {
            pinBtn.classList.toggle('off', !on);
            pinBtn.setAttribute('aria-pressed', String(!!on));
            pinBtn.title = on ? '已置顶（点击取消）' : '未置顶（点击置顶）';
          }
          global.dshTimer.getPin().then(refreshPin).catch(function (e) { if (log) log.warn('读取置顶状态失败', e); });
          pinBtn.addEventListener('click', function () {
            global.dshTimer.togglePin().then(refreshPin).catch(function (e) { if (log) log.warn('切换置顶失败', e); });
          });
        }
        if (wclose) wclose.addEventListener('click', function () { global.dshTimer.close(); });
      }

      /* 键盘快捷键 */
      document.addEventListener('keydown', function (ev) {
        if (ev.defaultPrevented || !el.setPanel.hidden || setupOpen || doneVisible) return;
        if (ev.target && (ev.target.closest('button,input,textarea,select,a,[contenteditable="true"]'))) return;
        if (ev.code === 'Space') { ev.preventDefault(); audio && audio.unlock(); state.cmd('toggle'); }
        else if (ev.key === 'r' || ev.key === 'R') { state.cmd('reset'); }
        else if (ev.key === 'Escape') { if (!el.setPanel.hidden) el.setPanel.hidden = true; else if (doneVisible) hideDone(); }
      });
    }

    return {
      el: el,
      bind: bind,
      render: render,
      fitCenter: fitCenter,
      showDone: showDone,
      hideDone: hideDone,
      celebrate: celebrate,
      get lastSnapshot() { return lastSnap; },
      get doneVisible() { return doneVisible; },
      setVersion: function (v) { txt(el.verText, v ? 'v' + v : ''); }
    };
  }

  NS.timer.createUI = createUI;
})(typeof window !== 'undefined' ? window : globalThis);
