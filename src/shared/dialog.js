/* Keyboard focus and background isolation for the local page's dialog layers. */
(function (global) {
  'use strict';
  var NS = global.DSH || (global.DSH = {});
  NS.createDialog = function (panel, onEscape) {
    var previous = null, isolated = [], active = false;
    function focusables() {
      return Array.from(panel.querySelectorAll('button,input,select,textarea,summary,a[href],[tabindex]')).filter(function (node) {
        return !node.disabled && node.tabIndex >= 0 && node.getClientRects().length > 0 && !node.closest('[inert]');
      });
    }
    function keydown(e) {
      if (!active) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); onEscape(); }
      if (e.key !== 'Tab') return;
      var items = focusables();
      var first = items[0] || panel, last = items[items.length - 1] || panel;
      if (!panel.contains(document.activeElement) || (e.shiftKey && document.activeElement === first) || (!e.shiftKey && document.activeElement === last) || !items.length) {
        e.preventDefault(); (e.shiftKey ? last : first).focus();
      }
    }
    return {
      open: function (initial) {
        if (active) return;
        active = true;
        previous = document.activeElement;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.tabIndex = -1;
        var branch = panel;
        while (branch.parentElement && branch !== document.body) {
          Array.from(branch.parentElement.children).forEach(function (node) {
            if (node !== branch && !/^(SCRIPT|STYLE|LINK)$/.test(node.tagName)) {
              isolated.push({ node: node, inert: node.inert }); node.inert = true;
            }
          });
          branch = branch.parentElement;
        }
        document.addEventListener('keydown', keydown, true);
        (initial || focusables()[0] || panel).focus();
      },
      close: function () {
        if (!active) return;
        active = false;
        document.removeEventListener('keydown', keydown, true);
        isolated.forEach(function (entry) { entry.node.inert = entry.inert; });
        isolated = [];
        panel.removeAttribute('aria-modal');
        if (previous && previous.isConnected) previous.focus();
      }
    };
  };
})(window);
