(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const TODAY = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  const INBOX_DATE = '9999-12-31';
  const LEGACY_HOME_SELECTORS = [
    '.today-motivation', '.course-card', '#quickForm', '#todayDashboard', '#todayFocusWidget', '.today-quote',
    '.sever2-today-plan', '.sever2-home-inbox'
  ];
  let observer = null;
  let scheduled = false;

  function state() { return window.SeverApp?.getState?.() || { tasks: [] }; }
  function todayTasks() { const today = TODAY(); return state().tasks.filter(task => !task.challenge && task.date === today); }
  function inboxTasks() { return state().tasks.filter(task => !task.challenge && !task.completed && (!task.date || task.date === INBOX_DATE)); }
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
  function simplifyLegacyShell(view) {
    LEGACY_HOME_SELECTORS.forEach(selector => {
      view.querySelectorAll(selector).forEach(node => {
        node.style.setProperty('display', 'none', 'important');
        node.dataset.sever2HomeRetired = 'true';
      });
    });
  }
  function openCreate() {
    const desktop = $('#globalAddBtn'), mobile = $('#mobileCreateBtn');
    const trigger = desktop && getComputedStyle(desktop).display !== 'none' ? desktop : mobile;
    trigger?.click();
  }
  function openInbox() {
    window.SeverApp?.switchView?.('calendar');
    requestAnimationFrame(() => $('.sever2-calendar-modes [data-mode="inbox"]')?.click());
  }
  function startTask(task) { window.SeverApp?.startTimer?.({ taskId: task.id, durationMinutes: Number(task.duration) || 25 }); }
  function openTask(task) {
    const row = [...document.querySelectorAll('#todayTasks .task')].find(item => item.querySelector('.task-name')?.textContent?.trim().endsWith(task.title || ''));
    row?.querySelector('.task-open,.edit')?.click();
  }

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
      <div class="sever2-home-focus-head"><div><small>СЕГОДНЯ</small><h2>Главное на день</h2><p id="sever2HomeFocusSummary">План на сегодня</p></div><button id="sever2HomeCreate" type="button">+ Создать</button></div>
      <div id="sever2HomeTopTasks" class="sever2-home-top-tasks"></div>
      <div class="sever2-home-shortcuts">
        <button id="sever2HomeInboxButton" type="button"><span><b>Входящие</b><small id="sever2HomeInboxCount">0 задач без даты</small></span><i aria-hidden="true">›</i></button>
        <button id="sever2HomeFocusButton" type="button"><span><b>Фокус</b><small>Начать спокойную работу</small></span><i aria-hidden="true">›</i></button>
      </div>`;
    const anchor = $('.today-list-head') || $('#todayTasks');
    anchor?.parentNode?.insertBefore(shell, anchor);
    $('#sever2HomeCreate')?.addEventListener('click', openCreate);
    $('#sever2HomeInboxButton')?.addEventListener('click', openInbox);
    $('#sever2HomeFocusButton')?.addEventListener('click', () => window.SeverApp?.switchView?.('timer'));
    return shell;
  }

  function render() {
    scheduled = false;
    const shell = ensureShell(); if (!shell) return;
    const all = todayTasks(), pending = all.filter(task => !task.completed), done = all.filter(task => task.completed), inbox = inboxTasks();
    const minutes = pending.reduce((sum, task) => sum + (Number(task.duration) || 0), 0), top = rankTasks(pending).slice(0, 3);
    $('#sever2HomeFocusSummary').textContent = all.length ? `${pending.length} осталось · ${done.length} готово${minutes ? ` · ${minutes} мин` : ''}` : 'День свободен — добавьте только то, что действительно нужно';
    $('#sever2HomeInboxCount').textContent = inbox.length ? `${inbox.length} ${inbox.length === 1 ? 'задача' : 'задач'} без даты` : 'Нет задач без даты';
    const list = $('#sever2HomeTopTasks'); list.replaceChildren();
    if (!top.length) {
      const empty = document.createElement('div'); empty.className = 'sever2-home-focus-empty';
      empty.innerHTML = '<b>На сегодня всё спокойно</b><span>Можно добавить одно важное дело или оставить день свободным.</span>';
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Добавить задачу'; button.addEventListener('click', openCreate); empty.appendChild(button); list.appendChild(empty);
    } else {
      top.forEach((task, index) => {
        const row = document.createElement('article'); row.className = 'sever2-home-focus-task'; row.dataset.taskId = task.id;
        const meta = [task.time, task.duration ? `${task.duration} мин` : '', task.category || ''].filter(Boolean).join(' · ');
        row.innerHTML = `<span class="sever2-home-focus-number">${index + 1}</span><button class="sever2-home-focus-copy" type="button"><b></b><small></small></button><button class="sever2-home-focus-start" type="button" aria-label="Начать фокус">▶</button>`;
        row.querySelector('.sever2-home-focus-copy b').textContent = task.title || 'Без названия';
        row.querySelector('.sever2-home-focus-copy small').textContent = meta || 'Без времени';
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
    if (tasks && !observer) { observer = new MutationObserver(scheduleRender); observer.observe(tasks, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] }); }
    window.addEventListener('sever:ready', scheduleRender);
    window.addEventListener('focus', scheduleRender);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleRender(); });
    return true;
  }
  let attempts = 0;
  const tryBoot = () => { if (boot()) return; if (attempts++ < 120) setTimeout(tryBoot, 50); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryBoot, { once: true }); else tryBoot();
})();
