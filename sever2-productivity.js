(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const svg = {
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 10h18"/></svg>',
    ai: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2Z"/></svg>',
    inbox: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-2 13H6L4 5Z"/><path d="M7 13h3l1 2h2l1-2h3"/></svg>',
    focus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/><circle cx="12" cy="12" r="3"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>'
  };

  const dayISO = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const dateOf = value => new Date(`${value}T12:00:00`);
  const addDays = (value, days) => { const date = dateOf(value); date.setDate(date.getDate()+days); return dayISO(date); };
  const prettyDate = value => dateOf(value).toLocaleDateString('ru-RU', { weekday:'long', day:'numeric', month:'long' });
  const today = () => dayISO();
  const state = () => window.SeverApp?.getState?.() || { tasks: [], focusSessions: [] };
  let timelineDate = today();
  let calendarMode = 'month';
  let calendarModeSetter = null;
  let bootTimer = 0;
  let bootAttempts = 0;
  let quickInboxSelected = false;

  function taskFor(id) {
    return state().tasks.find(task => task.id === id) || null;
  }

  function pendingInbox() {
    return state().tasks.filter(task => !task.challenge && !task.completed && !task.date);
  }

  function scheduleLabel(task) {
    const bits = [];
    if (task.time) bits.push(task.time);
    if (task.duration) bits.push(`${task.duration} мин`);
    if (!bits.length) bits.push('Без времени');
    return bits.join(' · ');
  }

  function updateTaskMemory(title) {
    const store = state();
    if (!Array.isArray(store.taskMemory)) return;
    const clean = String(title || '').trim();
    if (clean.length < 2) return;
    const key = clean.toLocaleLowerCase('ru-RU');
    const old = store.taskMemory.find(item => item.key === key);
    store.taskMemory = store.taskMemory.filter(item => item.key !== key);
    store.taskMemory.unshift({ key, title: old?.title || clean, uses: (old?.uses || 0) + 1, lastUsed: Date.now() });
    store.taskMemory = store.taskMemory.slice(0, 15);
  }

  function showToast(message) {
    const root = $('#toast');
    if (!root) return;
    root.replaceChildren();
    const label = document.createElement('span');
    label.textContent = message;
    root.appendChild(label);
    root.classList.add('show');
    setTimeout(() => root.classList.remove('show'), 1800);
  }

  function openTaskEditor(task, nextDate = null) {
    if (!task) return;
    const actionDialog = $('#taskActionDialog');
    if (actionDialog?.open) actionDialog.close();
    const id = $('#taskId');
    const title = $('#taskTitle');
    const date = $('#taskDate');
    const time = $('#taskTime');
    const duration = $('#taskDuration');
    const category = $('#taskCategory');
    const priority = $('#taskPriority');
    if (!id || !title || !date) return;
    window.SeverUiState?.begin?.('taskDialog', { domain:'tasks', entityId:task.id });
    id.value = task.id;
    title.value = task.title || '';
    date.value = nextDate !== null ? nextDate : (task.date || '');
    if (time) time.value = task.time || '';
    if (duration) duration.value = task.duration || '';
    if (category) category.value = task.category || 'Личное';
    if (priority) priority.checked = Boolean(task.priority);
    $('#taskDialogTitle').textContent = 'Изменить задачу';
    $('#deleteTask')?.classList.remove('hidden');
    $('#taskDialog')?.showModal();
  }

  function saveTaskDate(task, date) {
    openTaskEditor(task, date);
    requestAnimationFrame(() => $('#taskForm')?.requestSubmit());
  }

  function openBlankTaskEditor() {
    const opener = $('#globalAddBtn') || $('#mobileCreateBtn');
    if (!opener || !$('#quickAddTask')) return;
    opener.click();
    requestAnimationFrame(() => {
      $('#quickAddTask')?.click();
      requestAnimationFrame(() => {
        const date = $('#taskDate');
        if (date) date.value = '';
        $('#taskTitle')?.focus();
      });
    });
  }

  function installUnscheduledTaskSupport() {
    const date = $('#taskDate');
    if (date) date.required = false;

    const dateLabel = date?.closest('label');
    if (dateLabel && !dateLabel.querySelector('.sever2-no-date')) {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'sever2-no-date';
      clear.textContent = 'Без даты';
      clear.addEventListener('click', () => { date.value = ''; });
      dateLabel.appendChild(clear);
    }

    const chips = $('#quickCaptureForm .quick-date-chips');
    if (chips && !chips.querySelector('[data-sever2-inbox-date]')) {
      const inbox = document.createElement('button');
      inbox.type = 'button';
      inbox.dataset.sever2InboxDate = 'true';
      inbox.textContent = 'Без даты';
      chips.insertBefore(inbox, $('#quickCaptureChooseDate'));
      inbox.addEventListener('click', () => {
        quickInboxSelected = true;
        const input = $('#quickCaptureDate');
        if (input) input.value = '';
        chips.querySelectorAll('button').forEach(button => button.classList.toggle('active', button === inbox));
      });
      chips.querySelectorAll('[data-quick-date]').forEach(button => button.addEventListener('click', () => { quickInboxSelected = false; }));
      $('#quickCaptureChooseDate')?.addEventListener('click', () => { quickInboxSelected = false; });
      $('#quickCaptureDate')?.addEventListener('change', () => { if ($('#quickCaptureDate').value) quickInboxSelected = false; });
    }

    const form = $('#quickCaptureForm');
    if (form && !form.dataset.sever2InboxCapture) {
      form.dataset.sever2InboxCapture = 'true';
      form.addEventListener('submit', event => {
        if (!quickInboxSelected) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const input = $('#quickCaptureInput');
        const title = input?.value.trim();
        if (!title) return;
        const now = Date.now();
        const task = {
          id: crypto.randomUUID?.() || `${now}-${Math.random().toString(36).slice(2)}`,
          title,
          date: '',
          time: '',
          duration: null,
          category: 'Личное',
          priority: false,
          challenge: false,
          completed: false,
          createdAt: now,
          updatedAt: now
        };
        state().tasks.push(task);
        updateTaskMemory(title);
        window.SeverApp?.persist?.();
        window.SeverApp?.render?.();
        $('#quickAddDialog')?.close();
        quickInboxSelected = false;
        showToast('Добавлено во Входящие');
        updateHomeInbox();
        if (calendarMode === 'inbox') renderInboxPanel();
      }, true);
    }
  }

  function installTaskActions() {
    const dialog = $('#taskActionDialog');
    if (!dialog || dialog.querySelector('.sever2-reschedule')) return;
    const grid = dialog.querySelector('.task-action-grid');
    if (!grid) return;

    const block = document.createElement('section');
    block.className = 'sever2-reschedule';
    block.innerHTML = `
      <small>БЫСТРО ПЕРЕНЕСТИ</small>
      <div class="sever2-reschedule-row">
        <button type="button" data-move="today">Сегодня</button>
        <button type="button" data-move="tomorrow">Завтра</button>
        <label class="sever2-date-picker">${svg.calendar}<span>Дата</span><input type="date" aria-label="Выбрать дату переноса"></label>
        <button type="button" data-move="inbox">Без даты</button>
      </div>
      <button class="sever2-ask-ai" type="button">${svg.ai}<span>Спросить Sever об этой задаче</span></button>`;
    grid.before(block);

    block.querySelector('[data-move="today"]').addEventListener('click', () => {
      const id = window.SeverApp?.getContext?.().selectedTaskId;
      const task = taskFor(id);
      if (task) saveTaskDate(task, today());
    });
    block.querySelector('[data-move="tomorrow"]').addEventListener('click', () => {
      const id = window.SeverApp?.getContext?.().selectedTaskId;
      const task = taskFor(id);
      if (task) saveTaskDate(task, addDays(today(), 1));
    });
    block.querySelector('[data-move="inbox"]').addEventListener('click', () => {
      const id = window.SeverApp?.getContext?.().selectedTaskId;
      const task = taskFor(id);
      if (task) saveTaskDate(task, '');
    });
    block.querySelector('input[type="date"]').addEventListener('change', event => {
      const id = window.SeverApp?.getContext?.().selectedTaskId;
      const task = taskFor(id);
      if (task && event.target.value) saveTaskDate(task, event.target.value);
      event.target.value = '';
    });
    block.querySelector('.sever2-ask-ai').addEventListener('click', () => window.SeverAI?.open?.());
  }

  function installCalendarMode() {
    const view = $('#calendarView');
    const heading = view?.querySelector('.heading');
    const calendar = $('#calendar');
    if (!view || !heading || !calendar || view.querySelector('.sever2-calendar-modes')) return;

    const controls = document.createElement('div');
    controls.className = 'sever2-calendar-modes';
    controls.innerHTML = '<button type="button" class="active" data-mode="month">Месяц</button><button type="button" data-mode="day">День</button><button type="button" data-mode="inbox">Входящие</button>';
    heading.appendChild(controls);

    const panel = document.createElement('section');
    panel.className = 'sever2-day-panel hidden';
    panel.innerHTML = `
      <div class="sever2-day-head">
        <div><small>ПЛАН ДНЯ</small><h2 id="sever2DayTitle"></h2><p id="sever2DaySummary"></p></div>
        <div class="sever2-day-nav">
          <button type="button" data-day-step="-1" aria-label="Предыдущий день">${svg.chevron}</button>
          <button type="button" data-day-today>Сегодня</button>
          <button type="button" data-day-step="1" aria-label="Следующий день">${svg.chevron}</button>
        </div>
      </div>
      <div id="sever2Timeline" class="sever2-timeline"></div>`;
    view.appendChild(panel);

    const inboxPanel = document.createElement('section');
    inboxPanel.id = 'sever2InboxPanel';
    inboxPanel.className = 'sever2-inbox-panel hidden';
    view.appendChild(inboxPanel);

    function setMode(mode) {
      calendarMode = ['month','day','inbox'].includes(mode) ? mode : 'month';
      controls.querySelectorAll('button').forEach(button => button.classList.toggle('active', button.dataset.mode === calendarMode));
      const planning = calendarMode !== 'month';
      view.querySelector('.week')?.classList.toggle('hidden', planning);
      calendar.classList.toggle('hidden', planning);
      panel.classList.toggle('hidden', calendarMode !== 'day');
      inboxPanel.classList.toggle('hidden', calendarMode !== 'inbox');
      if (calendarMode === 'day') renderTimeline();
      if (calendarMode === 'inbox') renderInboxPanel();
    }
    calendarModeSetter = setMode;

    controls.addEventListener('click', event => {
      const button = event.target.closest('[data-mode]');
      if (button) setMode(button.dataset.mode);
    });
    panel.querySelectorAll('[data-day-step]').forEach(button => button.addEventListener('click', () => {
      timelineDate = addDays(timelineDate, Number(button.dataset.dayStep));
      renderTimeline();
    }));
    panel.querySelector('[data-day-today]').addEventListener('click', () => { timelineDate = today(); renderTimeline(); });
    calendar.addEventListener('click', () => {
      setTimeout(() => {
        const selected = window.SeverApp?.getContext?.().selectedDate;
        if (selected) timelineDate = selected;
      }, 0);
    });
  }

  function renderTimeline() {
    const root = $('#sever2Timeline');
    if (!root) return;
    const all = state().tasks.filter(task => task.date === timelineDate && !task.challenge);
    const pending = all.filter(task => !task.completed);
    const done = all.filter(task => task.completed);
    const totalMinutes = pending.reduce((sum, task) => sum + (Number(task.duration) || 0), 0);
    $('#sever2DayTitle').textContent = prettyDate(timelineDate);
    $('#sever2DaySummary').textContent = all.length
      ? `${pending.length} осталось · ${done.length} готово${totalMinutes ? ` · ${totalMinutes} мин запланировано` : ''}`
      : 'Свободный день';
    root.replaceChildren();

    if (!all.length) {
      const empty = document.createElement('div');
      empty.className = 'sever2-timeline-empty';
      empty.innerHTML = `${svg.calendar}<b>На этот день задач нет</b><span>Можно оставить день свободным или добавить дело.</span>`;
      root.appendChild(empty);
      return;
    }

    const sorted = [...all].sort((a,b) => {
      if (a.completed !== b.completed) return Number(a.completed)-Number(b.completed);
      if (a.time && b.time) return a.time.localeCompare(b.time);
      if (a.time) return -1;
      if (b.time) return 1;
      return Number(b.priority)-Number(a.priority);
    });

    sorted.forEach(task => {
      const row = document.createElement('article');
      row.className = `sever2-timeline-task${task.completed ? ' done' : ''}`;
      row.dataset.taskId = task.id;
      row.innerHTML = `
        <div class="sever2-time-marker"><b>${task.time || '—'}</b><span>${task.duration ? `${task.duration}м` : ''}</span></div>
        <div class="sever2-timeline-copy"><b></b><span>${scheduleLabel(task)} · ${task.category || 'Личное'}</span></div>
        <div class="sever2-timeline-actions">
          ${task.completed ? '' : `<button type="button" data-focus aria-label="Начать фокус">${svg.play}</button>`}
          <button type="button" data-edit aria-label="Изменить задачу">${svg.chevron}</button>
        </div>`;
      row.querySelector('.sever2-timeline-copy b').textContent = task.title;
      row.querySelector('[data-focus]')?.addEventListener('click', () => window.SeverApp?.startTimer?.({ taskId: task.id, durationMinutes: Number(task.duration) || 25 }));
      row.querySelector('[data-edit]').addEventListener('click', () => openTaskEditor(task));
      root.appendChild(row);
    });
  }

  function inboxTaskRow(task, compact = false) {
    const row = document.createElement('article');
    row.className = compact ? 'sever2-inbox-task compact' : 'sever2-inbox-task';
    row.dataset.taskId = task.id;
    row.innerHTML = `
      <div class="sever2-inbox-copy"><b></b><span>${task.duration ? `${task.duration} мин · ` : ''}${task.category || 'Личное'}</span></div>
      <div class="sever2-inbox-actions">
        <button type="button" data-plan-today>Сегодня</button>
        ${compact ? '' : '<button type="button" data-plan-tomorrow>Завтра</button>'}
        <button type="button" data-inbox-focus aria-label="Начать фокус">${svg.play}</button>
        ${compact ? '' : `<button type="button" data-inbox-edit aria-label="Изменить">${svg.chevron}</button>`}
      </div>`;
    row.querySelector('.sever2-inbox-copy b').textContent = task.title;
    row.querySelector('[data-plan-today]').addEventListener('click', () => saveTaskDate(task, today()));
    row.querySelector('[data-plan-tomorrow]')?.addEventListener('click', () => saveTaskDate(task, addDays(today(), 1)));
    row.querySelector('[data-inbox-focus]').addEventListener('click', () => window.SeverApp?.startTimer?.({ taskId: task.id, durationMinutes: Number(task.duration) || 25 }));
    row.querySelector('[data-inbox-edit]')?.addEventListener('click', () => openTaskEditor(task));
    return row;
  }

  function renderInboxPanel() {
    const root = $('#sever2InboxPanel');
    if (!root) return;
    const tasks = pendingInbox();
    root.replaceChildren();

    const head = document.createElement('header');
    head.className = 'sever2-inbox-head';
    head.innerHTML = `<div>${svg.inbox}<span><small>БЕЗ ДАТЫ</small><h2>Входящие</h2><p>${tasks.length ? `${tasks.length} ${tasks.length === 1 ? 'дело ждёт решения' : 'дел ждут решения'}` : 'Здесь удобно хранить дела, для которых дата ещё не выбрана.'}</p></span></div><button type="button" class="sever2-inbox-add">Добавить</button>`;
    head.querySelector('.sever2-inbox-add').addEventListener('click', openBlankTaskEditor);
    root.appendChild(head);

    if (!tasks.length) {
      const empty = document.createElement('div');
      empty.className = 'sever2-inbox-empty';
      empty.innerHTML = `${svg.inbox}<b>Входящие пусты</b><span>Все дела уже запланированы или выполнены.</span>`;
      root.appendChild(empty);
      return;
    }

    const list = document.createElement('div');
    list.className = 'sever2-inbox-list';
    tasks.forEach(task => list.appendChild(inboxTaskRow(task)));
    root.appendChild(list);
  }

  function installHomePlanCard() {
    const todayTasks = $('#todayTasks');
    if (!todayTasks || $('#sever2TodayPlan')) return;
    const card = document.createElement('section');
    card.id = 'sever2TodayPlan';
    card.className = 'sever2-today-plan';
    todayTasks.after(card);
    updateHomePlanCard();

    const inbox = document.createElement('section');
    inbox.id = 'sever2HomeInbox';
    inbox.className = 'sever2-home-inbox hidden';
    card.after(inbox);
    updateHomeInbox();
  }

  function updateHomePlanCard() {
    const card = $('#sever2TodayPlan');
    if (!card) return;
    const items = state().tasks.filter(task => task.date === today() && !task.challenge);
    const pending = items.filter(task => !task.completed);
    const next = [...pending].sort((a,b) => Number(b.priority)-Number(a.priority) || (a.time || '99:99').localeCompare(b.time || '99:99'))[0];
    const minutes = pending.reduce((sum, task) => sum + (Number(task.duration) || 0), 0);
    card.innerHTML = `
      <div class="sever2-plan-copy">${svg.clock}<span><small>ПЛАН НА СЕГОДНЯ</small><b>${pending.length ? `${pending.length} ${pending.length === 1 ? 'дело' : 'дел'}` : 'Всё готово'}</b><em>${minutes ? `${minutes} мин запланировано` : pending.length ? 'Можно начать с первого дела' : 'Можно спокойно завершать день'}</em></span></div>
      ${next ? `<button type="button" class="sever2-plan-start">${svg.play}<span>Начать</span></button>` : ''}`;
    card.querySelector('.sever2-plan-start')?.addEventListener('click', () => window.SeverApp?.startTimer?.({ taskId: next.id, durationMinutes: Number(next.duration) || 25 }));
  }

  function updateHomeInbox() {
    const card = $('#sever2HomeInbox');
    if (!card) return;
    const tasks = pendingInbox();
    card.classList.toggle('hidden', !tasks.length);
    if (!tasks.length) { card.replaceChildren(); return; }
    card.replaceChildren();

    const head = document.createElement('div');
    head.className = 'sever2-home-inbox-head';
    head.innerHTML = `<div>${svg.inbox}<span><small>ВХОДЯЩИЕ</small><b>${tasks.length} ${tasks.length === 1 ? 'дело без даты' : 'дел без даты'}</b></span></div><button type="button">Разобрать</button>`;
    head.querySelector('button').addEventListener('click', () => {
      window.SeverApp?.switchView?.('calendar');
      requestAnimationFrame(() => calendarModeSetter?.('inbox'));
    });
    card.appendChild(head);

    const list = document.createElement('div');
    list.className = 'sever2-home-inbox-list';
    tasks.slice(0, 3).forEach(task => list.appendChild(inboxTaskRow(task, true)));
    card.appendChild(list);
  }

  function completedFocusToday() {
    const target = today();
    return (state().focusSessions || []).filter(session => {
      if (session.status !== 'completed') return false;
      const timestamp = Number(session.completedAt || session.startedAt || 0);
      return timestamp > 0 && dayISO(new Date(timestamp)) === target;
    });
  }

  function updateFocusSummary() {
    const root = $('#sever2FocusToday');
    if (!root) return;
    const sessions = completedFocusToday();
    const minutes = sessions.reduce((sum, session) => sum + (Number(session.durationMinutes) || 0), 0);
    root.textContent = sessions.length ? `${minutes} мин · ${sessions.length} ${sessions.length === 1 ? 'сессия' : 'сессии'}` : 'Сегодня фокус-сессий ещё не было';
  }

  function setFocusMode(enabled) {
    document.body.classList.toggle('sever2-focus-immersive', Boolean(enabled));
    const button = $('#sever2FocusModeToggle');
    if (button) {
      button.classList.toggle('active', Boolean(enabled));
      button.setAttribute('aria-pressed', String(Boolean(enabled)));
      const label = button.querySelector('span');
      if (label) label.textContent = enabled ? 'Выйти из фокуса' : 'Режим фокуса';
    }
  }

  function installFocusMode() {
    const view = $('#timerView');
    const card = view?.querySelector('.focus-card');
    if (!view || !card || $('#sever2FocusTools')) return;

    const tools = document.createElement('div');
    tools.id = 'sever2FocusTools';
    tools.className = 'sever2-focus-tools';
    tools.innerHTML = `<div>${svg.focus}<span><small>ФОКУС СЕГОДНЯ</small><b id="sever2FocusToday">—</b></span></div><button id="sever2FocusModeToggle" type="button" aria-pressed="false">${svg.focus}<span>Режим фокуса</span></button>`;
    card.before(tools);
    $('#sever2FocusModeToggle').addEventListener('click', () => setFocusMode(!document.body.classList.contains('sever2-focus-immersive')));
    updateFocusSummary();

    const observer = new MutationObserver(() => {
      if (!view.classList.contains('active')) setFocusMode(false);
      updateFocusSummary();
    });
    observer.observe(view, { attributes:true, attributeFilter:['class'] });
    observer.observe($('#activeTimerTask') || view, { childList:true, subtree:true, characterData:true, attributes:true });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && document.body.classList.contains('sever2-focus-immersive') && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        setFocusMode(false);
      }
    });
  }

  function observePlanner() {
    const targets = [$('#todayTasks'), $('#calendar'), $('#todayDashboard'), $('#activeTimerTask')].filter(Boolean);
    if (!targets.length) return;
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        updateHomePlanCard();
        updateHomeInbox();
        updateFocusSummary();
        if (calendarMode === 'day') renderTimeline();
        if (calendarMode === 'inbox') renderInboxPanel();
      });
    });
    targets.forEach(target => observer.observe(target, { childList:true, subtree:true, characterData:true }));
  }

  function boot() {
    if (document.documentElement.dataset.severProductivity === 'ready') return true;
    if (!window.SeverApp?.getState || !$('#todayTasks') || !$('#calendar') || !$('#taskActionDialog')) return false;
    document.documentElement.dataset.severProductivity = 'ready';
    installUnscheduledTaskSupport();
    installTaskActions();
    installCalendarMode();
    installHomePlanCard();
    installFocusMode();
    observePlanner();
    return true;
  }

  function scheduleBoot() {
    if (boot()) {
      clearTimeout(bootTimer);
      return;
    }
    if (bootAttempts++ >= 120) return;
    clearTimeout(bootTimer);
    bootTimer = setTimeout(scheduleBoot, 50);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleBoot, { once:true });
  } else {
    scheduleBoot();
  }
  window.addEventListener('load', scheduleBoot, { once:true });
  window.addEventListener('sever:ready', scheduleBoot);
})();
