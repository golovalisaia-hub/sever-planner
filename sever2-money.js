(() => {
  'use strict';

  const VERSION = 1;
  const $ = selector => document.querySelector(selector);
  const moneyId = () => crypto.randomUUID?.() || `money-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const clamp = (value, min = 0) => Math.max(min, Number(value) || 0);
  const now = () => Date.now();
  const currentISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const moneyFormatters = new Map();
  const formatter = currency => {
    const key = ['RUB', 'EUR', 'USD'].includes(currency) ? currency : 'RUB';
    if (!moneyFormatters.has(key)) moneyFormatters.set(key, new Intl.NumberFormat('ru-RU', { style: 'currency', currency: key, maximumFractionDigits: 0 }));
    return moneyFormatters.get(key);
  };
  const formatMoney = (value, currency = 'RUB') => formatter(currency).format(Math.round(clamp(value)));
  const formatDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '';
    return new Date(`${value}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  function normalizeItem(raw = {}) {
    const type = raw.type === 'goal' ? 'goal' : 'debt';
    const targetAmount = clamp(raw.targetAmount);
    const currentAmount = Math.min(targetAmount || Infinity, clamp(raw.currentAmount));
    return {
      id: String(raw.id || moneyId()),
      type,
      title: String(raw.title || (type === 'debt' ? 'Долг' : 'Накопление')).slice(0, 80),
      targetAmount,
      currentAmount: Number.isFinite(currentAmount) ? currentAmount : 0,
      deadline: /^\d{4}-\d{2}-\d{2}$/.test(raw.deadline || '') ? raw.deadline : '',
      monthlyBudget: clamp(raw.monthlyBudget),
      calendarTaskIds: Array.isArray(raw.calendarTaskIds) ? raw.calendarTaskIds.map(String).slice(0, 120) : [],
      createdAt: clamp(raw.createdAt) || now(),
      updatedAt: clamp(raw.updatedAt) || now()
    };
  }

  function normalizeMoney(raw = {}) {
    const currency = ['RUB', 'EUR', 'USD'].includes(raw.currency) ? raw.currency : 'RUB';
    return {
      v: VERSION,
      currency,
      monthlyIncome: clamp(raw.monthlyIncome),
      items: Array.isArray(raw.items) ? raw.items.map(normalizeItem).filter(item => item.targetAmount > 0) : []
    };
  }

  function appState() { return window.SeverApp?.getState?.() || null; }
  function moneyState() {
    const state = appState();
    if (!state) return normalizeMoney();
    state.profile = state.profile && typeof state.profile === 'object' ? state.profile : {};
    state.profile.money = normalizeMoney(state.profile.money);
    return state.profile.money;
  }

  async function persist() {
    const state = appState();
    if (!state) return;
    state.profile = state.profile && typeof state.profile === 'object' ? state.profile : {};
    state.profile.money = normalizeMoney(state.profile.money);
    await window.SeverApp.persist?.();
    try {
      window.SeverCloud?.capture?.();
      window.SeverCloud?.syncSoon?.(0);
    } catch {}
  }

  function deadlineStatus(deadline) {
    if (!deadline) return { valid: false, overdue: false, days: null };
    const today = new Date(`${currentISO()}T12:00:00`);
    const end = new Date(`${deadline}T12:00:00`);
    if (!Number.isFinite(end.getTime())) return { valid: false, overdue: false, days: null };
    const days = Math.round((end - today) / 86400000);
    return { valid: true, overdue: days < 0, days };
  }

  function monthsUntil(deadline) {
    const status = deadlineStatus(deadline);
    if (!status.valid || status.overdue) return null;
    const today = new Date();
    const end = new Date(`${deadline}T12:00:00`);
    const months = (end.getFullYear() - today.getFullYear()) * 12 + end.getMonth() - today.getMonth() + 1;
    return Math.max(1, months);
  }

  function itemPlan(item) {
    const remaining = Math.max(0, item.targetAmount - item.currentAmount);
    const deadline = deadlineStatus(item.deadline);
    const months = monthsUntil(item.deadline);
    const needed = months ? Math.ceil(remaining / months) : 0;
    const monthly = item.monthlyBudget || needed;
    const estimatedMonths = monthly > 0 ? Math.ceil(remaining / monthly) : null;
    return { remaining, months, needed, monthly, estimatedMonths, overdue: deadline.overdue };
  }

  function monthDate(seed, offset) {
    const base = seed ? new Date(`${seed}T12:00:00`) : new Date();
    const day = base.getDate();
    const result = new Date();
    result.setHours(12, 0, 0, 0);
    result.setDate(1);
    result.setMonth(result.getMonth() + offset);
    const last = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
    result.setDate(Math.min(day, last));
    return `${result.getFullYear()}-${String(result.getMonth() + 1).padStart(2, '0')}-${String(result.getDate()).padStart(2, '0')}`;
  }

  function makeIcon(path) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
  }

  function createView() {
    if ($('#moneyView')) return;
    const main = document.querySelector('main');
    if (!main) return;
    const section = document.createElement('section');
    section.id = 'moneyView';
    section.className = 'view money-view';
    section.setAttribute('aria-labelledby', 'moneyPageTitle');
    section.innerHTML = `
      <div class="heading money-heading"><div><small>ЛИЧНЫЙ ПЛАН</small><h1 id="moneyPageTitle">Деньги</h1></div><button id="moneyNew" class="money-primary" type="button">+ Добавить</button></div>
      <p class="money-intro">Долги и накопления без банковского подключения. SEVER считает темп по тем суммам, которые вы вводите сами.</p>
      <form id="moneyQuickForm" class="money-quick">
        <span class="money-quick-icon">${makeIcon('<path d="M4 7h16v10H4z"/><path d="M8 12h8M12 9v6"/>')}</span>
        <input id="moneyQuickInput" autocomplete="off" maxlength="120" placeholder="Например: долг 10к до декабря">
        <button type="submit">Разобрать</button>
      </form>
      <section class="money-summary" aria-label="Сводка денег">
        <article><small>ОСТАЛОСЬ ПО ДОЛГАМ</small><b id="moneyDebtTotal">0</b><span id="moneyDebtMeta">Долгов нет</span></article>
        <article><small>НАКОПЛЕНО</small><b id="moneyGoalTotal">0</b><span id="moneyGoalMeta">Целей нет</span></article>
        <article><small>ДОХОД В МЕСЯЦ</small><b id="moneyIncomeTotal">Не указан</b><button id="moneyIncomeEdit" type="button">Изменить</button></article>
      </section>
      <div class="money-section-head"><div><small>МОИ ПЛАНЫ</small><h2>Долги и накопления</h2></div><div class="money-add-pills"><button type="button" data-money-create="debt">+ Долг</button><button type="button" data-money-create="goal">+ Накопление</button></div></div>
      <div id="moneyList" class="money-list"></div>
    `;
    const settings = $('#settingsView');
    if (settings) main.insertBefore(section, settings); else main.appendChild(section);
  }

  function openMoney() {
    window.SeverApp?.switchView?.('money');
    requestAnimationFrame(render);
  }

  function createNavigation() {
    const nav = document.querySelector('.desktop-sidebar .app-nav');
    if (nav && !nav.querySelector('[data-view="money"]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.view = 'money';
      button.innerHTML = `<span class="side-nav-icon" aria-hidden="true">${makeIcon('<path d="M4 7h16v10H4z"/><path d="M7 10h10M7 14h6"/>')}</span><span>Деньги</span>`;
      const progress = nav.querySelector('[data-view="progress"]');
      progress?.after(button);
      button.addEventListener('click', openMoney);
    }

    const mobileGrid = document.querySelector('#mobileMenuSheet .mobile-menu-grid');
    if (mobileGrid && !mobileGrid.querySelector('[data-menu-view="money"]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'sheet-action';
      button.dataset.menuView = 'money';
      button.innerHTML = `<span class="sheet-action-icon" aria-hidden="true">${makeIcon('<path d="M4 7h16v10H4z"/><path d="M7 10h10M7 14h6"/>')}</span><span><b>Деньги</b><small>Долги и накопления</small></span>`;
      mobileGrid.appendChild(button);
      button.addEventListener('click', () => {
        document.querySelector('#mobileMenuSheet[open]')?.close();
        openMoney();
      });
    }
  }

  function createDialogs() {
    if ($('#moneyItemDialog')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <dialog id="moneyItemDialog" class="money-dialog"><form id="moneyItemForm">
        <div class="dialog-head"><div><small id="moneyItemEyebrow">ДЕНЬГИ</small><h2 id="moneyItemTitle">Новый план</h2></div><button type="button" data-money-close="moneyItemDialog" aria-label="Закрыть">×</button></div>
        <input id="moneyItemId" type="hidden"><input id="moneyItemType" type="hidden" value="debt">
        <div class="money-type-switch" role="group" aria-label="Тип плана"><button type="button" data-money-type="debt">Долг</button><button type="button" data-money-type="goal">Накопление</button></div>
        <label>Название<input id="moneyItemName" required maxlength="80" placeholder="Например: Машина"></label>
        <div class="money-form-grid"><label>Общая сумма<input id="moneyItemTarget" required type="number" min="1" max="100000000" step="1" inputmode="decimal" placeholder="10000"></label><label id="moneyCurrentLabel">Уже внесено<input id="moneyItemCurrent" type="number" min="0" max="100000000" step="1" inputmode="decimal" placeholder="0"></label></div>
        <div class="money-form-grid"><label>Закрыть до — необязательно<input id="moneyItemDeadline" type="date"></label><label>План в месяц — необязательно<input id="moneyItemBudget" type="number" min="1" max="100000000" step="1" inputmode="decimal" placeholder="Например: 3000"></label></div>
        <p id="moneyItemHint" class="money-form-hint">SEVER покажет нужный темп. Расчёт долга — без процентов.</p>
        <div class="dialog-actions"><button id="moneyItemDelete" type="button" class="danger hidden">Удалить</button><button class="primary">Сохранить</button></div>
      </form></dialog>
      <dialog id="moneyProgressDialog" class="money-dialog"><form id="moneyProgressForm">
        <div class="dialog-head"><div><small>ПРОГРЕСС</small><h2 id="moneyProgressTitle">Добавить сумму</h2></div><button type="button" data-money-close="moneyProgressDialog" aria-label="Закрыть">×</button></div>
        <input id="moneyProgressId" type="hidden"><label id="moneyProgressLabel">Сумма<input id="moneyProgressAmount" required type="number" min="1" max="100000000" step="1" inputmode="decimal"></label>
        <p id="moneyProgressMeta" class="money-form-hint"></p><div class="dialog-actions"><span></span><button class="primary">Сохранить</button></div>
      </form></dialog>
      <dialog id="moneyIncomeDialog" class="money-dialog"><form id="moneyIncomeForm">
        <div class="dialog-head"><div><small>ДОХОД</small><h2>Доход в месяц</h2></div><button type="button" data-money-close="moneyIncomeDialog" aria-label="Закрыть">×</button></div>
        <label>Сумма<input id="moneyIncomeInput" type="number" min="0" max="100000000" step="1" inputmode="decimal" placeholder="Можно оставить 0"></label>
        <p class="money-form-hint">Нужен только для оценки доли ежемесячного плана. Банк к SEVER не подключается.</p><div class="dialog-actions"><span></span><button class="primary">Сохранить</button></div>
      </form></dialog>
      <dialog id="moneyScheduleDialog" class="money-dialog"><div class="dialog-head"><div><small>КАЛЕНДАРЬ</small><h2>Добавить напоминания?</h2></div><button type="button" data-money-close="moneyScheduleDialog" aria-label="Закрыть">×</button></div><p id="moneyScheduleText" class="money-schedule-copy"></p><input id="moneyScheduleId" type="hidden"><div class="dialog-actions"><button type="button" data-money-close="moneyScheduleDialog">Отмена</button><button id="moneyScheduleConfirm" type="button" class="primary">Добавить</button></div></dialog>
    `;
    while (wrap.firstElementChild) document.body.appendChild(wrap.firstElementChild);
    document.querySelectorAll('[data-money-close]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.moneyClose)?.close()));
    ['moneyItemDialog', 'moneyProgressDialog', 'moneyIncomeDialog', 'moneyScheduleDialog'].forEach(id => {
      const dialog = document.getElementById(id);
      dialog?.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    });
  }

  function setType(type) {
    const selected = type === 'goal' ? 'goal' : 'debt';
    $('#moneyItemType').value = selected;
    document.querySelectorAll('[data-money-type]').forEach(button => button.classList.toggle('active', button.dataset.moneyType === selected));
    $('#moneyCurrentLabel').firstChild.textContent = selected === 'debt' ? 'Уже выплачено' : 'Уже накоплено';
    $('#moneyItemEyebrow').textContent = selected === 'debt' ? 'ДОЛГ' : 'НАКОПЛЕНИЕ';
    $('#moneyItemHint').textContent = selected === 'debt'
      ? 'SEVER покажет нужный темп. Расчёт долга — без процентов.'
      : 'SEVER посчитает темп накопления по сроку или вашему месячному плану.';
  }

  function openItem(type = 'debt', item = null, prefill = {}) {
    const dialog = $('#moneyItemDialog');
    const selected = item?.type || type;
    setType(selected);
    $('#moneyItemId').value = item?.id || '';
    $('#moneyItemTitle').textContent = item ? 'Изменить план' : selected === 'debt' ? 'Новый долг' : 'Новая цель';
    $('#moneyItemName').value = item?.title || prefill.title || (selected === 'debt' ? 'Долг' : 'Накопление');
    $('#moneyItemTarget').value = item?.targetAmount || prefill.targetAmount || '';
    $('#moneyItemCurrent').value = item?.currentAmount || 0;
    $('#moneyItemDeadline').value = item?.deadline || prefill.deadline || '';
    $('#moneyItemBudget').value = item?.monthlyBudget || prefill.monthlyBudget || '';
    $('#moneyItemDelete').classList.toggle('hidden', !item);
    dialog.showModal();
    requestAnimationFrame(() => $('#moneyItemName').focus());
  }

  function openProgress(item) {
    const plan = itemPlan(item);
    $('#moneyProgressId').value = item.id;
    $('#moneyProgressTitle').textContent = item.type === 'debt' ? 'Внести платёж' : 'Добавить накопление';
    $('#moneyProgressLabel').firstChild.textContent = item.type === 'debt' ? 'Сколько выплатили' : 'Сколько отложили';
    $('#moneyProgressAmount').value = '';
    $('#moneyProgressAmount').max = String(Math.max(1, Math.ceil(plan.remaining)));
    $('#moneyProgressMeta').textContent = `Осталось ${formatMoney(plan.remaining, moneyState().currency)}.`;
    $('#moneyProgressDialog').showModal();
    requestAnimationFrame(() => $('#moneyProgressAmount').focus());
  }

  function parseAmount(raw) {
    const text = String(raw || '').toLowerCase().replace(/,/g, '.');
    const match = text.match(/(\d[\d\s]*(?:\.\d+)?)\s*(млн|m|тыс\.?|к|k)?/i);
    if (!match) return 0;
    let value = Number(match[1].replace(/\s/g, '')) || 0;
    if (/млн|^m$/i.test(match[2] || '')) value *= 1000000;
    else if (/тыс|к|k/i.test(match[2] || '')) value *= 1000;
    return Math.round(value);
  }

  function parseDeadline(text) {
    const iso = String(text).match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
    if (iso) return iso;
    const months = ['январ', 'феврал', 'март', 'апрел', 'ма[йя]', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
    const lower = String(text).toLowerCase();
    const index = months.findIndex(name => new RegExp(name).test(lower));
    if (index < 0) return '';
    const current = new Date();
    let year = current.getFullYear();
    if (index < current.getMonth()) year += 1;
    const last = new Date(year, index + 1, 0).getDate();
    return `${year}-${String(index + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  }

  function parseQuick(value) {
    const text = value.trim();
    const lower = text.toLowerCase();
    const targetAmount = parseAmount(text);
    const deadline = parseDeadline(text);
    if (/доход|зарплат|\bзп\b/.test(lower) && targetAmount) return { kind: 'income', targetAmount };
    const type = /накоп|отлож|собрат|цель/.test(lower) ? 'goal' : /долг|долж|задолж/.test(lower) ? 'debt' : null;
    if (!type) return { kind: 'unknown', targetAmount, deadline };
    const title = type === 'debt' ? 'Долг' : 'Накопление';
    return { kind: type, targetAmount, deadline, title };
  }

  function renderEmpty(root) {
    const empty = document.createElement('article');
    empty.className = 'money-empty';
    empty.innerHTML = `${makeIcon('<path d="M4 7h16v10H4z"/><path d="M8 11h8M8 14h5"/>')}<b>Здесь пока пусто</b><p>Добавьте долг или цель накопления. SEVER покажет остаток и спокойный месячный темп.</p><button type="button">Добавить первый план</button>`;
    empty.querySelector('button').addEventListener('click', () => openItem('debt'));
    root.appendChild(empty);
  }

  function renderCard(item) {
    const data = moneyState();
    const plan = itemPlan(item);
    const card = document.createElement('article');
    card.className = `money-card money-${item.type}`;
    const percent = item.targetAmount ? Math.min(100, Math.round(item.currentAmount / item.targetAmount * 100)) : 0;
    const heading = document.createElement('div');
    heading.className = 'money-card-head';
    heading.innerHTML = `<div><small>${item.type === 'debt' ? 'ДОЛГ' : 'НАКОПЛЕНИЕ'}</small><h3></h3></div><span>${percent}%</span>`;
    heading.querySelector('h3').textContent = item.title;
    card.appendChild(heading);

    const amount = document.createElement('div');
    amount.className = 'money-card-amount';
    amount.innerHTML = `<b>${formatMoney(plan.remaining, data.currency)}</b><span>${item.type === 'debt' ? 'осталось выплатить' : 'осталось накопить'}</span>`;
    card.appendChild(amount);

    const track = document.createElement('div');
    track.className = 'money-track';
    track.innerHTML = `<i style="width:${percent}%"></i>`;
    card.appendChild(track);

    const meta = document.createElement('div');
    meta.className = 'money-card-meta';
    const bits = [];
    bits.push(`${formatMoney(item.currentAmount, data.currency)} из ${formatMoney(item.targetAmount, data.currency)}`);
    if (item.deadline) bits.push(`до ${formatDate(item.deadline)}`);
    meta.textContent = bits.join(' · ');
    card.appendChild(meta);

    if (plan.remaining > 0 && plan.overdue) {
      const pace = document.createElement('div');
      pace.className = 'money-pace money-pace-overdue';
      pace.innerHTML = '<small>СРОК ПРОШЁЛ</small><b>Обновите план</b><span>Измените срок или сумму в месяц — текущий прогресс сохранится.</span>';
      card.appendChild(pace);
    } else if (plan.remaining > 0 && (plan.monthly || item.deadline)) {
      const pace = document.createElement('div');
      pace.className = 'money-pace';
      const income = data.monthlyIncome;
      const share = income > 0 && plan.monthly > 0 ? Math.round(plan.monthly / income * 100) : null;
      const label = item.monthlyBudget ? 'Ваш план' : 'Чтобы успеть';
      pace.innerHTML = `<small>${label}</small><b>${formatMoney(plan.monthly, data.currency)} / мес</b><span></span>`;
      const details = [];
      if (share !== null) details.push(`≈ ${share}% месячного дохода`);
      if (plan.estimatedMonths) details.push(`≈ ${plan.estimatedMonths} мес.`);
      pace.querySelector('span').textContent = details.join(' · ');
      card.appendChild(pace);
    }

    const actions = document.createElement('div');
    actions.className = 'money-card-actions';
    const progress = document.createElement('button');
    progress.type = 'button'; progress.className = 'money-primary';
    progress.textContent = item.type === 'debt' ? 'Внести платёж' : 'Добавить сумму';
    progress.disabled = plan.remaining <= 0;
    progress.addEventListener('click', () => openProgress(item));
    const schedule = document.createElement('button');
    schedule.type = 'button'; schedule.textContent = 'В календарь';
    const activeIds = new Set((appState()?.tasks || []).map(task => task.id));
    const hasSchedule = item.calendarTaskIds.some(id => activeIds.has(id));
    schedule.disabled = plan.remaining <= 0 || hasSchedule || plan.monthly <= 0 || plan.overdue;
    if (hasSchedule) schedule.textContent = 'Уже в календаре';
    if (plan.overdue && !hasSchedule) schedule.title = 'Обновите срок плана перед добавлением напоминаний';
    schedule.addEventListener('click', () => previewSchedule(item));
    const edit = document.createElement('button');
    edit.type = 'button'; edit.className = 'money-icon-action'; edit.setAttribute('aria-label', 'Изменить');
    edit.innerHTML = makeIcon('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>');
    edit.addEventListener('click', () => openItem(item.type, item));
    actions.append(progress, schedule, edit);
    card.appendChild(actions);
    return card;
  }

  function render() {
    if (!$('#moneyView')) return;
    const data = moneyState();
    const debtItems = data.items.filter(item => item.type === 'debt');
    const goalItems = data.items.filter(item => item.type === 'goal');
    const debtRemaining = debtItems.reduce((sum, item) => sum + itemPlan(item).remaining, 0);
    const saved = goalItems.reduce((sum, item) => sum + item.currentAmount, 0);
    $('#moneyDebtTotal').textContent = formatMoney(debtRemaining, data.currency);
    $('#moneyDebtMeta').textContent = debtItems.length ? `${debtItems.length} ${debtItems.length === 1 ? 'план' : 'плана'}` : 'Долгов нет';
    $('#moneyGoalTotal').textContent = formatMoney(saved, data.currency);
    $('#moneyGoalMeta').textContent = goalItems.length ? `${goalItems.length} ${goalItems.length === 1 ? 'цель' : 'цели'}` : 'Целей нет';
    $('#moneyIncomeTotal').textContent = data.monthlyIncome ? formatMoney(data.monthlyIncome, data.currency) : 'Не указан';
    const root = $('#moneyList');
    root.replaceChildren();
    if (!data.items.length) renderEmpty(root);
    else data.items.slice().sort((a, b) => b.updatedAt - a.updatedAt).forEach(item => root.appendChild(renderCard(item)));
  }

  function scheduleFor(item) {
    const plan = itemPlan(item);
    if (plan.remaining <= 0 || plan.monthly <= 0 || plan.overdue) return [];
    const limit = Math.min(90, plan.estimatedMonths || plan.months || 1);
    let left = plan.remaining;
    const rows = [];
    for (let i = 0; i < limit && left > 0; i++) {
      const amount = Math.min(left, plan.monthly);
      rows.push({ date: monthDate(item.deadline || currentISO(), i), amount });
      left -= amount;
    }
    return rows;
  }

  function previewSchedule(item) {
    const rows = scheduleFor(item);
    if (!rows.length) return;
    $('#moneyScheduleId').value = item.id;
    $('#moneyScheduleText').textContent = `SEVER добавит ${rows.length} ${rows.length === 1 ? 'напоминание' : 'напоминаний'} в календарь. Это только план: фактический платёж отмечается здесь отдельно.`;
    $('#moneyScheduleDialog').showModal();
  }

  async function confirmSchedule() {
    const data = moneyState();
    const item = data.items.find(row => row.id === $('#moneyScheduleId').value);
    const state = appState();
    if (!item || !state) return $('#moneyScheduleDialog').close();
    const rows = scheduleFor(item), created = [];
    for (const row of rows) {
      const id = moneyId(); created.push(id);
      state.tasks.push({ id, title: `${item.title} · ${formatMoney(row.amount, data.currency)}`, date: row.date, time: '', duration: null, category: 'Личное', priority: false, challenge: false, completed: false, createdAt: now(), updatedAt: now() });
    }
    item.calendarTaskIds = created;
    item.updatedAt = now();
    await persist();
    window.SeverApp.render?.();
    $('#moneyScheduleDialog').close();
    render();
  }

  async function saveItem(event) {
    event.preventDefault();
    const data = moneyState();
    const id = $('#moneyItemId').value;
    const existing = data.items.find(item => item.id === id);
    const type = $('#moneyItemType').value === 'goal' ? 'goal' : 'debt';
    const targetAmount = clamp($('#moneyItemTarget').value);
    if (targetAmount <= 0) return;
    const next = normalizeItem({
      ...(existing || {}), id: existing?.id || moneyId(), type,
      title: $('#moneyItemName').value.trim() || (type === 'debt' ? 'Долг' : 'Накопление'),
      targetAmount,
      currentAmount: Math.min(targetAmount, clamp($('#moneyItemCurrent').value)),
      deadline: $('#moneyItemDeadline').value,
      monthlyBudget: clamp($('#moneyItemBudget').value),
      createdAt: existing?.createdAt || now(), updatedAt: now()
    });
    if (existing) data.items[data.items.indexOf(existing)] = next; else data.items.unshift(next);
    await persist();
    $('#moneyItemDialog').close();
    render();
  }

  async function deleteItem() {
    const data = moneyState();
    const id = $('#moneyItemId').value;
    const item = data.items.find(row => row.id === id);
    if (!item) return;
    const button = $('#moneyItemDelete');
    if (button.dataset.confirm !== 'true') {
      button.dataset.confirm = 'true'; button.textContent = 'Нажми ещё раз';
      setTimeout(() => { if (button.dataset.confirm === 'true') { delete button.dataset.confirm; button.textContent = 'Удалить'; } }, 2500);
      return;
    }
    data.items = data.items.filter(row => row.id !== id);
    delete button.dataset.confirm; button.textContent = 'Удалить';
    await persist();
    $('#moneyItemDialog').close();
    render();
  }

  async function addProgress(event) {
    event.preventDefault();
    const data = moneyState();
    const item = data.items.find(row => row.id === $('#moneyProgressId').value);
    const amount = clamp($('#moneyProgressAmount').value);
    if (!item || amount <= 0) return;
    item.currentAmount = Math.min(item.targetAmount, item.currentAmount + amount);
    item.updatedAt = now();
    await persist();
    $('#moneyProgressDialog').close();
    render();
  }

  async function saveIncome(event) {
    event.preventDefault();
    const data = moneyState();
    data.monthlyIncome = clamp($('#moneyIncomeInput').value);
    await persist();
    $('#moneyIncomeDialog').close();
    render();
  }

  async function quickSubmit(event) {
    event.preventDefault();
    const input = $('#moneyQuickInput');
    const parsed = parseQuick(input.value);
    if (parsed.kind === 'income') {
      const data = moneyState(); data.monthlyIncome = parsed.targetAmount;
      await persist(); input.value = ''; render(); return;
    }
    if (parsed.kind === 'debt' || parsed.kind === 'goal') {
      openItem(parsed.kind, null, parsed); input.value = ''; return;
    }
    openItem('debt', null, { targetAmount: parsed.targetAmount || '', deadline: parsed.deadline || '' });
  }

  function bind() {
    $('#moneyNew')?.addEventListener('click', () => openItem('debt'));
    document.querySelectorAll('[data-money-create]').forEach(button => button.addEventListener('click', () => openItem(button.dataset.moneyCreate)));
    document.querySelectorAll('[data-money-type]').forEach(button => button.addEventListener('click', () => setType(button.dataset.moneyType)));
    $('#moneyQuickForm')?.addEventListener('submit', quickSubmit);
    $('#moneyItemForm')?.addEventListener('submit', saveItem);
    $('#moneyItemDelete')?.addEventListener('click', deleteItem);
    $('#moneyProgressForm')?.addEventListener('submit', addProgress);
    $('#moneyIncomeEdit')?.addEventListener('click', () => { $('#moneyIncomeInput').value = moneyState().monthlyIncome || ''; $('#moneyIncomeDialog').showModal(); });
    $('#moneyIncomeForm')?.addEventListener('submit', saveIncome);
    $('#moneyScheduleConfirm')?.addEventListener('click', confirmSchedule);
    window.addEventListener('sever:account-scope', () => requestAnimationFrame(render));
    window.addEventListener('sever:cloud-status', () => { if ($('#moneyView')?.classList.contains('active')) render(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && $('#moneyView')?.classList.contains('active')) render(); });
    const view = $('#moneyView');
    if (view) {
      new MutationObserver(() => {
        if (view.classList.contains('active')) requestAnimationFrame(render);
      }).observe(view, { attributes: true, attributeFilter: ['class'] });
    }
  }

  function setup() {
    if (document.documentElement.dataset.severMoney === 'ready') return;
    if (!window.SeverApp) { setTimeout(setup, 25); return; }
    createView(); createNavigation(); createDialogs(); bind(); render();
    document.documentElement.dataset.severMoney = 'ready';
  }

  window.SeverMoney = { render, open: openMoney, parseQuick };
  window.addEventListener('sever:ready', setup, { once: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup, { once: true }); else setup();
})();
