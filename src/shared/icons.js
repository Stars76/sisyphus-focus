/* ============================================================
 * src/shared/icons.js · sisy-icon 图标组件（零依赖的本地实现）
 * ------------------------------------------------------------
 * 用法：<sisy-icon name="LeftIcon"></sisy-icon>
 * 可用：MoveIcon ListIcon TimerIcon CalendarIcon SettingsIcon PinIcon
 *       CloseIcon LeftIcon RightIcon CheckIcon AddIcon EditIcon DeleteIcon
 * 图标路径为本地手写的 16x16 线性图标（stroke=currentColor），
 * 不加载任何字体、图片或远程资源。
 * ============================================================ */
(function (global) {
  'use strict';
  if (!global.customElements || global.customElements.get('sisy-icon')) return;

  var ICONS = {
    MoveIcon: '<path d="M5 4h.1M10 4h.1M5 8h.1M10 8h.1M5 12h.1M10 12h.1"/>',
    ListIcon: '<path d="M6 4h7M6 8h7M6 12h7M2.5 4h.1M2.5 8h.1M2.5 12h.1"/>',
    TimerIcon: '<circle cx="8" cy="9" r="5.5"/><path d="M6 1h4M8 6v3l2 1M12 3l1 1"/>',
    CalendarIcon: '<rect x="2" y="3" width="12" height="11" rx="2"/><path d="M5 1.5v3M11 1.5v3M2 7h12M5 10h1M9 10h1"/>',
    SettingsIcon: '<path d="M3 2v12M8 2v12M13 2v12M1 5h4M6 11h4M11 6h4"/>',
    PinIcon: '<path d="M5 2h6l-1 5 3 3H3l3-3-1-5ZM8 10v4"/>',
    CloseIcon: '<path d="M4 4l8 8M12 4l-8 8"/>',
    LeftIcon: '<path d="M10 3 L5 8 L10 13"/>',
    RightIcon: '<path d="M6 3 L11 8 L6 13"/>',
    CheckIcon: '<path d="M3 8.5 L6.5 12 L13 4.5"/>',
    AddIcon: '<path d="M8 3 V13 M3 8 H13"/>',
    EditIcon: '<path d="M11 2.5 L13.5 5 L5.5 13 H3 V10.5 Z"/>',
    DeleteIcon: '<path d="M2.5 4.5 H13.5 M5.5 4.5 V3.2 a1 1 0 0 1 1-1 h3 a1 1 0 0 1 1 1 V4.5 M4 4.5 L4.7 13 a1.5 1.5 0 0 0 1.5 1.4 h3.6 a1.5 1.5 0 0 0 1.5-1.4 L12 4.5"/>'
  };
  var CSS = ':host{display:block}svg{width:100%;height:100%;display:block}';

  var SisyIcon = function () {
    var self = Reflect.construct(HTMLElement, [], SisyIcon);
    self.attachShadow({ mode: 'open' });
    return self;
  };

  SisyIcon.prototype = Object.create(HTMLElement.prototype, {
    connectedCallback: { value: function () { this._render(); } },
    attributeChangedCallback: { value: function () { if (this.shadowRoot) this._render(); } },
    _render: {
      value: function () {
        var name = this.getAttribute('name');
        var body = ICONS[name] || '';
        this.shadowRoot.innerHTML =
          '<style>' + CSS + '</style>' +
          '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" ' +
          'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
      }
    }
  });

  SisyIcon.observedAttributes = ['name'];
  global.customElements.define('sisy-icon', SisyIcon);
})(typeof window !== 'undefined' ? window : globalThis);
