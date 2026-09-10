/* ============================================================
 * src/timer/app.js · 专注钟启动装配
 * ------------------------------------------------------------
 * 顺序：存储 -> 计时状态 -> 渲染器 -> 音频 -> 界面 -> 订阅
 * ============================================================ */
(function (global) {
  'use strict';
  var NS = global.DSH || (global.DSH = {});
  var log = NS.log;
  var state = NS.timer.state;

  function boot() {
    if (document.getElementById('timer-app').dataset.booted === '1') return;
    document.getElementById('timer-app').dataset.booted = '1';

    NS.store.init();

    /* ---------- 动画偏好：系统「减少动态效果」优先 ---------- */
    var reduced = false, motionQuery;
    try { motionQuery = global.matchMedia('(prefers-reduced-motion: reduce)'); reduced = motionQuery.matches; } catch (e) { }

    var lastRenderAt = 0;
    var lastPrefs = null;

    function prefsOf() {
      var s = state.snapshot();
      return (s && s.prefs) || { motion: 'full', highContrast: false, showSeconds: true, sound: true, notify: true };
    }

    function effectiveMotion() {
      var m = prefsOf().motion;
      if (reduced) return 'off';
      return m;
    }

    /* ---------- 字符海 ---------- */
    var flow = NS.timer.createFlow({
      canvas: document.getElementById('flow'),
      host: document.getElementById('timer-app'),
      getView: function () {
        var s = state.snapshot();
        if (!s) return { remainRatio: 1, motion: effectiveMotion() };
        var t = s.timer;
        return {
          remainRatio: t.totalSec > 0 ? (state.remainMs() / (t.totalSec * 1000)) : 1,
          remainSec: Math.ceil(state.remainMs() / 1000),
          running: t.running,
          paused: t.paused,
          idle: t.idle,
          motion: effectiveMotion(),
          highContrast: !!s.prefs.highContrast
        };
      }
    });

    /* ---------- 音频 ---------- */
    var audio = NS.timer.createAudio({});

    // 暴露渲染器实例，便于调试 / 冒烟测试读取帧率指标
    NS.timer.flow = flow;

    /* ---------- 界面 ---------- */
    var ui = NS.timer.createUI({ state: state, flow: flow, audio: audio });
    ui.bind();
    NS.timer.__ui = ui;      // 调试 / 截图用

    function applyMotion() {
      var m = effectiveMotion();
      var snap = state.snapshot();
      var paused = snap && snap.timer.paused;
      flow.resize();
      if (m === 'off' || paused) {
        flow.stop();
        flow.draw();                       // 只在需要时画一帧，不再每秒空转
      } else {
        flow.start();
      }
    }
    if (motionQuery && motionQuery.addEventListener) motionQuery.addEventListener('change', function (event) {
      reduced = event.matches;
      applyMotion();
    });

    function onUpdate(snap) {
      if (!snap) return;
      var m = effectiveMotion();
      var paused = snap.timer.paused;
      var motionChanged = !lastPrefs ||
        lastPrefs.motion !== snap.prefs.motion ||
        lastPrefs.highContrast !== snap.prefs.highContrast;
      lastPrefs = snap.prefs;

      if (motionChanged) { flow.invalidateSprites(); applyMotion(); }

      // 动画关闭 / 暂停时：状态变化才画一帧（每秒最多一次，且只在水位变化时）
      if (m === 'off' || paused) {
        var now = Date.now();
        if (now - lastRenderAt > 200) { lastRenderAt = now; flow.draw(); }
      }

      ui.render(snap, state.remainMs());
    }

    /* ---------- 事件 ---------- */
    function onEvent(ev) {
      if (!ev) return;
      if (ev.type === 'done') {
        ui.showDone(ev);
        if (!ev.silent) {
          ui.celebrate();
          if (prefsOf().sound) audio.play(ev.phase === 'focus' ? 'focus' : 'break');
        }
      } else if (ev.type === 'abandoned') {
        if (NS.toast) {
          NS.toast.show('已放弃本轮（' + ev.plannedMinutes + ' 分钟，未计入统计）', { type: 'warn' });
        }
      } else if (ev.type === 'await-plan') {
        // 任务侧发起专注：先绑定任务并打开计划选择器，让用户选完再开始
        ui.openSetup();
      } else if (ev.type === 'plan-set') {
        if (NS.toast) NS.toast.show('已选计划「' + ev.name + '」（共 ' + ev.steps + ' 段），点「开始」开跑', { type: 'ok', ms: 3500 });
      } else if (ev.type === 'plan-advance') {
        if (NS.toast) {
          NS.toast.show(ev.name + ' · 第 ' + (ev.index + 1) + '/' + ev.total + ' 段：' + (ev.phase === 'focus' ? '专注' : '休息') + ' ' + ev.minutes + ' 分钟', { type: 'info', ms: 3000 });
        }
      } else if (ev.type === 'day-rollover') {
        log.info('跨天：专注统计已重置为 ' + ev.day);
      }
    }

    /* ---------- 尺寸 / 可见性 ---------- */
    flow.resize();
    if (typeof ResizeObserver === 'function') {
      try {
        var ro = new ResizeObserver(function () {
          flow.resize();
          ui.fitCenter();
          if (effectiveMotion() === 'off' || (state.snapshot() && state.snapshot().timer.paused)) flow.draw();
        });
        ro.observe(document.getElementById('timer-app'));
        if (ui.el && ui.el.dock) ro.observe(ui.el.dock);   // dock 折行变高也要重新居中
      } catch (e) { log.warn('ResizeObserver 不可用', e); }
    } else {
      global.addEventListener('resize', function () { flow.resize(); flow.draw(); ui.fitCenter(); });
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { flow.stop(); }
      else { applyMotion(); }
    });
    // 窗口失焦（被遮挡/切走）且计时未运行时也停动画，省 CPU
    global.addEventListener('blur', function () {
      var snap = state.snapshot && state.snapshot();
      if (!snap || !snap.timer || !snap.timer.running) flow.stop();
    });
    global.addEventListener('focus', function () { applyMotion(); });

    /* ---------- 紧凑小窗标记 ---------- */
    var compact = /[?&]compact=1/.test(location.search);
    if (compact) document.body.classList.add('compact');

    /* ---------- 启动 ---------- */
    state.init().then(function (snap) {
      if (compact) document.body.classList.add('compact');
      ui.render(snap, state.remainMs());
      applyMotion();
      // 任务侧发起专注：无论 await-plan 事件是否在小窗订阅前发出，
      // 只要「已绑定任务且处于等待选计划」就保证弹出计划选择器
      if (snap && snap.timer && snap.timer.idle && snap.timer.awaitPlan && snap.timer.task) {
        ui.openSetup();
      }
      if (snap && snap.timer.recovered) {
        log.info('计时已恢复，剩余 ' + Math.ceil(snap.timer.leftMs / 1000) + 's');
      }
      if (global.dshApp && global.dshApp.info) {
        global.dshApp.info().then(function (info) {
          ui.setVersion(info.version);
          log.info('运行环境 Electron ' + info.electron + ' · 存储 ' + info.storeFile);
        }).catch(function (e) { log.warn('读取应用信息失败', e); });
      }
    }).catch(function (e) {
      log.error('专注钟启动失败', e);
      if (NS.toast) NS.toast.show('专注钟初始化失败，请查看日志', { type: 'error' });
    });

    state.onUpdate(onUpdate);
    state.onEvent(onEvent);

    /* ---------- 保存失败提示 ---------- */
    NS.store.onSaveError(function () {
      if (NS.toast) NS.toast.show('数据保存失败，请在「今日事 → 设置 → 数据备份」里导出备份', { type: 'error', ms: 8000 });
    });

    log.info('专注钟已启动（' + (compact ? '紧凑小窗' : '主视图') + '，动画目标 120 FPS）');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
