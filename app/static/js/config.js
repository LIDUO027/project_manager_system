/* =====================================================================
 * 前端配置 + 全局状态
 * 前后端分离：如果前端由别的端口（例如 Vite / 另一个静态服务器）托管，
 * 把 API_BASE 指到后端地址即可；同源部署时留空。
 * ===================================================================== */
window.APP_CONFIG = {
  API_BASE: '',                 // 例：'http://127.0.0.1:8000'
  SEED_WHEN_EMPTY: true,        // 库为空时自动写入示例数据
  REMEMBER_VIEW: true           // 记住筛选/排序偏好
};

window.Store = (function () {
  'use strict';

  const LS_KEY = 'pms.todo.view.v1';

  const state = {
    meta: { enums: {}, colors: {}, defaults: {}, limits: {} },
    counts: { by_type: {}, pending: 0, total: 0 },
    items: [],
    summary: { total: 0, doing: 0, done: 0, overdue: 0, due_today: 0, done_rate: 0 },
    /** 当前视图（筛选 / 搜索 / 排序） */
    view: {
      status: 'all',      // all | doing | done
      todo_type: '',
      priority: '',
      q: '',
      sort: 'created_at',
      order: 'desc'
    },
    ready: false
  };

  function loadView() {
    if (!window.APP_CONFIG.REMEMBER_VIEW) return;
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) Object.assign(state.view, JSON.parse(raw));
    } catch (e) { /* 忽略脏数据 */ }
  }

  function saveView() {
    if (!window.APP_CONFIG.REMEMBER_VIEW) return;
    try { localStorage.setItem(LS_KEY, JSON.stringify(state.view)); } catch (e) { /* 忽略 */ }
  }

  function resetView() {
    state.view = { status: 'all', todo_type: '', priority: '', q: '',
                   sort: 'created_at', order: 'desc' };
    saveView();
  }

  loadView();

  return { state, loadView, saveView, resetView };
})();
