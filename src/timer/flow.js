/* ============================================================
 * src/timer/flow.js · 纵向字符海渲染
 * ------------------------------------------------------------
 * 性能设计（目标 120 FPS）：
 *   1) 字符精灵缓存：把「符号 × 颜色」预渲染成小离屏画布，
 *      每帧用 drawImage 代替 fillText（数量级更快）
 *   2) 自适应密度：按窗口面积决定字符格边长与最大格数，
 *      小窗自动降密度，避免小窗里画大窗的量
 *   3) alpha 量化：把每格透明度量化到 1/16 步，减少状态切换
 *   4) 按需绘制：动画关闭时完全停掉 rAF，只在状态/尺寸变化时画一帧
 *   5) 自动降级：连续多帧超预算时自动减密度（可恢复）
 * ============================================================ */
(function (global) {
  'use strict';
  var NS = global.DSH || (global.DSH = {});
  NS.timer = NS.timer || {};
  if (NS.timer.createFlow) return;

  var RAMP = ' ·,()~≈○∿≋';
  /* 贴 paper→surface 白底，但拉开明暗对比：
     idx 小=亮（近水面），idx 大=深（水下暗蓝）——梯度感即"海" */
  var COLORS = ['#eaf5ff', '#c9e8ff', '#93d3ff', '#4dabff', '#1877e0', '#0b4f96', '#062f5c'];
  var HC_COLORS = ['#f4faff', '#dcefff', '#b7e0ff', '#7cc0ff', '#3d9dff', '#1a63c4', '#0b3f7e'];

  var FRAME_MS = 1000 / 120;      // 目标 120 FPS
  var ALPHA_STEPS = 16;

  function createFlow(opts) {
    var canvas = opts.canvas;
    var host = opts.host || canvas.parentNode;
    var getView = opts.getView;      // () => { remainRatio, running, paused, idle, highContrast, motion }
    var log = NS.log;

    var ctx = canvas.getContext('2d');
    var w = 0, h = 0, cols = 0, rows = 0, cell = 14, dpr = 1;
    var sprites = {};                // "symbol|colorIndex" -> canvas
    var spriteCell = 0;
    var raf = 0;
    var lastF = 0;
    var frozenT = 1.5;
    var levelShown = 1;
    var frameCost = 0;
    var slowStreak = 0;
    var densityScale = 1;
    var lastDrawKey = null;
    var running = false;
    var drawCount = 0;

    function isMotionOn() {
      var v = getView() || {};
      return v.motion !== 'off';
    }

    /* ---------- 精灵缓存 ---------- */
    function buildSprites() {
      var px = Math.max(8, Math.round(cell * dpr));
      if (spriteCell === px && Object.keys(sprites).length) return;
      spriteCell = px;
      sprites = {};
      var colors = (getView() || {}).highContrast ? HC_COLORS : COLORS;
      var off = document.createElement('canvas');
      off.width = px; off.height = px;
      var octx = off.getContext('2d');
      var font = Math.max(8, Math.round(px * 0.92)) + 'px ui-monospace, Menlo, "DejaVu Sans Mono", Consolas, monospace';
      for (var s = 0; s < RAMP.length; s++) {
        for (var c = 0; c < colors.length; c++) {
          octx.clearRect(0, 0, px, px);
          octx.font = font;
          octx.textAlign = 'center';
          octx.textBaseline = 'middle';
          octx.fillStyle = colors[c];
          octx.fillText(RAMP[s], px / 2, px / 2 + px * 0.02);
          var key = s + '|' + c;
          var img = document.createElement('canvas');
          img.width = px; img.height = px;
          img.getContext('2d').drawImage(off, 0, 0);
          sprites[key] = img;
        }
      }
    }

    /* ---------- 尺寸 / 密度 ---------- */
    function resize() {
      var cw = host.clientWidth || 0;
      var ch = host.clientHeight || 0;
      if (!cw || !ch) return false;
      dpr = Math.min(2, global.devicePixelRatio || 1);
      var pw = Math.max(1, Math.round(cw * dpr));
      var ph = Math.max(1, Math.round(ch * dpr));
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      w = cw; h = ch;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lastDrawKey = null;   // 尺寸变了必须重绘一帧

      // 目标格数：小窗明显更少
      var compact = cw < 460 || ch < 480;
      var maxCells = (compact ? 820 : 2300) * densityScale;
      var ideal = Math.sqrt((cw * ch) / maxCells);
      cell = Math.max(9, Math.min(compact ? 14 : 18, Math.round(ideal)));
      cols = Math.max(1, Math.ceil(cw / cell));
      rows = Math.max(1, Math.ceil(ch / cell));
      buildSprites();
      return true;
    }

    /* ---------- 密度场（哈希） ---------- */
    function cellHash(a, b) {
      var x = (Math.imul(a + 1, 374761393) + Math.imul(b + 1, 668265263)) | 0;
      x = Math.imul(x ^ (x >>> 13), 1274126177);
      return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
    }

    /* ---------- 单帧 ---------- */
    function draw(tSec) {
      if (!ctx || !w || !h) { if (!resize()) return; }
      var t0 = (global.performance || Date).now();
      drawCount++;

      var view = getView() || {};
      var remain = (typeof view.remainRatio === 'number') ? view.remainRatio : 1;
      remain = Math.max(0, Math.min(1, remain));

      // 暂停 / 未开始：水面与波浪完全静止
      var still = !!view.paused || !!view.idle || view.motion === 'off';
      var target = remain;
      levelShown += (target - levelShown) * (view.running ? 0.12 : 0.07);
      if (Math.abs(target - levelShown) < 0.0015) levelShown = target;

      if (still) { /* 时间冻结，保持当前波形 */ }
      else {
        var hurry = view.running && view.remainSec <= 60 && view.remainSec > 0;
        var mf = view.motion === 'calm' ? 0.5 : 1;
        frozenT = (tSec || 0) * (hurry ? 2.2 : (view.running ? 1 : 0.55)) * mf;
      }
      var tt = frozenT;

      // 脏检查：静止且水位已收敛时，画面与本帧完全一致，跳过重绘（省 CPU）
      if (still && tt === lastDrawKey) return;
      lastDrawKey = tt;

      ctx.clearRect(0, 0, w, h);

      var colors = view.highContrast ? HC_COLORS : COLORS;
      var wl = 1 - levelShown;
      var half = cell / 2;
      var curAlpha = -1;
      var n = RAMP.length - 1;

      for (var r = 0; r < rows; r++) {
        var y = r * cell + half;
        var v = y / h;
        for (var c = 0; c < cols; c++) {
          var x = c * cell + half;
          var u = x / w;
          var H = (v - wl) * 1.15 + 0.42
            + 0.14 * Math.sin(u * 4.2 - tt * 1.3 + v * 1.5)
            + 0.10 * Math.sin(v * 3.4 + tt * 0.9);
          if (H <= 0) continue;
          if (H > 1) H = 1;
          var dens = H * H * (3 - 2 * H);
          /* 深度梯度：H 越大（水下越深）密度骤增、更不透光 → 水面亮稀、深处暗密 */
          var depthBias = 0.10 + 0.9 * dens * (0.35 + 0.65 * dens);
          if (cellHash(c * 7 + 1, r * 5 + 2) > depthBias) continue;

          var idx = Math.max(1, Math.floor(H * n));
          var ci = Math.round((idx / n) * (colors.length - 1));
          var alpha = 0.4 + 0.6 * H;
          if (view.highContrast) alpha = Math.min(1, alpha + 0.22);
          var bucket = Math.round(alpha * ALPHA_STEPS) / ALPHA_STEPS;
          if (bucket !== curAlpha) { ctx.globalAlpha = bucket; curAlpha = bucket; }
          var sp = sprites[idx + '|' + ci];
          if (sp) ctx.drawImage(sp, x - half, y - half, cell, cell);
        }
      }
      ctx.globalAlpha = 1;

      // 帧耗时自适应：连续偏慢就降密度
      var cost = (global.performance || Date).now() - t0;
      frameCost = frameCost * 0.9 + cost * 0.1;
      if (frameCost > 9 && densityScale > 0.55) {
        slowStreak++;
        if (slowStreak >= 40) {
          densityScale = Math.max(0.55, densityScale - 0.15);
          slowStreak = 0;
          resize();
          if (log) log.warn('字符海渲染偏慢（' + frameCost.toFixed(1) + 'ms/帧），密度降到 ' + densityScale.toFixed(2));
        }
      } else if (frameCost < 4) {
        slowStreak = 0;
        if (densityScale < 1 && Math.random() < 0.01) { densityScale = Math.min(1, densityScale + 0.05); resize(); }
      }
    }

    /* ---------- 循环 ---------- */
    function loop(now) {
      raf = global.requestAnimationFrame(loop);
      var dt = now - lastF;
      if (dt < FRAME_MS - 0.2) return;          // 120 FPS 上限
      // 用累加器保持平均帧率，避免在 165Hz 屏上被量化成 ~82 FPS
      lastF += FRAME_MS * Math.max(1, Math.floor(dt / FRAME_MS));
      if (now - lastF > 120) lastF = now;       // 长时间挂起后重新对齐
      draw(now / 1000);
    }

    function start() {
      if (running) return;
      if (document.hidden) return;
      running = true;
      lastF = 0;
      raf = global.requestAnimationFrame(loop);
    }

    function stop() {
      running = false;
      if (raf) { global.cancelAnimationFrame(raf); raf = 0; }
    }

    function drawOnce() { draw((global.performance || Date).now() / 1000); }

    function setPaused() { /* 兼容占位：暂停逻辑由 getView().paused 决定 */ }

    return {
      resize: resize,
      draw: drawOnce,
      start: start,
      stop: stop,
      get running() { return running; },
      get drawCount() { return drawCount; },
      get metrics() { return { cell: cell, cols: cols, rows: rows, cells: cols * rows, frameCost: frameCost, densityScale: densityScale, targetFps: Math.round(1000 / FRAME_MS), drawCount: drawCount }; },
      invalidateSprites: function () { spriteCell = 0; sprites = {}; buildSprites(); }
    };
  }

  NS.timer.createFlow = createFlow;
  NS.timer.RAMP = RAMP;
  NS.timer.COLORS = COLORS;
})(typeof window !== 'undefined' ? window : globalThis);
