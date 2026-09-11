(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const INBOX_DATE = '9999-12-31';
  const svg = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>',
    inbox: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-2 13H6L4 5Z"/><path d="M7 13h3l1 2h2l1-2h3"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 4 4 8-9"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>'
  };

  const dayISO = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const state = () => window.SeverApp?.getState?.() || { tasks: [] };
  let bootAttempts = 0;
  let bootTimer = 0;
  let renderQueued = false;

  function todayTasks() {
    const today = dayISO();
    return (state().tasks || []).filter(task => task?.date === today);
  }

  function inboxTasks() {
    return (state().tasks || []).filter(task => task && !task.challenge && !task.completed && (!task.date || task.date === INBOX_DATE));
  }

  function taskRank(a, b) {
    if (Boolean(a.challenge) !== Boolean(b.challenge)) return Number(Boolean(b.challenge)) - Number(Boolean(a.challenge));
    if (Boolean(a.priority) !== Boolean(b.priority)) return Number(Boolean(b.priority)) - Number(Boolean(a.priority));
    if (a.time && b.time && a.time !== b.time) return a.time.localeCompare(b.time);
    if (a.time && !b.time) return -1;
    if (!a.time && b.time) return 1;
    return Number(a.createdAt || 0) - Number(b.createdAt || 0);
  }

  function taskMeta(task) {
    const parts = [];
    if (task.challenge) parts.push('Цель');
    else if (task.priority) parts.push('Важное');
    if (task.time) parts.push(task.time);
    if (Number(task.duration) > 0) parts.push(`${Number(task.duration)} мин`);
    if (task.category) parts.push(task.category);
    return parts.join(' · ') || 'Без времени';
  }

  function plannedMinutes(tasks) {
    return tasks.reduce((sum, task) => sum + (Number(task.duration) || 0), 0);
  }

  function visibleCreateButton() {
    return ['#globalAddBtn', '#mobileCreateBtn']
      .map($)
      .find(button => button && getComputedStyle(button).display !== 'none' && getComputedStyle(button).visibility !== 'hidden') || $('#globalAddBtn') || $('#mobileCreateBtn');
  }

  function openCreate() {
    const button = visibleCreateButton();
    if (!button) return;
    button.click();
    requestAnimationFrame(() => $('#quickCaptureInput')?.focus({ preventScroll: true }));
  }

  function goToTasks() {
    const list = $('#todayTasks');
    if (!list) return;
    list.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function goInbox() {
    window.SeverApp?.switchView?.('calendar');
    const open = () => $('.sever2-calendar-modes [data-mode="inbox"]')?.click();
    requestAnimationFrame(() => {
      if (!open()) setTimeout(open, 80);
    });
  }

  function startFocus(taskId) {
    const task = (state().tasks || []).find(item => item?.id === taskId && !item.completed);
    if (!task) return;
    window.SeverApp?.startTimer?.({ taskId: task.id, durationMinutes: Number(task.duration) || 25 });
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  }

  function renderTopTasks(root, tasks, { startAt = 1 } = {}) {
    root.replaceChildren();
    if (!tasks.length) return;

    tasks.slice(0, 3).forEach((task, index) => {
      const row = document.createElement('article');
      row.className = 'sever2-home-priority-row';
      row.dataset.taskId = task.id;
      row.innerHTML = `
        <span class="sever2-home-priority-number">${index + startAt}</span>
        <span class="sever2-home-priority-copy"><b></b><small></small></span>
        <button type="button" data-home-focus aria-label="Начать фокус">${svg.play}</button>`;
      row.querySelector('.sever2-home-priority-copy b').textContent = task.title || 'Без названия';
      row.querySelector('.sever2-home-priority-copy small').textContent = taskMeta(task);
      row.querySelector('[data-home-focus]').addEventListener('click', () => startFocus(task.id));
      root.appendChild(row);
    });
  }

  function render() {
    const root = $('#sever2HomeCore');
    if (!root) return;

    const items = todayTasks();
    const pending = items.filter(task => !task.completed).sort(taskRank);
    const completed = items.length - pending.length;
    const inbox = inboxTasks();
    const minutes = plannedMinutes(pending);
    const next = pending[0] || null;
    const followUps = pending.slice(1);
    const progress = items.length ? Math.round((completed / items.length) * 100) : 0;

    const title = root.querySelector('[data-home-now-title]');
    const meta = root.querySelector('[data-home-now-meta]');
    const focus = root.querySelector('[data-home-action="focus"]');
    const create = root.querySelector('[data-home-action="create"]');

    if (next) {
      title.textContent = next.title || 'Следующее дело';
      meta.textContent = taskMeta(next);
      focus.classList.remove('hidden');
      focus.dataset.taskId = next.id;
      create.classList.add('hidden');
    } else {
      title.textContent = items.length ? 'План на сегодня выполнен' : 'План на сегодня свободен';
      meta.textContent = items.length ? 'Можно завершать день без лишней суеты.' : 'Добавь только то, что действительно нужно сделать.';
      focus.classList.add('hidden');
      focus.dataset.taskId = '';
      create.classList.remove('hidden');
    }

    root.querySelector('[data-home-stat="remaining"]').textContent = String(pending.length);
    root.querySelector('[data-home-stat="minutes"]').textContent = minutes ? `${minutes} мин` : '—';
    root.querySelector('[data-home-stat="progress"]').textContent = items.length ? `${progress}%` : '—';
    root.querySelector('[data-home-inbox-count]').textContent = String(inbox.length);
    root.querySelector('[data-home-inbox]').classList.toggle('hidden', inbox.length === 0);

    const priority = root.querySelector('.sever2-home-priority');
    priority.classList.toggle('hidden', followUps.length === 0);
    const topLabel = root.querySelector('[data-home-priority-caption]');
    if (followUps.length > 3) topLabel.textContent = `Следующие 3 · ещё ${followUps.length - 3} в списке`;
    else if (followUps.length) topLabel.textContent = `${followUps.length} ${followUps.length === 1 ? 'дело' : 'дела'} после главного`;
    else topLabel.textContent = '';

    renderTopTasks(root.querySelector('[data-home-priority-list]'), followUps, { startAt: 2 });
    root.dataset.homeState = next ? 'active' : items.length ? 'complete' : 'empty';
  }

  function install() {
    if ($('#sever2HomeCore')) return true;
    if (!window.SeverApp?.getState || !$('#todayView') || !$('#todayPageTitle') || !$('#todayTasks')) return false;

    const section = document.createElement('section');
    section.id = 'sever2HomeCore';
    section.className = 'sever2-home-core';
    section.setAttribute('aria-label', 'План на сегодня');
    section.innerHTML = `
      <div class="sever2-home-now">
        <div class="sever2-home-now-copy">
          <small>ГЛАВНОЕ СЕЙЧАС</small>
          <h2 data-home-now-title></h2>
          <p data-home-now-meta></p>
          <div class="sever2-home-now-actions">
            <button type="button" class="primary" data-home-action="focus">${svg.play}<span>Начать фокус</span></button>
            <button type="button" class="primary hidden" data-home-action="create">${svg.plus}<span>Добавить задачу</span></button>
            <button type="button" data-home-action="tasks">${svg.list}<span>К задачам</span></button>
          </div>
        </div>
        <div class="sever2-home-stats" aria-label="Сводка дня">
          <span><small>ОСТАЛОСЬ</small><b data-home-stat="remaining">0</b></span>
          <span><small>ПЛАН</small><b data-home-stat="minutes">—</b></span>
          <span><small>ГОТОВО</small><b data-home-stat="progress">—</b></span>
        </div>
      </div>
      <div class="sever2-home-priority hidden">
        <header><span><small>ДАЛЬШЕ</small><b>Что после главного</b></span><button type="button" data-home-action="tasks">Все задачи ${svg.arrow}</button></header>
        <p data-home-priority-caption></p>
        <div class="sever2-home-priority-list" data-home-priority-list></div>
      </div>
      <button type="button" class="sever2-home-inbox-link hidden" data-home-inbox data-home-action="inbox">
        <span>${svg.inbox}<span><small>ВХОДЯЩИЕ</small><b><i data-home-inbox-count>0</i> без даты</b></span></span>
        <span>Разобрать ${svg.arrow}</span>
      </button>`;

    $('#todayPageTitle').after(section);
    section.addEventListener('click', event => {
      const button = event.target.closest('[data-home-action]');
      if (!button) return;
      const action = button.dataset.homeAction;
      if (action === 'create') openCreate();
      else if (action === 'tasks') goToTasks();
      else if (action === 'inbox') goInbox();
      else if (action === 'focus') startFocus(button.dataset.taskId);
    });

    const taskRoot = $('#todayTasks');
    new MutationObserver(scheduleRender).observe(taskRoot, { childList: true, subtree: true, characterData: true });
    const view = $('#todayView');
    new MutationObserver(scheduleRender).observe(view, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('sever:ready', scheduleRender);
    document.documentElement.dataset.severHomeCore = 'ready';
    render();
    return true;
  }

  function boot() {
    if (install()) {
      clearTimeout(bootTimer);
      return;
    }
    if (bootAttempts++ > 160) return;
    clearTimeout(bootTimer);
    bootTimer = setTimeout(boot, 50);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
  window.addEventListener('load', boot, { once: true });
})();