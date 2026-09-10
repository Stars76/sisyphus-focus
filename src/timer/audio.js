/* ============================================================
 * src/timer/audio.js · 完成提示音（Web Audio 合成，无音频文件）
 * ------------------------------------------------------------
 * 专注完成：上行铃 E5-G5-C6-E6
 * 休息结束：下行柔铃 C6-G5-E5
 * 需要在用户手势后解锁（首次点「开始」时调用 unlock()）
 * ============================================================ */
(function (global) {
  'use strict';
  var NS = global.DSH || (global.DSH = {});
  NS.timer = NS.timer || {};
  if (NS.timer.createAudio) return;

  function createAudio(opts) {
    opts = opts || {};
    var log = NS.log;
    var ctx = null;
    var unlocked = false;

    function ensure() {
      try {
        var Ctx = global.AudioContext || global.webkitAudioContext;
        if (!Ctx) return null;
        if (!ctx) ctx = new Ctx();
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
      } catch (e) {
        if (log) log.warn('音频初始化失败', e);
        return null;
      }
    }

    function unlock() {
      var c = ensure();
      if (!c) return false;
      unlocked = true;
      return true;
    }

    function tone(freq, at, dur, gain, type) {
      var c = ctx;
      var o = c.createOscillator();
      var g = c.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(gain, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(g); g.connect(c.destination);
      o.start(at); o.stop(at + dur + 0.06);
    }

    function play(kind) {
      var c = ensure();
      if (!c) return;
      try {
        var now = c.currentTime;
        var seq;
        if (kind === 'break') {
          seq = [[1046.50, 0], [783.99, 0.16], [659.25, 0.32]];
        } else if (kind === 'warn') {
          seq = [[880, 0], [880, 0.18]];
        } else {
          seq = [[659.25, 0], [783.99, 0.14], [1046.50, 0.28], [1318.51, 0.42]];
        }
        seq.forEach(function (n) {
          tone(n[0], now + n[1], kind === 'break' ? 0.55 : 0.6, kind === 'warn' ? 0.16 : 0.22);
        });
      } catch (e) {
        if (log) log.warn('播放提示音失败', e);
      }
    }

    return {
      unlock: unlock,
      play: play,
      get unlocked() { return unlocked; },
      get available() { return !!(global.AudioContext || global.webkitAudioContext); }
    };
  }

  NS.timer.createAudio = createAudio;
})(typeof window !== 'undefined' ? window : globalThis);
