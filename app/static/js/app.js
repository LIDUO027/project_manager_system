/* =====================================================================
 * 应用外壳：左侧菜单栏 + 待办清单页挂载
 * 一期只有「待办清单」一个菜单，其余占位并在二期开放。
 * ===================================================================== */
(function () {
  'use strict';

  const { h, $, clear, todayStr, weekdayCn, toast } = U;

  /** 侧边栏菜单：待办清单排在第一位 */
  const MENUS = [
    { key: 'todos', icon: '✅', label: '待办清单', ready: true },
    { key: 'iterations', icon: '🗓', label: '迭代排期', ready: false },
    { key: 'requirements', icon: '📋', label: '需求管理', ready: false },
    { key: 'people', icon: '👥', label: '人员投入', ready: false },
    { key: 'stats', icon: '📊', label: '数据看板', ready: false },
    { key: 'settings', icon: '⚙️', label: '系统设置', ready: false }
  ];

  function renderNav() {
    const nav = $('#nav');
    clear(nav);
    nav.appendChild(h('div', { class: 'nav-group-title', text: '工作台' }));
    MENUS.forEach((m, i) => {
      const active = i === 0;
      nav.appendChild(h('a', {
        class: 'nav-item' + (active ? ' active' : '') + (m.ready ? '' : ' disabled'),
        href: '#/' + m.key,
        onclick: (e) => {
          if (!m.ready) {
            e.preventDefault();
            toast('「' + m.label + '」将在二期开放', 'info');
            return;
          }
          e.preventDefault();
          location.hash = '#/' + m.key;
        }
      },
        h('span', { class: 'nav-ico', text: m.icon }),
        h('span', { class: 'nav-label', text: m.label }),
        active ? null : h('span', { class: 'nav-soon', text: '二期' })));
    });
  }

  function renderToday() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    $('#stDate').textContent = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    $('#stWeek').textContent = weekdayCn(todayStr());
  }

  async function boot() {
    renderNav();
    renderToday();

    if (!location.hash) location.hash = '#/todos';
    TodoPage.mount();

    // 首屏：元数据 + 列表
    try {
      Store.state.meta = await Api.meta();
    } catch (e) {
      toast(e.message, 'err');
    }

    // 库为空时自动铺示例数据，避免首屏是一片空白
    const counts = (Store.state.meta && Store.state.meta.counts) || { total: 0 };
    if (window.APP_CONFIG.SEED_WHEN_EMPTY && !counts.total) {
      try { await Api.seed({ reset: false }); } catch (e) { /* 忽略 */ }
      try { Store.state.meta = await Api.meta(); } catch (e) { /* 忽略 */ }
    }

    TodoPage.renderShell();
    await TodoPage.load();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
