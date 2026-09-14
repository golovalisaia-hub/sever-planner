(() => {
  'use strict';

  const VERSION = 1;
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const uid = prefix => `${prefix}-${crypto.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2)}`;
  const clamp = value => Math.max(0, Number(value) || 0);
  const now = () => Date.now();
  const todayISO = () => new Date().toLocaleDateString('sv-SE');
  const monthKey = value => String(value || todayISO()).slice(0, 7);
  const currentMonth = () => monthKey(todayISO());
  const CATEGORIES = [
    ['housing', 'Дом'], ['food', 'Еда'], ['transport', 'Транспорт'], ['subscriptions', 'Подписки'],
    ['shopping', 'Покупки'], ['education', 'Учёба'], ['health', 'Здоровье'], ['leisure', 'Отдых'], ['other', 'Другое']
  ];
  const categoryName = key => CATEGORIES.find(([id]) => id === key)?.[1] || 'Другое';
  const categoryOptions = selected => CATEGORIES.map(([id, label]) => `<option value="${id}"${id === selected ? ' selected' : ''}>${label}</option>`).join('');
  const appState = () => window.SeverApp?.getState?.() || null;
  const moneyState = () => appState()?.profile?.money || {};
  const currency = () => ['RUB', 'EUR', 'USD'].includes(moneyState().currency) ? moneyState().currency : 'RUB';
  const formatter = () => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: currency(), maximumFractionDigits: 0 });
  const formatMoney = value => formatter().format(Math.round(clamp(value)));

  function normalizeTransaction(raw = {}) {
    const type = raw.type === 'income' ? 'income' : 'expense';
    return {
      id: String(raw.id || uid('txn')),
      type,
      title: String(raw.title || (type === 'income' ? 'Доход' : 'Расход')).slice(0, 80),
      amount: clamp(raw.amount),
      category: CATEGORIES.some(([id]) => id === raw.category) ? raw.category : 'other',
      date: /^\d{4}-\d{2}-\d{2}$/.test(raw.date || '') ? raw.date : todayISO(),
      recurringId: raw.recurringId ? String(raw.recurringId) : '',
      createdAt: clamp(raw.createdAt) || now(),
      updatedAt: clamp(raw.updatedAt) || now()
    };
  }

  function normalizeRecurring(raw = {}) {
    return {
      id: String(raw.id || uid('rec')),
      title: String(raw.title || 'Регулярный платёж').slice(0, 80),
      amount: clamp(raw.amount),
      category: CATEGORIES.some(([id]) => id === raw.category) ? raw.category : 'subscriptions',
      day: Math.max(1, Math.min(28, Math.trunc(Number(raw.day) || 1))),
      active: raw.active !== false,
      createdAt: clamp(raw.createdAt) || now(),
      updatedAt: clamp(raw.updatedAt) || now()
    };
  }

  function normalizeFinance(raw = {}) {
    const budgets = {};
    for (const [key] of CATEGORIES) budgets[key] = clamp(raw.budgets?.[key]);
    return {
      v: VERSION,
      budgets,
      transactions: Array.isArray(raw.transactions) ? raw.transactions.map(normalizeTransaction).filter(item => item.amount > 0).slice(-2000) : [],
      recurrings: Array.isArray(raw.recurrings) ? raw.recurrings.map(normalizeRecurring).filter(item => item.amount > 0).slice(-100) : []
    };
  }

  function financeState() {
    const state = appState();
    if (!state) return normalizeFinance();
    state.profile = state.profile && typeof state.profile === 'object' ? state.profile : {};
    state.profile.finance = normalizeFinance(state.profile.finance);
    return state.profile.finance;
  }

  async function persist() {
    const state = appState();
    if (!state) return;
    state.profile = state.profile && typeof state.profile === 'object' ? state.profile : {};
    state.profile.finance = normalizeFinance(state.profile.finance);
    await window.SeverApp?.persist?.();
    try {
      window.SeverCloud?.capture?.();
      window.SeverCloud?.syncSoon?.(0);
    } catch {}
  }

  function monthTransactions(month = currentMonth()) {
    return financeState().transactions.filter(item => monthKey(item.date) === month);
  }

  function legacyPlanMonthly() {
    return (Array.isArray(moneyState().items) ? moneyState().items : []).reduce((sum, item) => sum + clamp(item.monthlyBudget), 0);
  }

  function model() {
    const finance = financeState();
    const tx = monthTransactions();
    const actualIncome = tx.filter(item => item.type === 'income').reduce((sum, item) => sum + item.amount, 0);
    const expenses = tx.filter(item => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0);
    const expectedIncome = clamp(moneyState().monthlyIncome);
    const income = actualIncome || expectedIncome;
    const budgetTotal = Object.values(finance.budgets).reduce((sum, value) => sum + clamp(value), 0);
    const recurringTotal = finance.recurrings.filter(item => item.active).reduce((sum, item) => sum + item.amount, 0);
    const planMonthly = legacyPlanMonthly();
    const spentByCategory = Object.fromEntries(CATEGORIES.map(([key]) => [key, tx.filter(item => item.type === 'expense' && item.category === key).reduce((sum, item) => sum + item.amount, 0)]));
    const overBudget = CATEGORIES.map(([key, label]) => ({ key, label, spent: spentByCategory[key], limit: finance.budgets[key] })).filter(item => item.limit > 0 && item.spent > item.limit).sort((a, b) => (b.spent - b.limit) - (a.spent - a.limit));
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const daysLeft = Math.max(1, daysInMonth - new Date().getDate() + 1);
    const remainingBudget = Math.max(0, budgetTotal - expenses);
    return {
      tx, actualIncome, expectedIncome, income, expenses,
      balance: income - expenses,
      budgetTotal, recurringTotal, planMonthly, spentByCategory, overBudget,
      daysLeft, remainingBudget, dailySafe: budgetTotal > 0 ? remainingBudget / daysLeft : 0,
      plannedFree: income - budgetTotal - planMonthly
    };
  }

  function ensureNavigationLabels() {
    const desktop = $('.desktop-sidebar .app-nav [data-view="money"] span:last-child');
    if (desktop) desktop.textContent = 'Финансы';
    const mobile = $('#mobileMenuSheet [data-menu-view="money"]');
    if (mobile) {
      const title = mobile.querySelector('b');
      const hint = mobile.querySelector('small');
      if (title) title.textContent = 'Финансы';
      if (hint) hint.textContent = 'Бюджет, расходы и цели';
    }
  }

  function ensureDialogs() {
    if ($('#financeTransactionDialog')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <dialog id="financeTransactionDialog" class="money-dialog finance-dialog"><form id="financeTransactionForm">
        <div class="dialog-head"><div><small>ОПЕРАЦИЯ</small><h2 id="financeTransactionTitle">Новая операция</h2></div><button type="button" data-finance-close="financeTransactionDialog" aria-label="Закрыть">×</button></div>
        <input id="financeTransactionId" type="hidden">
        <div class="money-type-switch"><button type="button" data-finance-type="expense" class="active">Расход</button><button type="button" data-finance-type="income">Доход</button></div>
        <input id="financeTransactionType" type="hidden" value="expense">
        <label>Название<input id="financeTransactionName" required maxlength="80" placeholder="Например: Продукты"></label>
        <div class="money-form-grid"><label>Сумма<input id="financeTransactionAmount" required type="number" min="1" max="100000000" step="1" inputmode="decimal"></label><label>Дата<input id="financeTransactionDate" required type="date"></label></div>
        <label id="financeTransactionCategoryLabel">Категория<select id="financeTransactionCategory">${categoryOptions('other')}</select></label>
        <div class="dialog-actions"><button id="financeTransactionDelete" type="button" class="danger hidden">Удалить</button><button class="primary">Сохранить</button></div>
      </form></dialog>
      <dialog id="financeRecurringDialog" class="money-dialog finance-dialog"><form id="financeRecurringForm">
        <div class="dialog-head"><div><small>РЕГУЛЯРНО</small><h2 id="financeRecurringTitle">Новый платёж</h2></div><button type="button" data-finance-close="financeRecurringDialog" aria-label="Закрыть">×</button></div>
        <input id="financeRecurringId" type="hidden">
        <label>Название<input id="financeRecurringName" required maxlength="80" placeholder="Например: Связь"></label>
        <div class="money-form-grid"><label>Сумма<input id="financeRecurringAmount" required type="number" min="1" max="100000000" step="1" inputmode="decimal"></label><label>День месяца<input id="financeRecurringDay" required type="number" min="1" max="28" step="1" inputmode="numeric"></label></div>
        <label>Категория<select id="financeRecurringCategory">${categoryOptions('subscriptions')}</select></label>
        <div class="dialog-actions"><button id="financeRecurringDelete" type="button" class="danger hidden">Удалить</button><button class="primary">Сохранить</button></div>
      </form></dialog>`;
    while (wrap.firstElementChild) document.body.appendChild(wrap.firstElementChild);
    $$('[data-finance-close]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.financeClose)?.close()));
    ['financeTransactionDialog', 'financeRecurringDialog'].forEach(id => {
      const dialog = document.getElementById(id);
      dialog?.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    });
  }

  function ensureShell() {
    const root = $('#moneyView');
    if (!root) return false;
    ensureNavigationLabels();
    const eyebrow = root.querySelector('.money-heading small');
    const title = $('#moneyPageTitle');
    const intro = root.querySelector('.money-intro');
    const addPlan = $('#moneyNew');
    if (eyebrow) eyebrow.textContent = 'ФИНАНСОВЫЙ ЦЕНТР';
    if (title) title.textContent = 'Финансы';
    if (intro) intro.textContent = 'Бюджет, операции, регулярные платежи, долги и цели — в одном месте. Банковское подключение не требуется.';
    if (addPlan) addPlan.textContent = '+ План';

    if (!$('#financeTabs')) {
      const tabs = document.createElement('div');
      tabs.id = 'financeTabs';
      tabs.className = 'finance-tabs';
      tabs.setAttribute('role', 'tablist');
      tabs.innerHTML = `
        <button type="button" class="active" data-finance-tab="overview">Обзор</button>
        <button type="button" data-finance-tab="budget">Бюджет</button>
        <button type="button" data-finance-tab="transactions">Операции</button>
        <button type="button" data-finance-tab="plans">Планы</button>`;
      intro?.after(tabs);
    }

    if (!$('#financeOverviewPanel')) {
      const panel = document.createElement('section');
      panel.id = 'financeOverviewPanel';
      panel.className = 'finance-panel';
      panel.dataset.financePanel = 'overview';
      panel.innerHTML = `
        <section class="finance-hero">
          <article class="finance-balance"><small>ОСТАТОК ЭТОГО МЕСЯЦА</small><b id="financeBalance">0</b><span id="financeBalanceMeta">Доходы минус расходы</span></article>
          <div class="finance-kpis"><article><small>ДОХОДЫ</small><b id="financeIncome">0</b></article><article><small>РАСХОДЫ</small><b id="financeExpenses">0</b></article><article><small>РЕГУЛЯРНО</small><b id="financeRecurringTotal">0</b></article><article><small>НА ЦЕЛИ / ДОЛГИ</small><b id="financePlanMonthly">0</b></article></div>
        </section>
        <div class="finance-actions"><button type="button" class="primary" data-finance-new="expense">+ Расход</button><button type="button" data-finance-new="income">+ Доход</button><button type="button" data-finance-recurring-new>+ Регулярный</button></div>
        <section class="finance-grid">
          <article class="finance-insights"><div class="finance-section-title"><div><small>УМНЫЙ ОБЗОР</small><h2>Что важно сейчас</h2></div></div><div id="financeInsights" class="finance-insight-list"></div></article>
          <article class="finance-ai"><div class="finance-ai-head"><span>AI</span><div><small>SEVER AI</small><h2>Финансовый помощник</h2></div></div><p>Разберёт твой месяц по данным из SEVER и предложит понятные шаги по бюджету. Никаких банковских подключений.</p><div class="finance-ai-actions"><button type="button" data-finance-ai="month">Разобрать месяц</button><button type="button" data-finance-ai="budget">Проверить бюджет</button><button type="button" data-finance-ai="goal">Помочь с целью</button></div><small class="finance-ai-privacy">Сводка отправляется Sever AI только после твоего нажатия.</small></article>
        </section>
        <section class="finance-overview-lists"><article><div class="finance-section-title"><div><small>БЮДЖЕТ</small><h2>Категории</h2></div><button type="button" data-finance-go="budget">Настроить</button></div><div id="financeBudgetPreview"></div></article><article><div class="finance-section-title"><div><small>РЕГУЛЯРНО</small><h2>Ближайшие платежи</h2></div><button type="button" data-finance-recurring-new>Добавить</button></div><div id="financeRecurringPreview"></div></article></section>`;
      $('#financeTabs')?.after(panel);
    }

    if (!$('#financeBudgetPanel')) {
      const panel = document.createElement('section');
      panel.id = 'financeBudgetPanel';
      panel.className = 'finance-panel hidden';
      panel.dataset.financePanel = 'budget';
      panel.innerHTML = `<div class="finance-section-title finance-panel-head"><div><small>ПЛАН НА МЕСЯЦ</small><h2>Бюджет по категориям</h2><p>Задай лимиты — SEVER покажет, сколько уже потрачено и что осталось.</p></div></div><div id="financeBudgetList" class="finance-budget-list"></div>`;
      $('#financeOverviewPanel')?.after(panel);
    }

    if (!$('#financeTransactionsPanel')) {
      const panel = document.createElement('section');
      panel.id = 'financeTransactionsPanel';
      panel.className = 'finance-panel hidden';
      panel.dataset.financePanel = 'transactions';
      panel.innerHTML = `<div class="finance-section-title finance-panel-head"><div><small>ИСТОРИЯ</small><h2>Операции</h2><p>Доходы и расходы, которые ты добавляешь вручную.</p></div><div class="finance-actions compact"><button type="button" class="primary" data-finance-new="expense">+ Расход</button><button type="button" data-finance-new="income">+ Доход</button></div></div><div id="financeTransactionList" class="finance-transaction-list"></div><div class="finance-section-title finance-recurring-head"><div><small>ПОВТОРЯЕТСЯ</small><h2>Регулярные платежи</h2></div><button type="button" data-finance-recurring-new>+ Добавить</button></div><div id="financeRecurringList" class="finance-recurring-list"></div>`;
      $('#financeBudgetPanel')?.after(panel);
    }

    if (!$('#financePlansPanel')) {
      const panel = document.createElement('section');
      panel.id = 'financePlansPanel';
      panel.className = 'finance-panel hidden finance-plans';
      panel.dataset.financePanel = 'plans';
      const quick = $('#moneyQuickForm');
      const summary = root.querySelector('.money-summary');
      const head = root.querySelector('.money-section-head');
      const list = $('#moneyList');
      if (quick) panel.appendChild(quick);
      if (summary) panel.appendChild(summary);
      if (head) panel.appendChild(head);
      if (list) panel.appendChild(list);
      root.appendChild(panel);
      if (quick?.querySelector('input')) quick.querySelector('input').placeholder = 'Например: долг 30к до декабря или накопить 100к к июню';
    }

    ensureDialogs();
    root.dataset.financeV111 = 'ready';
    document.documentElement.dataset.severFinance = 'v111';
    return true;
  }

  function switchTab(tab) {
    const next = ['overview', 'budget', 'transactions', 'plans'].includes(tab) ? tab : 'overview';
    $$('#financeTabs [data-finance-tab]').forEach(button => button.classList.toggle('active', button.dataset.financeTab === next));
    $$('[data-finance-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.financePanel !== next));
    render();
  }

  function insightRows(data) {
    const rows = [];
    if (!data.tx.length) rows.push(['Начни с операций', 'Добавь первый доход или расход — обзор и бюджет сразу начнут считать месяц.']);
    if (data.overBudget.length) {
      const top = data.overBudget[0];
      rows.push(['Есть превышение бюджета', `${top.label}: на ${formatMoney(top.spent - top.limit)} выше заданного лимита.`]);
    }
    if (data.income > 0 && data.expenses > data.income) rows.push(['Расходы выше доходов', `Разница сейчас ${formatMoney(data.expenses - data.income)}. Проверь крупные категории и регулярные платежи.`]);
    if (data.income > 0 && data.recurringTotal / data.income >= .4) rows.push(['Высокая доля регулярных платежей', `Они занимают около ${Math.round(data.recurringTotal / data.income * 100)}% месячного дохода.`]);
    if (data.budgetTotal > 0) rows.push(['Безопасный темп', `По заданному бюджету осталось ${formatMoney(data.remainingBudget)} — примерно ${formatMoney(data.dailySafe)} в день до конца месяца.`]);
    if (data.income > 0 && data.budgetTotal > 0 && data.plannedFree >= 0) rows.push(['План сходится', `После бюджета и плановых взносов остаётся около ${formatMoney(data.plannedFree)}.`]);
    return rows.slice(0, 4);
  }

  function renderOverview(data) {
    $('#financeBalance').textContent = formatMoney(data.balance);
    $('#financeBalanceMeta').textContent = data.actualIncome ? 'По добавленным операциям' : data.expectedIncome ? 'С учётом указанного месячного дохода' : 'Добавь доход, чтобы видеть реальный остаток';
    $('#financeIncome').textContent = formatMoney(data.income);
    $('#financeExpenses').textContent = formatMoney(data.expenses);
    $('#financeRecurringTotal').textContent = formatMoney(data.recurringTotal);
    $('#financePlanMonthly').textContent = formatMoney(data.planMonthly);
    const insights = $('#financeInsights');
    if (insights) insights.innerHTML = insightRows(data).map(([title, text]) => `<article><b>${title}</b><span>${text}</span></article>`).join('');

    const budgetPreview = $('#financeBudgetPreview');
    if (budgetPreview) {
      const configured = CATEGORIES.map(([key, label]) => ({ key, label, limit: financeState().budgets[key], spent: data.spentByCategory[key] })).filter(item => item.limit > 0 || item.spent > 0).sort((a, b) => b.spent - a.spent).slice(0, 4);
      budgetPreview.innerHTML = configured.length ? configured.map(item => {
        const pct = item.limit > 0 ? Math.min(100, Math.round(item.spent / item.limit * 100)) : 0;
        return `<div class="finance-mini-row"><div><b>${item.label}</b><span>${formatMoney(item.spent)}${item.limit ? ` из ${formatMoney(item.limit)}` : ' · лимит не задан'}</span></div><i><em style="width:${pct}%"></em></i></div>`;
      }).join('') : '<div class="finance-empty-small">Лимиты пока не заданы.</div>';
    }

    const recurringPreview = $('#financeRecurringPreview');
    if (recurringPreview) {
      const list = financeState().recurrings.filter(item => item.active).sort((a, b) => a.day - b.day).slice(0, 4);
      recurringPreview.innerHTML = list.length ? list.map(item => `<div class="finance-recurring-mini"><div><b>${item.title}</b><span>${item.day}-го числа · ${categoryName(item.category)}</span></div><strong>${formatMoney(item.amount)}</strong></div>`).join('') : '<div class="finance-empty-small">Регулярных платежей пока нет.</div>';
    }
  }

  function renderBudget(data) {
    const root = $('#financeBudgetList');
    if (!root) return;
    root.innerHTML = CATEGORIES.map(([key, label]) => {
      const limit = financeState().budgets[key];
      const spent = data.spentByCategory[key];
      const remaining = Math.max(0, limit - spent);
      const pct = limit > 0 ? Math.min(100, Math.round(spent / limit * 100)) : 0;
      return `<article class="finance-budget-row${limit > 0 && spent > limit ? ' over' : ''}"><div class="finance-budget-name"><b>${label}</b><span>${limit ? `${formatMoney(spent)} потрачено · ${formatMoney(remaining)} осталось` : `${formatMoney(spent)} потрачено · лимит не задан`}</span></div><div class="finance-budget-input"><input data-finance-budget="${key}" type="number" min="0" max="100000000" step="1" inputmode="decimal" value="${limit || ''}" placeholder="Лимит"><span>${currency()}</span></div><i><em style="width:${pct}%"></em></i></article>`;
    }).join('');
  }

  function renderTransactions() {
    const root = $('#financeTransactionList');
    if (!root) return;
    const list = [...monthTransactions()].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    root.innerHTML = list.length ? list.map(item => `<button type="button" class="finance-transaction-row" data-finance-edit="${item.id}"><span class="finance-transaction-sign ${item.type}">${item.type === 'income' ? '+' : '−'}</span><span><b>${item.title}</b><small>${new Date(`${item.date}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} · ${item.type === 'income' ? 'Доход' : categoryName(item.category)}</small></span><strong class="${item.type}">${item.type === 'income' ? '+' : '−'}${formatMoney(item.amount)}</strong></button>`).join('') : '<div class="finance-empty">Операций за этот месяц пока нет.<br><span>Добавь доход или расход — SEVER соберёт картину месяца.</span></div>';

    const recurring = $('#financeRecurringList');
    if (!recurring) return;
    const paid = new Set(monthTransactions().filter(item => item.recurringId).map(item => item.recurringId));
    recurring.innerHTML = financeState().recurrings.length ? financeState().recurrings.sort((a, b) => a.day - b.day).map(item => `<article class="finance-recurring-row"><div><b>${item.title}</b><span>${item.day}-го числа · ${categoryName(item.category)}</span></div><strong>${formatMoney(item.amount)}</strong><div><button type="button" data-finance-recurring-pay="${item.id}"${paid.has(item.id) ? ' disabled' : ''}>${paid.has(item.id) ? 'Отмечено' : 'Отметить'}</button><button type="button" data-finance-recurring-edit="${item.id}">Изменить</button></div></article>`).join('') : '<div class="finance-empty">Регулярных платежей пока нет.</div>';
  }

  function render() {
    if (!ensureShell()) return;
    const data = model();
    renderOverview(data);
    renderBudget(data);
    renderTransactions();
  }

  function openTransaction(type = 'expense', id = '') {
    const item = id ? financeState().transactions.find(entry => entry.id === id) : null;
    const selectedType = item?.type || (type === 'income' ? 'income' : 'expense');
    $('#financeTransactionId').value = item?.id || '';
    $('#financeTransactionType').value = selectedType;
    $('#financeTransactionName').value = item?.title || '';
    $('#financeTransactionAmount').value = item?.amount || '';
    $('#financeTransactionDate').value = item?.date || todayISO();
    $('#financeTransactionCategory').value = item?.category || 'other';
    $('#financeTransactionCategoryLabel').classList.toggle('hidden', selectedType === 'income');
    $$('[data-finance-type]').forEach(button => button.classList.toggle('active', button.dataset.financeType === selectedType));
    $('#financeTransactionTitle').textContent = item ? 'Изменить операцию' : (selectedType === 'income' ? 'Новый доход' : 'Новый расход');
    $('#financeTransactionDelete').classList.toggle('hidden', !item);
    $('#financeTransactionDialog').showModal();
    requestAnimationFrame(() => $('#financeTransactionName').focus());
  }

  function openRecurring(id = '') {
    const item = id ? financeState().recurrings.find(entry => entry.id === id) : null;
    $('#financeRecurringId').value = item?.id || '';
    $('#financeRecurringName').value = item?.title || '';
    $('#financeRecurringAmount').value = item?.amount || '';
    $('#financeRecurringDay').value = item?.day || Math.min(28, new Date().getDate());
    $('#financeRecurringCategory').value = item?.category || 'subscriptions';
    $('#financeRecurringTitle').textContent = item ? 'Изменить платёж' : 'Новый регулярный платёж';
    $('#financeRecurringDelete').classList.toggle('hidden', !item);
    $('#financeRecurringDialog').showModal();
    requestAnimationFrame(() => $('#financeRecurringName').focus());
  }

  function financeSummary() {
    const data = model();
    const plans = Array.isArray(moneyState().items) ? moneyState().items : [];
    const debts = plans.filter(item => item.type !== 'goal').map(item => `${item.title}: осталось ${formatMoney(Math.max(0, clamp(item.targetAmount) - clamp(item.currentAmount)))}`).slice(0, 4);
    const goals = plans.filter(item => item.type === 'goal').map(item => `${item.title}: ${formatMoney(clamp(item.currentAmount))} из ${formatMoney(clamp(item.targetAmount))}`).slice(0, 4);
    const overs = data.overBudget.slice(0, 3).map(item => `${item.label} +${formatMoney(item.spent - item.limit)}`);
    return `Финансовая сводка SEVER за ${currentMonth()}: доход ${formatMoney(data.income)}, расходы ${formatMoney(data.expenses)}, остаток ${formatMoney(data.balance)}, бюджет ${formatMoney(data.budgetTotal)}, регулярные платежи ${formatMoney(data.recurringTotal)}, плановые взносы по целям/долгам ${formatMoney(data.planMonthly)}. Превышения: ${overs.join(', ') || 'нет'}. Долги: ${debts.join('; ') || 'нет'}. Цели: ${goals.join('; ') || 'нет'}.`;
  }

  function askAI(kind) {
    const lead = kind === 'budget'
      ? 'Проверь мой бюджет: найди 2–3 самых важных отклонения и предложи спокойные, реалистичные корректировки на этот месяц.'
      : kind === 'goal'
        ? 'Помоги оценить мои финансовые цели и долги: что сейчас логичнее приоритизировать в рамках уже указанного дохода и бюджета? Не предлагай кредиты, инвестиционные сделки или рискованные способы заработка.'
        : 'Разбери мой месяц по финансовой сводке: 3 главных наблюдения и 3 конкретных шага до конца месяца. Без осуждения и без профессиональных обещаний.';
    window.SeverAI?.open?.();
    const input = $('#severAiInput');
    if (!input) return;
    input.value = `${lead}\n\n${financeSummary()}`;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    requestAnimationFrame(() => {
      if (window.SeverCloud?.user && window.SeverCloud?.hydrated && !window.SeverCloud?.localOnly) $('#severAiForm')?.requestSubmit?.();
      else input.focus();
    });
  }

  function bind() {
    document.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const tab = target.closest('[data-finance-tab]');
      if (tab) return switchTab(tab.dataset.financeTab);
      const go = target.closest('[data-finance-go]');
      if (go) return switchTab(go.dataset.financeGo);
      const add = target.closest('[data-finance-new]');
      if (add) return openTransaction(add.dataset.financeNew);
      if (target.closest('[data-finance-recurring-new]')) return openRecurring();
      const edit = target.closest('[data-finance-edit]');
      if (edit) return openTransaction('expense', edit.dataset.financeEdit);
      const recurringEdit = target.closest('[data-finance-recurring-edit]');
      if (recurringEdit) return openRecurring(recurringEdit.dataset.financeRecurringEdit);
      const recurringPay = target.closest('[data-finance-recurring-pay]');
      if (recurringPay) {
        const item = financeState().recurrings.find(entry => entry.id === recurringPay.dataset.financeRecurringPay);
        if (!item) return;
        financeState().transactions.push(normalizeTransaction({ type: 'expense', title: item.title, amount: item.amount, category: item.category, date: todayISO(), recurringId: item.id }));
        persist().then(render);
        return;
      }
      const ai = target.closest('[data-finance-ai]');
      if (ai) return askAI(ai.dataset.financeAi);
    });

    document.addEventListener('change', event => {
      const input = event.target instanceof HTMLInputElement ? event.target : null;
      if (!input?.dataset.financeBudget) return;
      financeState().budgets[input.dataset.financeBudget] = clamp(input.value);
      persist().then(render);
    });

    $('#financeTransactionForm')?.addEventListener('submit', event => {
      event.preventDefault();
      const finance = financeState();
      const id = $('#financeTransactionId').value;
      const next = normalizeTransaction({
        id: id || undefined,
        type: $('#financeTransactionType').value,
        title: $('#financeTransactionName').value,
        amount: $('#financeTransactionAmount').value,
        category: $('#financeTransactionCategory').value,
        date: $('#financeTransactionDate').value,
        createdAt: finance.transactions.find(item => item.id === id)?.createdAt
      });
      if (!next.amount) return;
      const index = finance.transactions.findIndex(item => item.id === id);
      if (index >= 0) finance.transactions[index] = next; else finance.transactions.push(next);
      $('#financeTransactionDialog').close();
      persist().then(render);
    });

    $$('[data-finance-type]').forEach(button => button.addEventListener('click', () => {
      const type = button.dataset.financeType;
      $('#financeTransactionType').value = type;
      $$('[data-finance-type]').forEach(item => item.classList.toggle('active', item === button));
      $('#financeTransactionCategoryLabel').classList.toggle('hidden', type === 'income');
    }));

    $('#financeTransactionDelete')?.addEventListener('click', () => {
      const id = $('#financeTransactionId').value;
      if (!id) return;
      const finance = financeState();
      finance.transactions = finance.transactions.filter(item => item.id !== id);
      $('#financeTransactionDialog').close();
      persist().then(render);
    });

    $('#financeRecurringForm')?.addEventListener('submit', event => {
      event.preventDefault();
      const finance = financeState();
      const id = $('#financeRecurringId').value;
      const next = normalizeRecurring({ id: id || undefined, title: $('#financeRecurringName').value, amount: $('#financeRecurringAmount').value, day: $('#financeRecurringDay').value, category: $('#financeRecurringCategory').value, createdAt: finance.recurrings.find(item => item.id === id)?.createdAt });
      if (!next.amount) return;
      const index = finance.recurrings.findIndex(item => item.id === id);
      if (index >= 0) finance.recurrings[index] = next; else finance.recurrings.push(next);
      $('#financeRecurringDialog').close();
      persist().then(render);
    });

    $('#financeRecurringDelete')?.addEventListener('click', () => {
      const id = $('#financeRecurringId').value;
      if (!id) return;
      const finance = financeState();
      finance.recurrings = finance.recurrings.filter(item => item.id !== id);
      $('#financeRecurringDialog').close();
      persist().then(render);
    });
  }

  let installed = false;
  function boot(attempt = 0) {
    if (installed) return;
    if (!window.SeverApp?.getState || !$('#moneyView')) {
      if (attempt < 180) setTimeout(() => boot(attempt + 1), 50);
      return;
    }
    if (!ensureShell()) return;
    installed = true;
    bind();
    render();
    window.addEventListener('sever:cloud-status', render);
    window.addEventListener('sever:account-scope', render);
    window.addEventListener('sever:ready', render);
    window.SeverFinance = { render, switchTab, openTransaction, openRecurring, summary: financeSummary };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(), { once: true });
  else boot();
})();
