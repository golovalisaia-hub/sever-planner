(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const svg = {
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 10h18"/></svg>',
    ai: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2Z"/></svg>'
  };

  const dayISO = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const dateOf = value => new Date(`${value}T12:00:00`);
  const addDays = (value, days) => { const date = dateOf(value); date.setDate(date.getDate()+days); return dayISO(date); };
  const prettyDate = value => dateOf(value).toLocaleDateString('ru-RU', { weekday:'long', day:'numeric', month:'long' });
  const today = () => dayISO();
  const state = () => window.SeverApp?.getState?.() || { tasks: [] };
  let timelineDate = today();
  let timelineMode = false;
  let bootTimer = 0;
  let bootAttempts = 0;

  function taskFor(id) {
    return state().tasks.find(task => task.id === id) || null;
  }

  function scheduleLabel(task) {
    const bits = [];
    if (task.time) bits.push(task.time);
    if (task.duration) bits.push(`${task.duration} мин`);
    if (!bits.length) bits.push('Без времени');
    return bits.join(' · ');
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
    id.value = task.id;
    title.value = task.title || '';
    date.value = nextDate || task.date || today();
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
    controls.innerHTML = '<button type="button" class="active" data-mode="month">Месяц</button><button type="button" data-mode="day">День</button>';
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

    function setMode(mode) {
      timelineMode = mode === 'day';
      controls.querySelectorAll('button').forEach(button => button.classList.toggle('active', button.dataset.mode === mode));
      view.querySelector('.week')?.classList.toggle('hidden', timelineMode);
      calendar.classList.toggle('hidden', timelineMode);
      panel.classList.toggle('hidden', !timelineMode);
      if (timelineMode) renderTimeline();
    }

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

  function installHomePlanCard() {
    const todayTasks = $('#todayTasks');
    if (!todayTasks || $('#sever2TodayPlan')) return;
    const card = document.createElement('section');
    card.id = 'sever2TodayPlan';
    card.className = 'sever2-today-plan';
    todayTasks.after(card);
    updateHomePlanCard();
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

  function observePlanner() {
    const targets = [$('#todayTasks'), $('#calendar'), $('#todayDashboard')].filter(Boolean);
    if (!targets.length) return;
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        updateHomePlanCard();
        if (timelineMode) renderTimeline();
      });
    });
    targets.forEach(target => observer.observe(target, { childList:true, subtree:true, characterData:true }));
  }

  function boot() {
    if (document.documentElement.dataset.severProductivity === 'ready') return true;
    if (!window.SeverApp?.getState || !$('#todayTasks') || !$('#calendar') || !$('#taskActionDialog')) return false;
    document.documentElement.dataset.severProductivity = 'ready';
    installTaskActions();
    installCalendarMode();
    installHomePlanCard();
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
