/* ============================================================
 * src/shared/toast.js · 轻量提示条
 * ------------------------------------------------------------
 *   DSH.toast.show("数据保存失败，请导出备份", { type: "error", ms: 6000 });
 *   DSH.toast.show("已导入 12 项", { type: "ok", action: { label: "撤销", onClick: fn } });
 * ============================================================ */
(function (global) {
  'use strict';
  var NS = global.DSH || (global.DSH = {});
  if (NS.toast) return;

  var CSS_ID = 'dsh-toast-style';
  var host = null;

  function ensureStyle() {
    if (document.getElementById(CSS_ID)) return;
    var st = document.createElement('style');
    st.id = CSS_ID;
    st.textContent =
      '.dsh-toast-host{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:9999;' +
      'display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;max-width:92vw;}' +
      '.dsh-toast{pointer-events:auto;display:flex;align-items:center;gap:10px;' +
      'padding:9px 14px;border-radius:10px;font-size:12.5px;line-height:1.4;' +
      'background:#002E58;color:#fff;box-shadow:0 10px 26px rgba(0,46,88,.28);' +
      'opacity:0;transform:translateY(8px);transition:opacity .18s ease,transform .18s ease;' +
      'font-family:var(--k-sans,"Segoe UI",sans-serif);}' +
      '.dsh-toast.in{opacity:1;transform:translateY(0);}' +
      '.dsh-toast.warn{background:#8A5A00;}' +
      '.dsh-toast.error{background:#A4262C;}' +
      '.dsh-toast.ok{background:#0B6B4F;}' +
      '.dsh-toast button{flex:none;border:none;border-radius:6px;padding:3px 9px;cursor:pointer;' +
      'background:rgba(255,255,255,.18);color:#fff;font:inherit;font-weight:600;}' +
      '.dsh-toast button:hover{background:rgba(255,255,255,.3);}';
    document.head.appendChild(st);
  }

  function ensureHost() {
    if (host && host.isConnected) return host;
    ensureStyle();
    host = document.createElement('div');
    host.className = 'dsh-toast-host';
    document.body.appendChild(host);
    return host;
  }

  function show(text, opts) {
    opts = opts || {};
    var h = ensureHost();
    var box = document.createElement('div');
    box.className = 'dsh-toast ' + (opts.type || 'info');
    box.setAttribute('role', opts.type === 'error' ? 'alert' : 'status');
    box.setAttribute('aria-atomic', 'true');
    var span = document.createElement('span');
    span.textContent = String(text);
    box.appendChild(span);

    var timer = null;
    function dismiss() {
      if (timer) { clearTimeout(timer); timer = null; }
      box.classList.remove('in');
      setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 220);
    }

    if (opts.action && opts.action.label) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = opts.action.label;
      btn.addEventListener('click', function () {
        dismiss();
        try { opts.action.onClick && opts.action.onClick(); }
        catch (e) { if (NS.log) NS.log.error('提示条动作异常', e); }
      });
      box.appendChild(btn);
    }

    h.appendChild(box);
    // 触发过渡
    requestAnimationFrame(function () { box.classList.add('in'); });
    var ms = opts.ms === undefined ? (opts.type === 'error' ? 6000 : 3200) : opts.ms;
    box.addEventListener('focusin', function () { if (timer) { clearTimeout(timer); timer = null; } });
    box.addEventListener('focusout', function () { if (ms > 0) timer = setTimeout(dismiss, ms); });
    if (ms > 0) timer = setTimeout(dismiss, ms);
    return { dismiss: dismiss, el: box };
  }

  NS.toast = { show: show };
})(typeof window !== 'undefined' ? window : globalThis);
