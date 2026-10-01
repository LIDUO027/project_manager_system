/* =====================================================================
 * 通用工具：DOM 构造、日期、格式化、防抖、提示条、弹窗
 * ===================================================================== */
window.U = (function () {
  'use strict';

  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

  /* ------------------------------------------------------------ DOM */
  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach((k) => {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class' || k === 'className') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'style') {
        if (typeof v === 'string') node.setAttribute('style', v);
        else Object.assign(node.style, v);
      } else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === 'value') node.value = v;
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, v);
    });
    append(node, children);
    return node;
  }

  function append(node, children) {
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      if (Array.isArray(c)) append(node, c);
      else if (c instanceof Node) node.appendChild(c);
      else node.appendChild(document.createTextNode(String(c)));
    });
  }

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; }

  /* ------------------------------------------------------------ 日期 */
  function pad(n) { return String(n).padStart(2, '0'); }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function weekdayCn(dateStr) {
    const d = dateStr ? new Date(String(dateStr).slice(0, 10) + 'T00:00:00') : new Date();
    return '星期' + WEEKDAYS[d.getDay()];
  }

  /** 'YYYY-MM-DD HH:MM:SS' -> 'MM-DD HH:MM'；同年省略年份 */
  function fmtDateTime(s, opts) {
    opts = opts || {};
    if (!s) return '—';
    const str = String(s);
    const date = str.slice(0, 10);
    const time = str.slice(11, 16);
    const year = date.slice(0, 4);
    const nowYear = String(new Date().getFullYear());
    const md = date.slice(5);
    const head = (opts.alwaysYear || year !== nowYear) ? date : md;
    return time ? `${head} ${time}` : head;
  }

  function fmtDate(s) { return s ? String(s).slice(0, 10) : ''; }

  function relative(s) {
    if (!s) return '';
    const then = new Date(String(s).replace(' ', 'T')).getTime();
    if (isNaN(then)) return '';
    const diff = Date.now() - then;
    const min = Math.floor(diff / 60000);
    if (min < 1) return '刚刚';
    if (min < 60) return min + ' 分钟前';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + ' 小时前';
    const day = Math.floor(hr / 24);
    if (day < 30) return day + ' 天前';
    return '';
  }

  /** 距截止日期还有几天（负数=已逾期） */
  function daysUntil(dateStr) {
    if (!dateStr) return null;
    const a = new Date(dateStr.slice(0, 10) + 'T00:00:00').getTime();
    const b = new Date(todayStr() + 'T00:00:00').getTime();
    return Math.round((a - b) / 86400000);
  }

  /* ------------------------------------------------------------ 文本 */
  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** 高亮搜索命中片段（已转义，安全） */
  function highlight(text, keyword) {
    const safe = escapeHtml(text);
    if (!keyword) return safe;
    const kw = String(keyword).trim();
    if (!kw) return safe;
    const idx = safe.toLowerCase().indexOf(escapeHtml(kw).toLowerCase());
    if (idx < 0) return safe;
    const len = escapeHtml(kw).length;
    return safe.slice(0, idx) + '<mark>' + safe.slice(idx, idx + len) + '</mark>'
         + safe.slice(idx + len);
  }

  function debounce(fn, wait) {
    let t = null;
    return function () {
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), wait || 260);
    };
  }

  function plural(n, unit) { return `${n} ${unit}`; }

  /* ------------------------------------------------------------ 提示 / 弹窗 */
  function toast(msg, type) {
    let box = $('#toasts');
    if (!box) { box = h('div', { id: 'toasts', class: 'toasts' }); document.body.appendChild(box); }
    const t = h('div', { class: 'toast ' + (type || 'ok'), text: msg });
    box.appendChild(t);
    setTimeout(() => { if (t.parentNode) t.parentNode.removeChild(t); }, type === 'err' ? 5000 : 2600);
  }

  /**
   * 通用弹窗。返回 { close, node }
   * opts: { title, body(contentNode|fn), footer(fn|node), width, onClose }
   */
  function modal(opts) {
    opts = opts || {};
    const root = $('#modalRoot');
    const close = () => {
      if (node.parentNode) node.parentNode.removeChild(node);
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
      if (opts.onClose) opts.onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    };

    const bodyWrap = h('div', { class: 'modal-body' });
    const footWrap = h('div', { class: 'modal-foot' });
    const node = h('div', { class: 'modal-mask', onclick: (e) => { if (e.target === node) close(); } },
      h('div', { class: 'modal', style: opts.width ? { width: opts.width } : null },
        h('div', { class: 'modal-head' },
          h('h3', { text: opts.title || '' }),
          h('button', { class: 'modal-x', text: '×', title: '关闭', onclick: close })),
        bodyWrap, footWrap));

    root.appendChild(node);
    document.body.classList.add('modal-open');
    document.addEventListener('keydown', onKey);

    // body / footer 都允许返回节点、数组或 null（用 append 兼容数组）
    const bodyContent = typeof opts.body === 'function' ? opts.body(close) : opts.body;
    if (bodyContent) append(bodyWrap, bodyContent);
    const footContent = typeof opts.footer === 'function' ? opts.footer(close) : opts.footer;
    if (footContent) append(footWrap, footContent);
    else append(footWrap, h('button', { class: 'btn ghost', text: '关闭', onclick: close }));

    const firstInput = $('input, textarea, select', bodyWrap);
    if (firstInput) setTimeout(() => firstInput.focus(), 30);
    return { close, node };
  }

  function confirmDialog(message, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      const m = modal({
        title: opts.title || '请确认',
        width: '420px',
        body: h('div', { class: 'confirm-text', text: message }),
        footer: (close) => [
          h('button', { class: 'btn ghost', text: opts.cancelText || '取消',
                        onclick: () => { done(false); close(); } }),
          h('button', { class: 'btn ' + (opts.danger ? 'danger' : 'primary'),
                        text: opts.okText || '确定', onclick: () => { done(true); close(); } })
        ],
        onClose: () => done(false)
      });
      void m;
    });
  }

  return { h, $, $$, clear, append, todayStr, weekdayCn, fmtDateTime, fmtDate, relative,
           daysUntil, escapeHtml, highlight, debounce, plural, toast, modal, confirmDialog,
           WEEKDAYS };
})();
