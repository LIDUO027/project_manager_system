/* =====================================================================
 * REST 封装：统一前缀、统一错误、统一 JSON 解析
 * 后端非 2xx 时返回 { detail: '中文原因' }，这里直接抛 Error(detail)
 * ===================================================================== */
window.Api = (function () {
  'use strict';

  function base() {
    const b = (window.APP_CONFIG && window.APP_CONFIG.API_BASE) || '';
    return b.replace(/\/$/, '');
  }

  function qs(params) {
    if (!params) return '';
    const parts = Object.keys(params)
      .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
      .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    return parts.length ? '?' + parts.join('&') : '';
  }

  async function request(method, path, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(base() + path, opts);
    } catch (e) {
      throw new Error('无法连接后端服务，请确认 API 已启动（' + (base() || '同源') + '）');
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!res.ok) {
      let msg = data && data.detail ? data.detail : (res.status + ' ' + res.statusText);
      if (Array.isArray(msg)) {                     // pydantic 422
        msg = msg.map((m) => m.msg || JSON.stringify(m)).join('；');
      } else if (typeof msg === 'object') {
        msg = JSON.stringify(msg);
      }
      throw new Error(String(msg));
    }
    return data;
  }

  const get = (path, params) => request('GET', path + qs(params));
  const post = (path, body) => request('POST', path, body === undefined ? {} : body);
  const put = (path, body) => request('PUT', path, body);
  const patch = (path, body) => request('PATCH', path, body);
  const del = (path) => request('DELETE', path);

  return {
    get, post, put, patch, del, qs,
    /* ---- 待办清单 ---- */
    meta: () => get('/api/meta'),
    list: (params) => get('/api/todos', params),
    summary: (params) => get('/api/todos/summary', params),
    create: (payload) => post('/api/todos', payload),
    update: (id, payload) => put('/api/todos/' + id, payload),
    toggle: (id) => post('/api/todos/' + id + '/toggle'),
    remove: (id) => del('/api/todos/' + id),
    clearDone: () => del('/api/todos'),
    seed: (body) => post('/api/demo/seed', body || {}),
    counts: () => get('/api/counts')
  };
})();
