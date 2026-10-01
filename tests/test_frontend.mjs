/* =====================================================================
 * 前端渲染与交互测试（零依赖：自建极简 DOM，不需要 jsdom / npm install）
 *
 *     node tests/test_frontend.mjs
 *
 * 真实执行 app/static/js/*.js，覆盖：
 *   卡片渲染 / 优先级与状态配色 / 完成耗时文案 / 逾期标记 /
 *   搜索高亮（XSS 转义）/ 状态页签筛选 / 类型筛选 / 标记完成交互 / 删除交互
 * ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATIC = path.join(HERE, '..', 'app', 'static');

/* ============================================================ 极简 DOM */
class ClassList {
  constructor(node) { this.node = node; }
  get _s() { return this.node._classes; }
  add(...cs) { cs.filter(Boolean).forEach((c) => String(c).split(/\s+/).forEach((x) => this._s.add(x))); }
  remove(...cs) { cs.forEach((c) => this._s.delete(c)); }
  contains(c) { return this._s.has(c); }
  toggle(c, force) {
    const on = force === undefined ? !this._s.has(c) : !!force;
    if (on) this._s.add(c); else this._s.delete(c);
    return on;
  }
  get value() { return [...this._s].join(' '); }
  toString() { return this.value; }
}

class Element {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this._classes = new Set();
    this.classList = new ClassList(this);
    this.style = {};
    this.dataset = {};
    this._listeners = {};
    this._text = '';
    this._html = '';
    this.value = '';
    this.hidden = false;
    this.id = '';
    this.type = '';
    this.firstChild = null;
  }
  get className() { return this.classList.value; }
  set className(v) {
    this._classes = new Set(String(v || '').split(/\s+/).filter(Boolean));
    this.classList = new ClassList(this);
  }
  get textContent() {
    if (this._text) return this._text;
    return this.children.map((c) => c.textContent).join('');
  }
  set textContent(v) { this._text = String(v); this.children.forEach((c) => { c.parentNode = null; }); this.children = []; }
  get innerHTML() { return this._html; }
  set innerHTML(v) {
    this._html = String(v);
    this._text = this._html.replace(/<[^>]*>/g, '');     // 断言用：去标签取文本
    this.children = [];
  }
  appendChild(node) {
    if (!node) return node;
    if (!Array.isArray(this.children)) this.children = [];
    if (node._fragment) {
      node.children.slice().forEach((c) => this.appendChild(c));
      node.children = [];
      this.firstChild = this.children[0] || null;
      return node;
    }
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.children.push(node);
    this.firstChild = this.children[0] || null;
    return node;
  }
  removeChild(node) {
    const i = this.children.indexOf(node);
    if (i >= 0) { this.children.splice(i, 1); node.parentNode = null; }
    this.firstChild = this.children[0] || null;
    return node;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) {
    if (k === 'class') { this.className = v; return; }
    if (k === 'id') this.id = String(v);
    if (k.startsWith('data-')) {
      this.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = String(v);
    }
    this.attributes[k] = String(v);
  }
  getAttribute(k) { return k === 'class' ? this.className : this.attributes[k]; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener(type, fn) {
    const l = this._listeners[type] || [];
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  }
  dispatchEvent(evt) {
    // 真实浏览器里 click 等事件会冒泡；事件委托依赖这一行为
    let stopped = false;
    const base = Object.assign({}, evt, {
      stopPropagation() { stopped = true; }
    });
    let node = this;
    while (node && !stopped) {
      const listeners = (node._listeners || {})[base.type] || [];
      if (listeners.length) {
        const e = Object.assign({}, base, { target: this, currentTarget: node });
        listeners.slice().forEach((fn) => fn(e));
      }
      node = node.parentNode;
    }
    return true;
  }
  click() { return this.dispatchEvent(makeEvent('click', this)); }
  focus() {}
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => {
      if (!n || !Array.isArray(n.children)) return;      // 文本节点等无子节点
      n.children.slice().forEach((c) => {
        if (matches(c, sel)) out.push(c);
        walk(c);
      });
    };
    walk(this);
    return out;
  }
  closest(sel) { let n = this; while (n) { if (matches(n, sel)) return n; n = n.parentNode; } return null; }
  matches(sel) { return matches(this, sel); }
}

function matches(node, sel) {
  if (!node || !node.tagName) return false;
  return String(sel).split(',').map((s) => s.trim()).filter(Boolean).some((one) => {
    const parts = one.split(/(?=[.#\[])/).filter(Boolean);
    return parts.every((p) => {
      if (p.startsWith('#')) return node.id === p.slice(1);
      if (p.startsWith('.')) return node.classList.contains(p.slice(1));
      if (p.startsWith('[')) {
        const m = /^\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]$/.exec(p);
        if (!m) return false;
        const key = m[1].startsWith('data-')
          ? m[1].slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase()) : m[1];
        const val = (key in node.dataset) ? node.dataset[key] : node.attributes[key];
        return val !== undefined && (m[2] === undefined || String(val) === m[2]);
      }
      return node.tagName === p.toUpperCase();
    });
  });
}

function makeEvent(type, target, extra) {
  return Object.assign({
    type, target,
    preventDefault() {}, stopPropagation() {},
    matches() { return false; }
  }, extra || {});
}

/* ============================================================ 环境 */
const VOID_TAGS = new Set(['meta', 'link', 'br', 'hr', 'img', 'input', 'source',
                           'area', 'base', 'col', 'embed', 'param', 'track', 'wbr']);

/**
 * 用真实的 index.html 构建页面骨架（保持真实的嵌套关系）。
 * 只做「标签 + 属性」的轻量解析，足够覆盖本项目的静态页面。
 */
function parseHtml(html, document) {
  const clean = html.replace(/<!--[\s\S]*?-->/g, '')
                    .replace(/<!DOCTYPE[^>]*>/i, '')
                    .replace(/<script[\s\S]*?<\/script>/gi, '');
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[^<>]*?)?)(\/?)>/g;
  const attrRe = /([\w:-]+)(?:\s*=\s*"([^"]*)"|\s*=\s*'([^']*)')?/g;
  const root = document.createDocumentFragment();
  const stack = [root];
  let m;
  while ((m = tagRe.exec(clean)) !== null) {
    const [, closing, tag, attrStr, selfClose] = m;
    const name = tag.toLowerCase();
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const el = document.createElement(name);
    let a;
    attrRe.lastIndex = 0;
    while ((a = attrRe.exec(attrStr || '')) !== null) {
      const key = a[1];
      const val = a[2] !== undefined ? a[2] : (a[3] !== undefined ? a[3] : '');
      if (key === 'id') el.id = val;
      else if (key === 'class') el.className = val;
      else el.setAttribute(key, val);
    }
    stack[stack.length - 1].appendChild(el);
    if (!selfClose && !VOID_TAGS.has(name)) stack.push(el);
  }
  return root;
}

function buildShell(document, html) {
  const frag = parseHtml(html, document);
  // 只挂载 <body> 里的内容（head 对测试无意义）
  const body = frag.children.find((c) => c.tagName === 'BODY') || frag;
  body.children.slice().forEach((c) => document.body.appendChild(c));
  // 校验真实页面里关键锚点确实存在
  ['cards', 'statusTabs', 'sideToday', 'modalRoot', 'nav', 'statPills',
   'searchInput', 'sortSelect', 'btnNew', 'btnClearDone', 'typeFilter', 'priorityChips',
   'toasts', 'listFoot', 'stDate', 'stWeek', 'stCount'].forEach((id) => {
    assert.ok(document.querySelector('#' + id), 'index.html 缺少锚点 #' + id);
  });
  return document;
}

function boot(fixture) {
  const document = new Element('document');
  document.tagName = 'DOCUMENT';
  document.createElement = (t) => new Element(t);
  document.createTextNode = (t) => { const n = new Element('#text'); n._text = String(t); return n; };
  document.createDocumentFragment = () => { const f = new Element('#fragment'); f._fragment = true; return f; };
  document.body = new Element('body');
  document.appendChild(document.body);

  const calls = [];
  // 注意：把宿主 realm 的 Array/String/JSON 等注入沙箱，避免两个 realm 的对象
  // 互相调用方法时报 "undefined is not a function"（跨 realm 原型错配）。
  const sandbox = {
    document, console, setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Object, Array, String, Number, Boolean, isNaN,
    parseInt, parseFloat, Promise, Error, RegExp, encodeURIComponent, decodeURIComponent,
    Node: Element
  };
  sandbox.window = sandbox;
  sandbox.scrollTo = () => {};
  sandbox.location = { hash: '#/todos' };
  sandbox._windowListeners = {};
  sandbox.addEventListener = (type, fn) => {
    (sandbox._windowListeners[type] = sandbox._windowListeners[type] || []).push(fn);
  };
  sandbox.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  sandbox.fetch = async (url, opts) => {
    const method = (opts && opts.method) || 'GET';
    calls.push({ url, method, body: opts && opts.body });
    return { ok: true, status: 200, statusText: 'OK',
             text: async () => JSON.stringify(fixture(url, method, opts)) };
  };

  const ctx = vm.createContext(sandbox);
  ['config.js', 'utils.js', 'api.js', 'ui.js', 'todo.js', 'app.js'].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(STATIC, 'js', f), 'utf8'), ctx, { filename: f });
  });
  const html = fs.readFileSync(path.join(STATIC, 'index.html'), 'utf8');
  buildShell(document, html);
  return { ctx, document, calls, sandbox };
}

/* ============================================================ 测试数据 */
const NOW = '2026-02-05 09:05:00';
const SPECIAL = '评审「Zalopay」协议 v2 (#42) — 金额 ≤ $1,000 & <img src=x onerror=alert(1)>';

function makeItems() {
  return [
    { id: 1, title: '排期计算器支持法定节假日与补班日', todo_type: '研发项目', status: '进行中',
      priority: 'P0', remark: '补班日必须算作工作日', due_date: '2026-02-07', created_at: NOW,
      completed_at: '', is_done: false, is_overdue: false, is_due_today: false, is_done_late: false,
      workdays: null, workdays_text: '', calendar_days: null, elapsed_workdays: 3 },
    { id: 2, title: '与 Zalopay 签署 Auto Debit 补充协议', todo_type: '对外商务', status: '进行中',
      priority: 'P1', remark: '', due_date: '2026-01-30', created_at: '2026-01-26 14:05:00',
      completed_at: '', is_done: false, is_overdue: true, is_due_today: false, is_done_late: false,
      workdays: null, workdays_text: '', calendar_days: null, elapsed_workdays: 8 },
    { id: 3, title: 'NAPAS E-GETS 合同第 3 轮条款评审', todo_type: '对外商务', status: '已完成',
      priority: 'P2', remark: '法务已确认', due_date: '2026-02-04', created_at: '2026-01-26 14:05:00',
      completed_at: '2026-02-03 17:40:00', is_done: true, is_overdue: false, is_due_today: false,
      is_done_late: false, workdays: 7, workdays_text: '7 个工作日', calendar_days: 9 },
    { id: 4, title: SPECIAL, todo_type: '对外商务', status: '进行中', priority: 'P2', remark: '',
      due_date: '', created_at: NOW, completed_at: '', is_done: false, is_overdue: false,
      is_due_today: false, is_done_late: false, workdays: null, workdays_text: '',
      calendar_days: null, elapsed_workdays: 1 }
  ];
}

const META = {
  app: '项目管理系统 · 待办清单', version: '1.0.0', today: '2026-02-05', weekday_cn: '四', region: 'CN',
  enums: { todo_types: ['对外商务', '集团内部沟通', '研发项目'],
           todo_status: ['进行中', '已完成'], priorities: ['P0', 'P1', 'P2'] },
  colors: { status: { 进行中: '#f5c542', 已完成: '#cbd5e1' },
            status_text: { 进行中: '#7c5c00', 已完成: '#5b6472' },
            priority: { P0: '#ef4444', P1: '#3b82f6', P2: '#22c55e' } },
  defaults: { priority: 'P1', status: '进行中', todo_type: '对外商务' },
  limits: { remark_max: 1000, title_max: 200 },
  counts: { by_type: { 对外商务: { pending: 2, total: 3 }, 集团内部沟通: { pending: 0, total: 0 },
                       研发项目: { pending: 1, total: 1 } }, pending: 3, total: 4 }
};

function summaryOf(items) {
  const doing = items.filter((x) => x.status === '进行中').length;
  const done = items.length - doing;
  return { total: items.length, doing, done,
           overdue: items.filter((x) => x.is_overdue).length, due_today: 0,
           done_rate: items.length ? Math.round(done * 100 / items.length) : 0, avg_workdays: 7 };
}

function makeFixture() {
  const items = makeItems();
  return (url, method, opts) => {
    const pathOnly = url.split('?')[0];
    const q = decodeURIComponent(url.split('?')[1] || '');
    if (pathOnly === '/api/meta') return META;
    if (pathOnly === '/api/counts') return META.counts;
    if (pathOnly === '/api/demo/seed') return { created: 0, skipped: true, total: items.length };
    if (pathOnly === '/api/todos/summary') {
      return { summary: summaryOf(items), counts: META.counts, overdue_list: [] };
    }
    const m = /^\/api\/todos\/(\d+)(\/toggle)?$/.exec(pathOnly);
    if (m) {
      const it = items.find((x) => x.id === Number(m[1]));
      if (method === 'DELETE') return { deleted: true };
      if (m[2]) {
        const going = it.status !== '已完成';
        return Object.assign({}, it, {
          status: going ? '已完成' : '进行中',
          completed_at: going ? '2026-02-05 10:00:00' : '',
          is_done: going,
          workdays: going ? 2 : null,
          workdays_text: going ? '2 个工作日' : '',
          calendar_days: going ? 2 : null
        });
      }
      if (method === 'PUT' || method === 'PATCH') return Object.assign({}, it, JSON.parse(opts.body));
      return it;
    }
    if (pathOnly === '/api/todos' && method === 'POST') {
      const payload = JSON.parse(opts.body);
      return Object.assign({}, items[0], { id: 99, title: payload.title, priority: payload.priority });
    }
    if (pathOnly === '/api/todos') {
      let out = items.slice();
      if (/status=doing/.test(q)) out = out.filter((x) => x.status === '进行中');
      if (/status=done/.test(q)) out = out.filter((x) => x.status === '已完成');
      const t = /todo_type=([^&]*)/.exec(q);
      if (t && t[1]) out = out.filter((x) => x.todo_type === t[1]);
      const p = /priority=([^&]*)/.exec(q);
      if (p && p[1]) out = out.filter((x) => x.priority === p[1]);
      const kw = /q=([^&]*)/.exec(q);
      if (kw && kw[1]) out = out.filter((x) => x.title.includes(kw[1]));
      return { items: out, summary: summaryOf(out), counts: META.counts, query: {} };
    }
    return {};
  };
}

/* ============================================================ 断言 */
let passed = 0;
const failures = [];
const queue = [];

/** 注册用例；串行执行，避免异步用例互相抢跑 */
function check(name, fn) { queue.push({ name, fn }); }

async function runAll() {
  for (const { name, fn } of queue) {
    try {
      await fn();
      passed++;
      console.log('  \u2713 ' + name);
    } catch (e) {
      failures.push(name + ' \u2192 ' + e.message);
      console.log('  \u2717 ' + name + ' \u2192 ' + e.message);
      if (process.env.STACK) console.log(String(e.stack).split('\n').slice(0, 6).join('\n'));
    }
  }
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms || 15));

/** 轮询等待条件成立（替代不可靠的固定延时） */
async function waitFor(fn, desc, timeout = 2000) {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - t0 > timeout) throw new Error('等待超时：' + (desc || '条件未成立'));
    await tick(10);
  }
}
const cardCount = () => document.querySelectorAll('.card').length;

/** 按 field-label 文案取表单控件 */
function fieldNode(mask, labelRe, tag) {
  const field = mask.querySelectorAll('.field')
    .find((f) => labelRe.test(textOf(f.querySelector('.field-label'))));
  if (!field) throw new Error('找不到字段：' + labelRe);
  return tag ? field.querySelector(tag) : field;
}

/** 直接子元素里按标签文案取按钮（等价 querySelectorAll(':scope > .btn')） */
function buttonsOf(node) {
  return (node.children || []).filter((c) => c.classList && c.classList.contains('btn'));
}
function buttonByText(node, re) {
  const btn = buttonsOf(node).find((b) => re.test(textOf(b)));
  if (!btn) throw new Error('找不到按钮：' + re + '（现有：'
    + buttonsOf(node).map(textOf).join('/') + '）');
  return btn;
}

/* ============================================================ 用例 */
console.log('\n前端渲染与交互测试（node tests/test_frontend.mjs）\n');

const env = boot(makeFixture());
const { ctx, document, calls } = env;

// 触发 DOMContentLoaded -> app.js 的 boot()
document.dispatchEvent(makeEvent('DOMContentLoaded', document));
await tick(60);

const cards = document.querySelectorAll('.card');
const cardOf = (id) => document.querySelectorAll('.card').find((c) => c.dataset.id === String(id));
const txt = (n) => (n ? n.textContent.replace(/\s+/g, ' ').trim() : '');
const textOf = (n) => (n ? String(n.textContent).replace(/\s+/g, ' ').trim() : '');

check('卡片网格渲染出 4 张卡片', () => assert.equal(cards.length, 4));

check('卡片是 article 元素（卡片式，非列表）', () => {
  assert.equal(cards[0].tagName, 'ARTICLE');
  assert.ok(cards[0].classList.contains('card'));
});

check('侧边栏日期与待办数量正确（日期取系统当天）', () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const expect = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const st = document.querySelector('#sideToday');
  assert.match(txt(st), new RegExp(expect.replace(/-/g, '\\-')));
  assert.match(txt(st), /星期[日一二三四五六]/);
  assert.match(txt(st), /3\s*项待办未完成/);
});

check('顶部统计胶囊：待办/未完成/已完成/逾期', () => {
  const pills = document.querySelectorAll('.pill');
  const all = pills.map((p) => txt(p)).join(' | ');
  assert.match(all, /4\s*待办/);
  assert.match(all, /3\s*未完成/);
  assert.match(all, /1\s*已完成/);
  assert.match(all, /1\s*逾期/);
});

check('状态页签含"全部/进行中/已完成"及数量', () => {
  const tabs = document.querySelectorAll('.tab').map(txt);
  assert.equal(tabs.length, 3);
  assert.match(tabs[0], /全部\s*4/);
  assert.match(tabs[1], /进行中\s*3/);
  assert.match(tabs[2], /已完成\s*1/);
});

check('P0 卡片显示红色优先级标签与色条', () => {
  const c = cardOf(1);
  const tag = c.querySelector('.tag.prio');
  assert.match(txt(tag), /P0/);
  assert.equal(tag.style.color, '#ef4444');
  assert.equal(c.querySelector('.card-rail').style.background, '#ef4444');
});

check('已完成卡片：灰色色条 + 划线样式 + 状态标签灰色', () => {
  const c = cardOf(3);
  assert.ok(c.classList.contains('is-done'));
  assert.equal(c.querySelector('.card-rail').style.background, '#cbd5e1');
  const st = c.querySelector('.tag.status');
  assert.equal(st.style.background, '#cbd5e1');
  assert.match(txt(st), /已完成/);
});

check('完成卡片展示自动计算的工作日耗时', () => {
  const c = cardOf(3);
  assert.match(txt(c.querySelector('.done-strip')), /完成于 02-03 17:40/);
  assert.match(txt(c), /耗时 7 个工作日/);
  assert.match(txt(c), /自然日 9 天/);
});

check('进行中卡片展示已进行工作日', () => {
  assert.match(txt(cardOf(1)), /已进行 3 个工作日/);
});

check('逾期卡片：红色标记 + 逾期天数 + is-overdue 类', () => {
  const c = cardOf(2);
  assert.ok(c.classList.contains('is-overdue'));
  const due = c.querySelector('.due');
  assert.ok(due.classList.contains('overdue'));
  const expected = Math.abs(Math.round(
    (new Date('2026-01-30T00:00:00') - new Date(new Date().toDateString())) / 86400000));
  assert.match(txt(due), new RegExp('逾期 ' + expected + ' 天'));
});

check('类型标签渲染为中文类型名', () => {
  assert.match(txt(cardOf(1).querySelector('.tag.type')), /研发项目/);
  assert.match(txt(cardOf(2).querySelector('.tag.type')), /对外商务/);
});

check('特殊字符标题原样显示且被 HTML 转义（防 XSS）', () => {
  const c = cardOf(4);
  const raw = c.querySelector('.card-title').innerHTML;
  assert.ok(raw.includes('&lt;img'), '尖括号应被转义');
  assert.ok(!raw.includes('<img'), '不应出现可执行标签');
  assert.ok(raw.includes('「Zalopay」'));
  assert.ok(raw.includes('≤'));
});

check('每张卡片都有 编辑/删除 按钮和 标记完成 按钮', () => {
  cards.forEach((c) => {
    assert.ok(c.querySelector('[data-act="edit"]'), '缺少编辑按钮');
    assert.ok(c.querySelector('[data-act="del"]'), '缺少删除按钮');
    assert.ok(c.querySelector('[data-act="toggle"]'), '缺少完成按钮');
  });
});

check('"标记完成"调用 toggle 接口并更新卡片', async () => {
  const before = calls.length;
  cardOf(1).querySelector('[data-act="toggle"]').click();
  await waitFor(() => calls.slice(before).some((c) => /\/api\/todos\/1\/toggle$/.test(c.url)),
    'toggle 接口被调用');
  const hit = calls.slice(before).find((c) => /\/api\/todos\/1\/toggle$/.test(c.url));
  assert.equal(hit.method, 'POST');
});

check('切换状态页签只显示已完成', async () => {
  document.querySelectorAll('.tab')[2].click();
  await waitFor(() => cardCount() === 1 && !!cardOf(3), '仅剩 1 张已完成卡片');
  assert.deepEqual(document.querySelectorAll('.card').map((c) => c.dataset.id), ['3']);
});

check('切回"全部"恢复所有卡片', async () => {
  document.querySelectorAll('.tab')[0].click();
  await waitFor(() => cardCount() === 4, '恢复 4 张卡片');
});

check('优先级筛选只保留 P0', async () => {
  const chip = document.querySelectorAll('.chip').find((c) => txt(c) === 'P0');
  chip.click();
  await waitFor(() => cardCount() === 1, '仅剩 P0 卡片');
  assert.deepEqual(document.querySelectorAll('.card').map((c) => c.dataset.id), ['1']);
});

check('清空优先级筛选恢复', async () => {
  const chip = document.querySelectorAll('.chip').find((c) => txt(c) === '全部优先级');
  chip.click();
  await waitFor(() => cardCount() === 4, '恢复 4 张卡片');
});

check('搜索命中并高亮关键词', async () => {
  const input = document.querySelector('#searchInput');
  input.value = 'NAPAS';
  input.dispatchEvent(makeEvent('input', input));
  await waitFor(() => cardCount() === 1, '搜索后仅剩 1 张卡片');
  assert.match(cardOf(3).querySelector('.card-title').innerHTML, /<mark>NAPAS<\/mark>/);
});

check('搜索无结果时显示空态与重置按钮', async () => {
  const input = document.querySelector('#searchInput');
  input.value = '不存在的关键词';
  input.dispatchEvent(makeEvent('input', input));
  await waitFor(() => cardCount() === 0 && !!document.querySelector('.empty'), '出现空态');
  const empty = document.querySelector('.empty');
  assert.match(txt(empty), /没有符合条件的待办/);
  const actions = empty.querySelector('.empty-actions');
  assert.ok(actions, '空态缺少操作按钮区');
  assert.ok(actions.querySelectorAll('.btn').some((b) => /重置筛选/.test(txt(b))),
    '空态缺少「重置筛选条件」按钮');
});

check('点击"重置筛选条件"清空搜索并恢复列表', async () => {
  const actions = document.querySelector('.empty-actions');
  assert.ok(actions, '找不到空态操作区');
  const btn = actions.querySelectorAll('.btn').find((b) => /重置筛选/.test(txt(b)));
  assert.ok(btn, '找不到重置按钮');
  btn.click();
  await waitFor(() => cardCount() === 4, '恢复 4 张卡片');
  assert.equal(document.querySelector('#searchInput').value, '');
});

check('删除卡片需确认后才调用删除接口', async () => {
  const before = calls.length;
  cardOf(4).querySelector('[data-act="del"]').click();
  await waitFor(() => !!document.querySelector('.modal-mask'), '弹出确认框');
  const mask = document.querySelector('.modal-mask');
  assert.match(txt(mask), /确定删除/);
  assert.equal(calls.slice(before).filter((c) => c.method === 'DELETE').length, 0,
    '确认前不应发起删除');

  mask.querySelector('.modal-foot').querySelectorAll('.btn');
  buttonByText(mask.querySelector('.modal-foot'), /^删除$|^确定$/).click();
  await waitFor(() => calls.slice(before).some((c) => c.method === 'DELETE'), '调用 DELETE');
  const del = calls.slice(before).find((c) => c.method === 'DELETE');
  assert.match(del.url, /\/api\/todos\/4$/);
});

check('新建按钮打开表单弹窗，含所需字段与 1000 字备注限制', async () => {
  document.querySelector('#btnNew').click();
  await waitFor(() => !!document.querySelector('.modal-mask'), '弹出表单');
  const mask = document.querySelector('.modal-mask');
  const labels = mask.querySelectorAll('.field-label').map(txt).join(' | ');
  ['事项', '类型', '优先级', '状态', '备注'].forEach((l) => assert.match(labels, new RegExp(l)));

  const remark = mask.querySelectorAll('textarea').find((t) => t.getAttribute('maxlength') === '1000');
  assert.ok(remark, '备注缺少 maxlength=1000');

  const typeOptions = fieldNode(mask, /类型/, 'select').querySelectorAll('option').map((o) => o.textContent);
  assert.deepEqual(typeOptions, ['对外商务', '集团内部沟通', '研发项目']);

  const prioOptions = fieldNode(mask, /优先级/, 'select').querySelectorAll('option').map((o) => o.textContent);
  assert.deepEqual(prioOptions, ['P0', 'P1', 'P2']);

  const statusOptions = fieldNode(mask, /状态/, 'select').querySelectorAll('option').map((o) => o.textContent);
  assert.deepEqual(statusOptions, ['进行中', '已完成']);

  mask.querySelector('.modal-x').click();
  await waitFor(() => !document.querySelector('.modal-mask'), '关闭弹窗');
});

check('侧边栏不再出现「类型（未完成）」区块', () => {
  assert.equal(document.querySelector('#typeCountList'), null);
  assert.equal(document.querySelectorAll('.side-type').length, 0);
  const navText = txt(document.querySelector('#nav'));
  assert.ok(!/类型（未完成）/.test(navText), '侧栏仍残留类型区块标题');
  assert.ok(!document.body.innerHTML.includes('typeCountList'), '页面仍残留 typeCountList');
});

check('侧边栏其余菜单标注二期且不可进入', () => {
  const items = document.querySelector('#nav').querySelectorAll('.nav-item');
  assert.equal(items.length, 6);
  assert.match(txt(items[0]), /待办清单/);
  assert.ok(items[0].classList.contains('active'));
  assert.ok(items[1].classList.contains('disabled'));
  assert.match(txt(items[1]), /迭代排期/);
});

/* ============================================================ 结果 */
await runAll();
console.log('');
if (failures.length) {
  console.log(`✗ ${failures.length} 项失败 / 共 ${passed + failures.length} 项`);
  failures.forEach((f) => console.log('   - ' + f));
  process.exit(1);
}
console.log(`✓ 全部通过：${passed} 项`);
