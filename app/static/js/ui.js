/* =====================================================================
 * 通用展示组件：标签 / 优先级 / 统计胶囊 / 空状态骨架
 * ===================================================================== */
window.UI = (function () {
  'use strict';

  const { h } = U;

  function color(path, key, fallback) {
    const c = (Store.state.meta && Store.state.meta.colors) || {};
    return (c[path] && c[path][key]) || fallback;
  }

  /** 安全读取枚举，meta 未加载完成时返回兜底值 */
  function enumOf(name, fallback) {
    const e = (Store.state.meta && Store.state.meta.enums) || {};
    return (e[name] && e[name].length) ? e[name] : (fallback || []);
  }

  /** 状态标签：进行中=黄、已完成=灰 */
  function statusBadge(status) {
    const bg = color('status', status, status === '已完成' ? '#cbd5e1' : '#f5c542');
    const fg = color('status_text', status, '#334155');
    return h('span', { class: 'tag status', style: { background: bg, color: fg }, text: status });
  }

  /** 优先级标签：P0 红 / P1 蓝 / P2 绿 */
  function priorityBadge(priority) {
    const c = color('priority', priority, '#64748b');
    return h('span', { class: 'tag prio', style: { color: c, borderColor: c + '55', background: c + '14' } },
      h('i', { class: 'dot', style: { background: c } }), priority);
  }

  function typeBadge(todoType) {
    return h('span', { class: 'tag type', text: todoType });
  }

  /** 顶部统计胶囊 */
  function statPill(label, value, tone) {
    return h('div', { class: 'pill ' + (tone || '') },
      h('b', { text: String(value) }),
      h('span', { text: label }));
  }

  /** 侧边栏「未完成数量」文案 */
  function pendingText(n) {
    return String(n) + ' 项待办未完成';
  }

  function progressBar(percent, tone) {
    return h('div', { class: 'progress' },
      h('i', { class: tone || '', style: { width: Math.max(0, Math.min(100, percent || 0)) + '%' } }));
  }

  function emptyState(opts) {
    opts = opts || {};
    return h('div', { class: 'empty' },
      h('div', { class: 'empty-ico', text: opts.icon || '🗂' }),
      h('h3', { text: opts.title || '暂无待办' }),
      h('p', { text: opts.desc || '' }),
      opts.actions ? h('div', { class: 'empty-actions' }, opts.actions) : null);
  }

  function skeleton(n) {
    const out = [];
    for (let i = 0; i < (n || 6); i++) out.push(h('div', { class: 'card skeleton' },
      h('div', { class: 'sk sk-1' }), h('div', { class: 'sk sk-2' }), h('div', { class: 'sk sk-3' })));
    return out;
  }

  return { statusBadge, priorityBadge, typeBadge, statPill, progressBar, emptyState,
           skeleton, enumOf, pendingText };
})();
