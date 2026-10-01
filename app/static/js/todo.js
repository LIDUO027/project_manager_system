/* =====================================================================
 * 待办清单页面（一期唯一页面，卡片式展示）
 * ===================================================================== */
window.TodoPage = (function () {
  'use strict';

  const { h, $, clear, toast, modal, confirmDialog, fmtDateTime, fmtDate, todayStr,
          weekdayCn, daysUntil, highlight, debounce } = U;

  let busy = false;

  /* ============================================================ 数据 */
  async function load(opts) {
    opts = opts || {};
    const view = Store.state.view;
    if (!opts.silent) renderLoading();
    try {
      const data = await Api.list({
        status: view.status,
        todo_type: view.todo_type,
        priority: view.priority,
        q: view.q,
        sort: view.sort,
        order: view.order
      });
      Store.state.items = data.items || [];
      Store.state.summary = data.summary || {};
      Store.state.counts = data.counts || Store.state.counts;
      Store.state.ready = true;
      renderCards();
      renderStats();
      renderTabs();
      renderPendingCount();
      renderFoot();
    } catch (e) {
      clear($('#cards'));
      $('#cards').appendChild(UI.emptyState({
        icon: '⚠️',
        title: '加载失败',
        desc: e.message,
        actions: h('button', { class: 'btn primary', text: '重试', onclick: () => load() })
      }));
      toast(e.message, 'err');
    }
  }

  function renderLoading() {
    clear($('#cards'));
    UI.skeleton(6).forEach((n) => $('#cards').appendChild(n));
  }

  /** 局部更新：直接改内存里的那一条，避免整页闪烁 */
  function replaceItem(item) {
    const i = Store.state.items.findIndex((x) => x.id === item.id);
    const view = Store.state.view;
    const stillVisible = (view.status === 'all')
      || (view.status === 'doing' && item.status === '进行中')
      || (view.status === 'done' && item.status === '已完成');
    if (i >= 0) {
      if (stillVisible) Store.state.items[i] = item;
      else Store.state.items.splice(i, 1);
    }
  }

  /* ============================================================ 卡片 */
  function card(item) {
    const today = todayStr();
    const left = daysUntil(item.due_date);
    const done = item.status === '已完成';
    const prioColor = (Store.state.meta.colors || {}).priority
      ? ((Store.state.meta.colors.priority || {})[item.priority] || '#64748b') : '#64748b';

    const dueNode = item.due_date
      ? h('span', {
          class: 'due'
            + (item.is_overdue ? ' overdue' : '')
            + (!done && left !== null && left <= 2 && left >= 0 ? ' soon' : ''),
          title: '截止日期 ' + item.due_date
        },
          h('i', { text: '⏰' }),
          h('b', { text: fmtDate(item.due_date) }),
          item.is_overdue ? h('em', { text: `逾期 ${Math.abs(left)} 天` })
            : (left === 0 ? h('em', { text: '今天到期' })
              : (left > 0 && left <= 7 ? h('em', { text: `剩 ${left} 天` }) : null)))
      : null;

    const doneNode = done
      ? h('div', { class: 'done-strip' },
          h('span', { class: 'chk', text: '✓' }),
          h('span', { class: 'done-txt' },
            h('b', { text: '完成于 ' + fmtDateTime(item.completed_at) }),
            h('span', { class: 'wd', text: `耗时 ${item.workdays_text || '—'}` }),
            h('span', { class: 'span-days', text: `（自然日 ${item.calendar_days || 0} 天）` }),
            item.is_done_late ? h('span', { class: 'late', text: '晚于截止日' }) : null))
      : null;

    const meta = h('div', { class: 'card-meta' },
      UI.statusBadge(item.status),
      UI.priorityBadge(item.priority),
      UI.typeBadge(item.todo_type),
      dueNode);

    const cardNode = h('article', {
      class: 'card' + (done ? ' is-done' : '') + (item.is_overdue ? ' is-overdue' : ''),
      dataset: { id: String(item.id) },
      tabindex: '0',
      role: 'button',
      'aria-label': '编辑待办：' + item.title
    },
      h('span', { class: 'card-rail', style: { background: done ? '#cbd5e1' : prioColor } }),
      h('header', { class: 'card-head' },
        titleNode(item),
        h('div', { class: 'card-actions' },
          h('button', { class: 'icon-btn edit', title: '编辑', text: '✎',
                        'aria-label': '编辑', dataset: { act: 'edit' } }),
          h('button', { class: 'icon-btn del', title: '删除', text: '🗑',
                        'aria-label': '删除', dataset: { act: 'del' } }))),
      meta,
      item.remark
        ? h('p', { class: 'card-remark', html: highlight(trim(item.remark, 160), Store.state.view.q),
                   title: item.remark })
        : null,
      h('footer', { class: 'card-foot' },
        h('span', { class: 'created', title: '创建于 ' + item.created_at },
          '创建 ' + fmtDateTime(item.created_at),
          !done && item.elapsed_workdays ? h('em', { text: `已进行 ${item.elapsed_workdays} 个工作日` }) : null),
        h('button', {
          class: 'done-btn' + (done ? ' on' : ''),
          dataset: { act: 'toggle' },
          title: done ? '标记为进行中' : '标记为已完成（自动记录完成时间并计算工作日）'
        },
          h('span', { class: 'box', text: done ? '✓' : '' }),
          h('span', { text: done ? '已完成' : '标记完成' }))),
      doneNode);

    return cardNode;
  }

  function titleNode(item) {
    const raw = String(item.title || '');
    const kw = Store.state.view.q;
    return h('h3', { class: 'card-title', title: raw, html: highlight(raw, kw) });
  }

  function trim(s, max) {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max) + '…' : t;
  }

  function renderCards() {
    const box = $('#cards');
    clear(box);
    const items = Store.state.items;

    if (!items.length) {
      const empty = Store.state.counts.total === 0;
      box.appendChild(UI.emptyState(empty ? {
        icon: '📝',
        title: '还没有任何待办',
        desc: '新建第一条待办，或载入一组示例数据快速体验卡片、优先级与工作日统计。',
        actions: [
          h('button', { class: 'btn primary', text: '＋ 新建待办', onclick: () => openEditor(null) }),
          h('button', { class: 'btn ghost', text: '载入示例数据', onclick: seedDemo })
        ]
      } : {
        icon: '🔍',
        title: '没有符合条件的待办',
        desc: '试试切换状态页签、清空搜索词或优先级筛选。',
        actions: h('button', {
          class: 'btn ghost', text: '重置筛选条件',
          onclick: () => { Store.resetView(); syncControls(); load(); }
        })
      }));
      return;
    }

    const frag = document.createDocumentFragment();
    items.forEach((it) => frag.appendChild(card(it)));
    box.appendChild(frag);
  }

  function renderFoot() {
    const foot = $('#listFoot');
    const n = Store.state.items.length;
    if (!n) { foot.hidden = true; return; }
    foot.hidden = false;
    const s = Store.state.summary;
    clear(foot);
    foot.appendChild(h('span', { text: `共 ${n} 条` + (s.avg_workdays ? ` · 平均完成耗时 ${s.avg_workdays} 个工作日` : '') }));
    foot.appendChild(h('button', { class: 'link', text: '回到顶部',
                                   onclick: () => window.scrollTo({ top: 0, behavior: 'smooth' }) }));
  }

  /* ============================================================ 顶部统计 */
  function renderStats() {
    const s = Store.state.summary;
    const box = $('#statPills');
    clear(box);
    box.appendChild(UI.statPill('待办', s.total || 0));
    box.appendChild(UI.statPill('未完成', s.doing || 0, 'doing'));
    box.appendChild(UI.statPill('已完成', s.done || 0, 'done'));
    if (s.overdue) box.appendChild(UI.statPill('逾期', s.overdue, 'danger'));
    if (s.due_today) box.appendChild(UI.statPill('今日到期', s.due_today, 'warn'));

    const view = Store.state.view;
    const label = [];
    if (view.status === 'doing') label.push('进行中');
    if (view.status === 'done') label.push('已完成');
    if (view.todo_type) label.push(view.todo_type);
    if (view.priority) label.push(view.priority);
    if (view.q) label.push('搜索“' + view.q + '”');
    $('#pageSub').textContent = `${Store.state.meta.today || todayStr()} ${weekdayCn()}`
      + ` · 完成率 ${s.done_rate || 0}%`
      + (label.length ? ' · ' + label.join(' / ') : '');
  }

  /** 侧栏日期卡片里的「N 项待办未完成」 */
  function renderPendingCount() {
    const c = Store.state.counts || { by_type: {}, pending: 0, total: 0 };
    const countNode = $('#stCount');
    if (!countNode) return;
    clear(countNode);
    countNode.appendChild(h('b', { text: String(c.pending || 0) }));
    countNode.appendChild(document.createTextNode(' ' + UI.pendingText('').trim()));
  }

  /* ============================================================ 工具条控件 */
  function renderTabs() {
    const box = $('#statusTabs');
    clear(box);
    const c = Store.state.counts || {};
    const total = c.total || 0;
    const pending = c.pending || 0;
    const tabs = [
      { key: 'all', label: '全部', count: total },
      { key: 'doing', label: '进行中', count: pending },
      { key: 'done', label: '已完成', count: Math.max(0, total - pending) }
    ];
    tabs.forEach((t) => {
      box.appendChild(h('button', {
        class: 'tab' + (Store.state.view.status === t.key ? ' active' : ''),
        onclick: () => { Store.state.view.status = t.key; Store.saveView(); syncControls(); load(); }
      }, h('span', { text: t.label }), h('em', { text: String(t.count) })));
    });
  }

  function renderPriorityChips() {
    const box = $('#priorityChips');
    clear(box);
    const v = Store.state.view.priority;
    box.appendChild(h('button', {
      class: 'chip' + (!v ? ' active' : ''), text: '全部优先级',
      onclick: () => { Store.state.view.priority = ''; Store.saveView(); syncControls(); load(); }
    }));
    (UI.enumOf('priorities', ['P0', 'P1', 'P2'])).forEach((p) => {
      const col = ((Store.state.meta.colors || {}).priority || {})[p] || '#64748b';
      box.appendChild(h('button', {
        class: 'chip' + (v === p ? ' active' : ''),
        style: v === p ? { borderColor: col, color: col, background: col + '14' } : null,
        onclick: () => { Store.state.view.priority = v === p ? '' : p; Store.saveView(); syncControls(); load(); }
      }, h('i', { class: 'dot', style: { background: col } }), p));
    });
  }

  function renderTypeSelect() {
    const sel = $('#typeFilter');
    if (!sel) return;
    clear(sel);
    sel.appendChild(h('option', { value: '', text: '全部类型' }));
    UI.enumOf('todo_types').forEach((t) => {
      sel.appendChild(h('option', { value: t, text: t }));
    });
  }

  /** 把 Store.state.view 回写到各控件（避免重建 DOM 时丢状态） */
  function syncControls() {
    const v = Store.state.view;
    renderTabs();
    renderPriorityChips();
    const sel = $('#typeFilter');
    if (sel) sel.value = v.todo_type || '';
    const si = $('#searchInput');
    if (si && document.activeElement === si) {
      // 用户正在输入，保留原值，避免光标被打断
    } else if (si && si.value !== v.q) {
      si.value = v.q || '';
    }
    const clearBtn = $('#searchClear');
    if (clearBtn) clearBtn.hidden = !v.q;
    const sort = $('#sortSelect');
    if (sort) sort.value = v.sort + ':' + v.order;
  }

  /* ============================================================ 新建 / 编辑 */
  function openEditor(item) {
    const enums = {
      todo_types: UI.enumOf('todo_types'),
      todo_status: UI.enumOf('todo_status', ['进行中', '已完成']),
      priorities: UI.enumOf('priorities', ['P0', 'P1', 'P2'])
    };
    const defaults = Store.state.meta.defaults || {};
    const limits = Store.state.meta.limits || { remark_max: 1000, title_max: 200 };
    const isNew = !item;
    const data = item ? Object.assign({}, item) : {
      title: '', todo_type: defaults.todo_type || (enums.todo_types || [])[0] || '',
      status: defaults.status || '进行中', priority: defaults.priority || 'P1',
      remark: '', due_date: ''
    };

    const errBox = h('div', { class: 'form-error', hidden: true });

    const titleInput = h('textarea', {
      class: 'input title-input', rows: '2', maxlength: String(limits.title_max || 200),
      placeholder: '要做什么？支持中英文、数字与特殊字符'
    });
    titleInput.value = data.title || '';

    const typeSel = h('select', { class: 'input' });
    (enums.todo_types || []).forEach((t) => typeSel.appendChild(h('option', { value: t, text: t })));
    typeSel.value = data.todo_type;

    const statusSel = h('select', { class: 'input' });
    (enums.todo_status || ['进行中', '已完成']).forEach((s) => statusSel.appendChild(h('option', { value: s, text: s })));
    statusSel.value = data.status;

    const prioSel = h('select', { class: 'input' });
    (enums.priorities || ['P0', 'P1', 'P2']).forEach((p) => prioSel.appendChild(h('option', { value: p, text: p })));
    prioSel.value = data.priority;

    const dueInput = h('input', { class: 'input', type: 'date' });
    dueInput.value = data.due_date || '';

    const remarkInput = h('textarea', {
      class: 'input', rows: '4', maxlength: String(limits.remark_max || 1000),
      placeholder: '补充说明（最多 ' + (limits.remark_max || 1000) + ' 字）'
    });
    remarkInput.value = data.remark || '';

    const counter = h('span', { class: 'counter' });
    const updateCounter = () => {
      const len = remarkInput.value.length;
      counter.textContent = `${len} / ${limits.remark_max || 1000}`;
      counter.classList.toggle('warn', len > (limits.remark_max || 1000) * 0.9);
    };
    remarkInput.addEventListener('input', updateCounter);
    updateCounter();

    const dueHint = h('span', { class: 'hint' });
    const updateDueHint = () => {
      const d = dueInput.value;
      if (!d) { dueHint.textContent = '不填则不提醒逾期'; return; }
      const left = daysUntil(d);
      dueHint.textContent = left < 0 ? `已逾期 ${Math.abs(left)} 天`
        : left === 0 ? '今天到期' : `剩 ${left} 天`;
      dueHint.classList.toggle('danger', left < 0);
    };
    dueInput.addEventListener('change', updateDueHint);
    updateDueHint();

    const showError = (msg) => {
      errBox.textContent = msg;
      errBox.hidden = false;
      titleInput.classList.add('invalid');
      titleInput.focus();
    };

    const save = async (close) => {
      const payload = {
        title: titleInput.value.trim(),
        todo_type: typeSel.value,
        status: statusSel.value,
        priority: prioSel.value,
        due_date: dueInput.value || '',
        remark: remarkInput.value
      };
      if (!payload.title) { showError('事项不能为空'); return; }
      errBox.hidden = true;
      titleInput.classList.remove('invalid');
      try {
        const saved = isNew ? await Api.create(payload) : await Api.update(data.id, payload);
        close();
        toast(isNew ? '已新建待办' : '已保存修改', 'ok');
        if (isNew) { Store.state.view.status = Store.state.view.status === 'done' ? 'all' : Store.state.view.status; syncControls(); }
        upsertLocal(saved, isNew);
      } catch (e) {
        showError(e.message);
        toast(e.message, 'err');
      }
    };

    const form = h('div', { class: 'form' },
      errBox,
      field('事项 *', titleInput),
      h('div', { class: 'form-row' },
        field('类型', typeSel),
        field('优先级', prioSel)),
      h('div', { class: 'form-row' },
        field('状态', statusSel),
        field('截止日期（可选）', h('div', { class: 'with-hint' }, dueInput, dueHint))),
      field(h('span', {}, '备注 ', counter), remarkInput),
      isNew ? null : h('div', { class: 'form-meta' },
        h('span', { text: '创建时间：' + (data.created_at || '—') }),
        h('span', { text: '完成时间：' + (data.completed_at || '—') }),
        data.workdays_text ? h('span', { text: '完成耗时：' + data.workdays_text }) : null));

    modal({
      title: isNew ? '新建待办' : '编辑待办',
      width: '620px',
      body: form,
      footer: (close) => [
        !isNew ? h('button', {
          class: 'btn danger ghost-danger', text: '删除',
          onclick: async () => {
            const yes = await confirmDialog(`确定删除「${trim(data.title, 30)}」？删除后不可恢复。`,
              { danger: true, okText: '删除' });
            if (!yes) return;
            try {
              await Api.remove(data.id);
              close();
              toast('已删除', 'ok');
              removeLocal(data.id);
            } catch (e) { toast(e.message, 'err'); }
          }
        }) : null,
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn ghost', text: '取消', onclick: () => close() }),
        h('button', { class: 'btn primary', text: isNew ? '创建' : '保存', onclick: () => save(close) })
      ]
    });

    // Ctrl/Cmd + Enter 快速保存
    form.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        save(() => { const m = $('.modal-mask:last-child'); if (m) m.remove(); load(); });
      }
    });
  }

  function field(label, node) {
    return h('label', { class: 'field' },
      h('span', { class: 'field-label' }, label), node);
  }

  function upsertLocal(item, isNew) {
    if (isNew && fitsCurrentFilter(item)) {
      Store.state.items.unshift(item);
      Store.state.counts.total = (Store.state.counts.total || 0) + 1;
      if (item.status === '进行中') Store.state.counts.pending = (Store.state.counts.pending || 0) + 1;
      renderCards();
    }
    load({ silent: true });
  }

  function removeLocal(id) {
    Store.state.items = Store.state.items.filter((x) => x.id !== id);
    Store.state.counts.total = Math.max(0, (Store.state.counts.total || 0) - 1);
    load({ silent: true });
  }

  function fitsCurrentFilter(item) {
    const v = Store.state.view;
    if (v.todo_type && item.todo_type !== v.todo_type) return false;
    if (v.priority && item.priority !== v.priority) return false;
    return true;
  }

  /* ============================================================ 操作 */
  async function toggle(item) {
    if (busy) return;
    busy = true;
    try {
      const updated = await Api.toggle(item.id);
      replaceItem(updated);
      renderCards();
      toast(updated.status === '已完成'
        ? `已完成 · 耗时 ${updated.workdays_text || '—'}`
        : '已恢复为进行中', 'ok');
      load({ silent: true });
    } catch (e) {
      toast(e.message, 'err');
    } finally {
      busy = false;
    }
  }

  async function remove(item) {
    const yes = await confirmDialog(`确定删除「${trim(item.title, 30)}」？删除后不可恢复。`,
      { danger: true, okText: '删除' });
    if (!yes) return;
    try {
      await Api.remove(item.id);
      toast('已删除', 'ok');
      removeLocal(item.id);
    } catch (e) { toast(e.message, 'err'); }
  }

  async function clearDone() {
    const done = (Store.state.counts.total || 0) - (Store.state.counts.pending || 0);
    if (!done) { toast('没有已完成的待办', 'info'); return; }
    const yes = await confirmDialog(`确定删除全部 ${done} 条已完成待办？删除后不可恢复。`,
      { danger: true, okText: '全部删除' });
    if (!yes) return;
    try {
      const res = await Api.clearDone();
      toast(`已清空 ${res.deleted || 0} 条已完成待办`, 'ok');
      load();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function seedDemo() {
    try {
      const res = await Api.seed({ reset: false, force: true });
      toast(res.created ? `已载入示例数据 ${res.created} 条` : '示例数据已存在', 'ok');
      Store.resetView();
      syncControls();
      await refreshShell();
      load();
    } catch (e) { toast(e.message, 'err'); }
  }

  async function refreshShell() {
    try {
      Store.state.meta = await Api.meta();
      renderTypeSelect();
      renderPendingCount();
    } catch (e) { /* 静默：不影响主流程 */ }
  }

  /* ============================================================ 挂载 */
  function mount() {
    renderTypeSelect();
    syncControls();

    // 事件委托：卡片上的按钮
    $('#cards').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      const cardNode = e.target.closest('.card');
      if (!cardNode) return;
      const id = Number(cardNode.dataset.id);
      if (window.__DBG) console.log("DBG handler: btn=", !!btn, "act=", btn && btn.dataset.act, "cardId=", id, "itemFound=", !!Store.state.items.find((x) => x.id === id), "itemsIds=", Store.state.items.map(x=>x.id).join(","));
      const item = Store.state.items.find((x) => x.id === id);
      if (!item) return;
      if (!btn) { openEditor(item); return; }
      e.stopPropagation();
      if (btn.dataset.act === 'toggle') toggle(item);
      else if (btn.dataset.act === 'edit') openEditor(item);
      else if (btn.dataset.act === 'del') remove(item);
    });

    // 键盘可达性
    $('#cards').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const cardNode = e.target.closest('.card');
      if (!cardNode || e.target !== cardNode) return;
      e.preventDefault();
      const item = Store.state.items.find((x) => x.id === Number(cardNode.dataset.id));
      if (item) openEditor(item);
    });

    $('#btnNew').addEventListener('click', () => openEditor(null));
    $('#btnClearDone').addEventListener('click', clearDone);

    $('#typeFilter').addEventListener('change', (e) => {
      Store.state.view.todo_type = e.target.value;
      Store.saveView();
      renderPendingCount();
      load();
    });

    $('#sortSelect').addEventListener('change', (e) => {
      const [sort, order] = e.target.value.split(':');
      Store.state.view.sort = sort;
      Store.state.view.order = order;
      Store.saveView();
      load();
    });

    const onSearch = debounce(() => {
      Store.state.view.q = $('#searchInput').value.trim();
      Store.saveView();
      load();
    }, 300);
    $('#searchInput').addEventListener('input', () => {
      $('#searchClear').hidden = !$('#searchInput').value;
      onSearch();
    });
    $('#searchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') onSearch(); });
    $('#searchClear').addEventListener('click', () => {
      $('#searchInput').value = '';
      $('#searchClear').hidden = true;
      Store.state.view.q = '';
      Store.saveView();
      load();
    });

    // 全局快捷键：n 新建，/ 聚焦搜索
    document.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea, select')) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openEditor(null); }
      if (e.key === '/') { e.preventDefault(); $('#searchInput').focus(); }
    });

    // 移动端侧边栏
    $('#navToggle').addEventListener('click', () => {
      $('#sidebar').classList.toggle('open');
    });

    window.addEventListener('hashchange', () => {
      if (location.hash && location.hash !== '#/todos') {
        toast('其他模块将在二期开放', 'info');
        location.hash = '#/todos';
      }
    });
  }

  /** 数据变化后重画外壳类组件（页签数量 / 侧栏未完成数 / 类型下拉） */
  function renderShell() {
    syncControls();
    renderTypeSelect();
    renderPendingCount();
  }

  return { mount, load, refreshShell, renderPendingCount, renderShell, seedDemo, openEditor };
})();
