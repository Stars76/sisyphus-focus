/* ============================================================
 * src/shared/template.js · 笔记模板引擎（渲染端 + 主进程共用）
 * ------------------------------------------------------------
 * 职责：把用户可编辑的 MD 模板渲染成笔记文本（Obsidian / Notion 联动）。
 *   - 单值替换：{{date}} {{date_cn}} …（snake_case 标准命名）
 *   - 循环块：{{#tasks_done}} … {{/tasks_done}}（块内变量按条目求值）
 *   - 未知变量原样保留（用户可见待填，不静默吞掉）
 * 零依赖纯函数；数据组装在调用方（src/main/ipc.js）。
 * ============================================================ */
(function (root) {
  'use strict';

  /* 三份内置初始模板（用户可改，可一键恢复） */
  var DEFAULT_TEMPLATES = {
    daily: {
      name: '每日复盘',
      text: [
        '# 每日复盘 · {{date_cn}} {{weekday}}',
        '',
        '> 专注 {{focus_minutes}} 分钟 · {{focus_rounds}} 轮 · 完成任务 {{tasks_done_count}} 件',
        '',
        '## 时间轴',
        '{{#timeline}}- `{{start}}–{{end}}` {{title}}（{{minutes}} 分钟）',
        '{{/timeline}}{{^timeline}}- 今天还没有专注记录',
        '{{/timeline}}',
        '## 完成清单',
        '{{#tasks_done}}- [x] {{title}}',
        '{{/tasks_done}}{{^tasks_done}}- 今天还没有完成的任务',
        '{{/tasks_done}}'
      ].join('\n')
    },
    task: {
      name: '单任务记录',
      text: [
        '# {{task_title}}',
        '',
        '> {{date_cn}} · 累计专注 {{task_minutes}} 分钟',
        '',
        '## 专注时段',
        '{{#timeline}}- `{{start}}–{{end}}` {{minutes}} 分钟',
        '{{/timeline}}'
      ].join('\n')
    },
    weekly: {
      name: '周报',
      text: [
        '# 周报 · {{week_since}} ~ {{week_until}}',
        '',
        '> 专注 {{focus_minutes}} 分钟 · {{focus_rounds}} 轮 · 完成任务 {{tasks_done_count}} 件 · 连续 {{streak}} 天',
        '',
        '## 最常专注时段',
        '- {{peak_range}}',
        '',
        '## 完成清单',
        '{{#tasks_done}}- [x] {{title}}（{{minutes}} 分钟）',
        '{{/tasks_done}}'
      ].join('\n')
    }
  };

  var BLOCK_RE = /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}|\{\{\^(\w+)\}\}([\s\S]*?)\{\{\/\3\}\}/g;
  var VAR_RE = /\{\{(\w+)\}\}/g;

  function renderValue(tpl, vars) {
    return tpl.replace(VAR_RE, function (m, name) {
      var v = vars[name];
      return (v == null) ? m : String(v);   // 未知变量原样保留
    });
  }

  /** 渲染模板。data = { vars: {...}, lists: { name: [{...}] } } */
  function render(template, data) {
    var vars = (data && data.vars) || {};
    var lists = (data && data.lists) || {};
    var out = String(template == null ? '' : template);
    for (var pass = 0; pass < 3; pass++) {   // 允许块内嵌套一层，3 轮足够收敛
      var next = out.replace(BLOCK_RE, function (m, eachName, eachBody, emptyName, emptyBody) {
        if (eachName) {
          var list = lists[eachName];
          if (!Array.isArray(list)) return m;        // 未知块原样保留
          if (!list.length) return '';
          return list.map(function (item) {
            return renderValue(eachBody, Object.assign({}, vars, item));
          }).join('');
        }
        var l2 = lists[emptyName];
        if (!Array.isArray(l2)) return m;
        return l2.length ? '' : renderValue(emptyBody, vars);
      });
      if (next === out) break;
      out = next;
    }
    return renderValue(out, vars);
  }

  /** 取模板文本：用户自定义优先，缺省回落内置默认 */
  function pick(stored, kind) {
    var s = (stored && stored.templates && stored.templates[kind]) || null;
    if (s && typeof s.text === 'string') return s;
    return DEFAULT_TEMPLATES[kind] || null;
  }

  var api = { DEFAULT_TEMPLATES: DEFAULT_TEMPLATES, render: render, pick: pick };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { var NS = root.DSH || (root.DSH = {}); NS.template = api; }
})(typeof window !== 'undefined' ? window : globalThis);
