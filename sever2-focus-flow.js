(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const INBOX_DATE = '9999-12-31';
  const svg = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    focus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/><circle cx="12" cy="12" r="3"/></svg>',
    inbox: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-2 13H6L4 5Z"/><path d="M7 13h3l1 2h2l1-2h3"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>'
  };

  const dayISO = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const today = () => dayISO();
  const plannerState = () => window.SeverApp?.getState?.() || { tasks: [], focusSessions: [] };
  const context = () => window.SeverApp?.getContext?.() || {};
  let bootAttempts = 0;
  let bootTimer = 0;
  let renderQueued = false;
  let titleTimer = 0;

  function pendingToday() {
    return plannerState().tasks
      .filter(task => !task.challenge && !task.completed && task.date === today())
      .sort((a, b) => {
        const priority = Number(Boolean(b.priority)) - Number(Boolean(a.priority));
        if (priority) return priority;
        const aTime = a.time || '99:99';
        const bTime = b.time || '99:99';
        const byTime = aTime.localeCompare(bTime);
        if (byTime) return byTime;
        return Number(a.createdAt || 0) - Number(b.createdAt || 0);
      });
  }

  function pendingInboxCount() {
    return plannerState().tasks.filter(task => !task.challenge && !task.completed && (!task.date || task.date === INBOX_DATE)).length;
  }

  function focusMinutesForTask(taskId) {
    return (plannerState().focusSessions || [])
      .filter(session => session.status === 'completed' && session.taskId === taskId)
      .reduce((sum, session) => sum + (Number(session.durationMinutes) || 0), 0);
  }

  function focusMinutesToday() {
    const target = today();
    return (plannerState().focusSessions || [])
      .filter(session => {
        if (session.status !== 'completed') return false;
        const stamp = Number(session.completedAt || session.startedAt || 0);
        return stamp > 0 && dayISO(new Date(stamp)) === target;
      })
      .reduce((sum, session) => sum + (Number(session.durationMinutes) || 0), 0);
  }

  function currentTaskId() {
    const current = context();
    if (current.activeTimerId) return current.activeTimerId;
    if (current.currentPage === 'timer' && current.selectedTaskId) return current.selectedTaskId;
    return '';
  }

  function timerRunning() {
    return /^Работает/.test(window.SeverApp?.getTimerStatus?.() || '');
  }

  function startTask(task) {
    if (!task) return;
    const currentId = currentTaskId();
    if (currentId && currentId !== task.id) return;
    window.SeverApp?.startTimer?.({ taskId: task.id, durationMinutes: Number(task.duration) || 25 });
    requestRender();
  }

  function renderQueue() {
    const root = $('#sever2FocusQueue');
    if (!root) return;

    const tasks = pendingToday();
    const activeId = currentTaskId();
    const running = timerRunning();
    const displayTasks = activeId
      ? [...tasks].sort((a, b) => Number(b.id === activeId) - Number(a.id === activeId))
      : tasks;
    const plannedMinutes = tasks.reduce((sum, task) => sum + (Number(task.duration) || 0), 0);
    const focusedMinutes = focusMinutesToday();
    const inboxCount = pendingInboxCount();

    root.replaceChildren();
    const head = document.createElement('header');
    head.className = 'sever2-focus-queue-head';
    head.innerHTML = `
      <div>${svg.focus}<span><small>ОЧЕРЕДЬ ФОКУСА</small><b>${tasks.length ? `${tasks.length} ${tasks.length === 1 ? 'дело' : 'дел'}` : 'План свободен'}</b><em>${tasks.length ? `${plannedMinutes || '—'} мин план · ${focusedMinutes} мин фокус` : 'Можно выбрать дело из входящих или создать новое'}</em></span></div>
      <button type="button" data-open-day>План дня${svg.chevron}</button>`;
    head.querySelector('[data-open-day]').addEventListener('click', () => {
      window.SeverApp?.switchView?.('calendar');
      requestAnimationFrame(() => document.querySelector('.sever2-calendar-modes [data-mode="day"]')?.click());
    });
    root.appendChild(head);

    if (!tasks.length) {
      const empty = document.createElement('div');
      empty.className = 'sever2-focus-queue-empty';
      if (inboxCount) {
        empty.innerHTML = `${svg.inbox}<span><b>${inboxCount} ${inboxCount === 1 ? 'дело' : 'дел'} во входящих</b><small>Сначала назначь дату — потом запускай фокус.</small></span><button type="button">Разобрать</button>`;
        empty.querySelector('button').addEventListener('click', () => {
          window.SeverApp?.switchView?.('calendar');
          requestAnimationFrame(() => document.querySelector('.sever2-calendar-modes [data-mode="inbox"]')?.click());
        });
      } else {
        empty.innerHTML = `${svg.focus}<span><b>На сегодня ничего не осталось</b><small>Фокус можно завершить без лишних действий.</small></span>`;
      }
      root.appendChild(empty);
      root.dataset.empty = 'true';
      return;
    }
    delete root.dataset.empty;

    const list = document.createElement('div');
    list.className = 'sever2-focus-queue-list';
    displayTasks.forEach((task, index) => {
      const focused = focusMinutesForTask(task.id);
      const isActive = activeId === task.id;
      const blocked = Boolean(activeId && !isActive);
      const row = document.createElement('article');
      row.className = `sever2-focus-queue-task${isActive ? ' active' : ''}`;
      row.dataset.taskId = task.id;
      row.innerHTML = `
        <span class="sever2-focus-order">${index + 1}</span>
        <div class="sever2-focus-queue-copy"><b></b><span>${task.time ? `${task.time} · ` : ''}${task.duration ? `${task.duration} мин` : '25 мин по умолчанию'}${focused ? ` · ${focused} мин уже в фокусе` : ''}</span></div>
        <button type="button" data-start-focus ${blocked ? 'disabled' : ''} aria-label="${isActive ? 'Продолжить текущую задачу' : 'Начать фокус по задаче'}">${svg.play}<span>${isActive ? (running ? 'Сейчас' : 'Продолжить') : focused ? 'Ещё сессия' : 'Фокус'}</span></button>`;
      row.querySelector('.sever2-focus-queue-copy b').textContent = task.title;
      row.querySelector('[data-start-focus]').addEventListener('click', () => startTask(task));
      list.appendChild(row);
    });
    root.appendChild(list);
  }

  function syncBrowserTitle() {
    const activeId = currentTaskId();
    const task = activeId ? plannerState().tasks.find(item => item.id === activeId) : null;
    if (!task || context().currentPage !== 'timer') {
      if (document.title !== 'SEVER') document.title = 'SEVER';
      return;
    }
    const display = ($('#timerDisplay')?.textContent || '').trim();
    const status = timerRunning() ? display : 'Пауза';
    document.title = `${status} · ${task.title} — SEVER`;
  }

  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderQueue();
      syncBrowserTitle();
    });
  }

  function installQueue() {
    const view = $('#timerView');
    const focusTools = $('#sever2FocusTools');
    const card = view?.querySelector('.focus-card');
    if (!view || !card || !focusTools || $('#sever2FocusQueue')) return false;
    const queue = document.createElement('section');
    queue.id = 'sever2FocusQueue';
    queue.className = 'sever2-focus-queue';
    queue.setAttribute('aria-label', 'Очередь фокуса на сегодня');
    focusTools.after(queue);
    renderQueue();
    return true;
  }

  function installObservers() {
    if (document.documentElement.dataset.severFocusFlowObservers === 'ready') return;
    document.documentElement.dataset.severFocusFlowObservers = 'ready';

    /* Never observe #timerView itself: #sever2FocusQueue lives inside it and
       renderQueue() replaces queue children. Observing the parent caused a
       self-triggering render loop that detached buttons while users clicked. */
    const targets = [$('#timerDisplay'), $('#todayTasks'), $('#activeTimerTask')].filter(Boolean);
    const observer = new MutationObserver(requestRender);
    targets.forEach(target => observer.observe(target, { childList:true, subtree:true, characterData:true, attributes:true }));

    document.addEventListener('keydown', event => {
      if (!event.altKey || event.key.toLowerCase() !== 'f') return;
      if (event.target.closest('input,textarea,select,[contenteditable="true"]') || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      window.SeverApp?.switchView?.('timer');
      requestAnimationFrame(() => $('#sever2FocusQueue')?.scrollIntoView({ block:'start', behavior:'smooth' }));
    });

    clearInterval(titleTimer);
    titleTimer = setInterval(syncBrowserTitle, 1000);
    window.addEventListener('pagehide', () => clearInterval(titleTimer), { once:true });
  }

  function boot() {
    if (document.documentElement.dataset.severFocusFlow === 'ready') return true;
    if (!window.SeverApp?.getState || document.documentElement.dataset.severProductivity !== 'ready') return false;
    if (!installQueue()) return false;
    installObservers();
    document.documentElement.dataset.severFocusFlow = 'ready';
    requestRender();
    return true;
  }

  function scheduleBoot() {
    if (boot()) {
      clearTimeout(bootTimer);
      return;
    }
    if (bootAttempts++ >= 160) return;
    clearTimeout(bootTimer);
    bootTimer = setTimeout(scheduleBoot, 50);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleBoot, { once:true });
  else scheduleBoot();
  window.addEventListener('load', scheduleBoot, { once:true });
  window.addEventListener('sever:ready', scheduleBoot);
})();