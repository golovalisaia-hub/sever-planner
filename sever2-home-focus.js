(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const TODAY = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  const INBOX_DATE = '9999-12-31';
  const LEGACY_HOME_SELECTORS = [
    '.today-hero', '.today-motivation', '.course-card', '#quickForm', '#todayDashboard', '#todayFocusWidget',
    '.today-quote', '.sever2-today-plan', '.sever2-home-inbox', '.today-list-head', '#todayFilters',
    '#todayTasks', '.today-utilities'
  ];
  let observer = null;
  let scheduled = false;

  function state() { return window.SeverApp?.getState?.() || { tasks: [] }; }
  function todayTasks() { const today = TODAY(); return state().tasks.filter(task => !task.challenge && task.date === today); }
  function inboxTasks() { return state().tasks.filter(task => !task.challenge && !task.completed && (!task.date || task.date === INBOX_DATE)); }
  function taskWord(count) {
    const mod100 = count % 100, mod10 = count % 10;
    if (mod100 >= 11 && mod100 <= 14) return 'задач';
    if (mod10 === 1) return 'задача';
    if (mod10 >= 2 && mod10 <= 4) return 'задачи';
    return 'задач';
  }
  function rankTasks(tasks) {
    return [...tasks].sort((a, b) => {
      if (a.completed !== b.completed) return Number(a.completed) - Number(b.completed);
      if (Boolean(a.priority) !== Boolean(b.priority)) return Number(Boolean(b.priority)) - Number(Boolean(a.priority));
      if (a.time && b.time) return a.time.localeCompare(b.time);
      if (a.time) return -1;
      if (b.time) return 1;
      return Number(a.createdAt || 0) - Number(b.createdAt || 0);
    });
  }
  function dateLabel() {
    return new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).toLocaleUpperCase('ru-RU');
  }
  function simplifyLegacyShell(view) {
    LEGACY_HOME_SELECTORS.forEach(selector => {
      view.querySelectorAll(selector).forEach(node => {
        node.style.setProperty('display', 'none', 'important');
        node.dataset.sever2HomeRetired = 'true';
      });
    });
  }
  function indexOriginalRows(tasks) {
    const ordered = [...tasks].sort((a, b) => Number(Boolean(b.priority)) - Number(Boolean(a.priority)));
    document.querySelectorAll('#todayTasks .task').forEach((row, index) => {
      const task = ordered[index];
      if (task?.id != null) row.dataset.taskId = String(task.id);
      else delete row.dataset.taskId;
    });
  }
  function originalTaskRow(task) {
    const id = String(task?.id ?? '');
    if (!id) return null;
    return [...document.querySelectorAll('#todayTasks .task')].find(item => item.dataset.taskId === id) || null;
  }
  function openInbox() {
    window.SeverApp?.switchView?.('calendar');
    requestAnimationFrame(() => $('.sever2-calendar-modes [data-mode="inbox"]')?.click());
  }
  function openDay() {
    window.SeverApp?.switchView?.('calendar');
    requestAnimationFrame(() => $('.sever2-calendar-modes [data-mode="day"]')?.click());
  }
  function openQuickNote() {
    const candidates = [$('#railOpenNote'), $('#mobileQuickNote')].filter(Boolean);
    const visible = candidates.find(node => getComputedStyle(node).display !== 'none' && node.getClientRects().length);
    (visible || candidates[0])?.click();
  }
  function startTask(task) { window.SeverApp?.startTimer?.({ taskId: task.id, durationMinutes: Number(task.duration) || 25 }); }
  function completeTask(task) { originalTaskRow(task)?.querySelector('.check')?.click(); }
  function openTask(task) { originalTaskRow(task)?.querySelector('.task-open,.edit')?.click(); }

  function ensureShell() {
    const view = $('#todayView');
    if (!view) return null;
    view.classList.add('sever2-home-simple');
    simplifyLegacyShell(view);
    let shell = $('#sever2HomeFocus');
    if (shell) return shell;
    shell = document.createElement('section');
    shell.id = 'sever2HomeFocus';
    shell.className = 'sever2-home-focus';
    shell.setAttribute('aria-label', 'Главное на сегодня');
    shell.innerHTML = `
      <div class="sever2-home-focus-head">
        <div><small id="sever2HomeDate">СЕГОДНЯ</small><h2>Сегодня</h2><p id="sever2HomeFocusSummary">План на сегодня</p></div>
      </div>
      <div id="sever2HomeTopTasks" class="sever2-home-top-tasks"></div>
      <button id="sever2HomeMoreTasks" class="sever2-home-more" type="button" hidden></button>
      <div class="sever2-home-shortcuts">
        <button id="sever2HomeInboxButton" type="button"><span><b>Входящие</b><small id="sever2HomeInboxCount">Нет задач без даты</small></span><svg class="sever2-home-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>
        <button id="sever2HomeFocusButton" type="button"><span><b>Фокус</b><small>Начать спокойную работу</small></span><svg class="sever2-home-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>
        <button id="sever2HomeQuickNoteButton" type="button"><span><b>Быстрая заметка</b><small>Записать мысль без переходов</small></span><svg class="sever2-home-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>
      </div>`;
    const anchor = $('.today-list-head') || $('#todayTasks') || view.firstChild;
    if (anchor?.parentNode === view) view.insertBefore(shell, anchor);
    else view.prepend(shell);
    $('#sever2HomeMoreTasks')?.addEventListener('click', openDay);
    $('#sever2HomeInboxButton')?.addEventListener('click', openInbox);
    $('#sever2HomeFocusButton')?.addEventListener('click', () => window.SeverApp?.switchView?.('timer'));
    $('#sever2HomeQuickNoteButton')?.addEventListener('click', openQuickNote);
    return shell;
  }

  function render() {
    scheduled = false;
    const shell = ensureShell(); if (!shell) return;
    const all = todayTasks();
    indexOriginalRows(all);
    const pending = all.filter(task => !task.completed), done = all.filter(task => task.completed), inbox = inboxTasks();
    const minutes = pending.reduce((sum, task) => sum + (Number(task.duration) || 0), 0), top = rankTasks(pending).slice(0, 3);
    const date = $('#sever2HomeDate'); if (date) date.textContent = dateLabel();
    $('#sever2HomeFocusSummary').textContent = all.length ? `${pending.length} осталось · ${done.length} готово${minutes ? ` · ${minutes} мин` : ''}` : 'План свободен — добавляйте только то, что действительно нужно';
    $('#sever2HomeInboxCount').textContent = inbox.length ? `${inbox.length} ${taskWord(inbox.length)} без даты` : 'Нет задач без даты';
    const more = Math.max(0, pending.length - top.length), moreButton = $('#sever2HomeMoreTasks');
    if (moreButton) {
      moreButton.hidden = more === 0;
      moreButton.textContent = more ? `Ещё ${more} ${taskWord(more)} на сегодня` : '';
    }
    const list = $('#sever2HomeTopTasks'); list.replaceChildren();
    if (!top.length) {
      const empty = document.createElement('div'); empty.className = 'sever2-home-focus-empty';
      empty.innerHTML = '<b>На сегодня всё спокойно</b><span>Если появится важное дело, добавьте его через центральную кнопку «Создать».</span>';
      list.appendChild(empty);
    } else {
      top.forEach(task => {
        const row = document.createElement('article'); row.className = 'sever2-home-focus-task'; row.dataset.taskId = task.id;
        const meta = [task.priority ? 'Важное' : '', task.time, task.duration ? `${task.duration} мин` : '', task.category || ''].filter(Boolean).join(' · ');
        row.innerHTML = `<button class="sever2-home-focus-check" type="button" aria-label="Отметить задачу выполненной"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 12.5 3.5 3.5 7.5-8"/></svg></button><button class="sever2-home-focus-copy" type="button"><b></b><small></small></button><button class="sever2-home-focus-start" type="button" aria-label="Начать фокус"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 7 8 5-8 5Z"/></svg></button>`;
        row.querySelector('.sever2-home-focus-copy b').textContent = task.title || 'Без названия';
        row.querySelector('.sever2-home-focus-copy small').textContent = meta || 'Без времени';
        row.querySelector('.sever2-home-focus-check').addEventListener('click', () => completeTask(task));
        row.querySelector('.sever2-home-focus-copy').addEventListener('click', () => openTask(task));
        row.querySelector('.sever2-home-focus-start').addEventListener('click', () => startTask(task));
        list.appendChild(row);
      });
    }
    document.documentElement.dataset.severHomeFocus = 'ready';
  }
  function scheduleRender() { if (scheduled) return; scheduled = true; requestAnimationFrame(render); }
  function boot() {
    if (!window.SeverApp?.getState) return false;
    ensureShell(); scheduleRender();
    const tasks = $('#todayTasks');
    if (tasks && !observer) { observer = new MutationObserver(scheduleRender); observer.observe(tasks, { childList: true, subtree: true }); }
    window.addEventListener('sever:ready', scheduleRender);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleRender(); });
    return true;
  }
  let attempts = 0;
  const tryBoot = () => { if (boot()) return; if (attempts++ < 120) setTimeout(tryBoot, 50); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryBoot, { once: true }); else tryBoot();
})();
