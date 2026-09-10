(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const INBOX_DATE = '9999-12-31';
  let bootAttempts = 0;
  let renderQueued = false;
  let observer = null;

  const icons = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    inbox: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-2 13H6L4 5Z"/><path d="M7 13h3l1 2h2l1-2h3"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 4 4 8-9"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>'
  };

  function dayISO(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function remainingLabel(count) {
    const mod100 = count % 100;
    const mod10 = count % 10;
    const word = mod100 >= 11 && mod100 <= 14
      ? 'дел'
      : mod10 === 1
        ? 'дело'
        : mod10 >= 2 && mod10 <= 4
          ? 'дела'
          : 'дел';
    return `${count} ${word} осталось`;
  }

  function plannerState() {
    return window.SeverApp?.getState?.() || { tasks: [] };
  }

  function todayTasks() {
    const date = dayISO();
    return (plannerState().tasks || []).filter(task => !task.challenge && task.date === date);
  }

  function inboxTasks() {
    return (plannerState().tasks || []).filter(task => !task.challenge && !task.completed && (!task.date || task.date === INBOX_DATE));
  }

  function priorityTasks(tasks) {
    return [...tasks]
      .filter(task => !task.completed)
      .sort((a, b) => {
        if (Boolean(a.priority) !== Boolean(b.priority)) return Number(Boolean(b.priority)) - Number(Boolean(a.priority));
        const at = a.time || '99:99';
        const bt = b.time || '99:99';
        if (at !== bt) return at.localeCompare(bt);
        return Number(a.createdAt || 0) - Number(b.createdAt || 0);
      })
      .slice(0, 3);
  }

  function openCreate() {
    const desktop = $('#globalAddBtn');
    const mobile = $('#mobileCreateBtn');
    const button = window.matchMedia('(max-width: 900px)').matches ? mobile : desktop;
    (button || desktop || mobile)?.click();
    requestAnimationFrame(() => $('#quickCaptureInput')?.focus({ preventScroll: true }));
  }

  function openInbox() {
    window.SeverApp?.switchView?.('calendar');
    requestAnimationFrame(() => $('.sever2-calendar-modes [data-mode="inbox"]')?.click());
  }

  function showAllToday() {
    $('#todayTasks')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function startTask(task) {
    if (!task || task.completed) return;
    window.SeverApp?.startTimer?.({ taskId: task.id, durationMinutes: Number(task.duration) || 25 });
  }

  function taskMeta(task) {
    const parts = [];
    if (task.priority) parts.push('Главная');
    if (task.time) parts.push(task.time);
    if (task.duration) parts.push(`${task.duration} мин`);
    if (task.category) parts.push(task.category);
    return parts.join(' · ') || 'На сегодня';
  }

  function ensureShell() {
    const view = $('#todayView');
    const listHead = view?.querySelector('.today-list-head');
    if (!view || !listHead) return null;
    let shell = $('#sever2HomeCommand');
    if (shell) return shell;

    shell = document.createElement('section');
    shell.id = 'sever2HomeCommand';
    shell.className = 'sever2-home-command';
    shell.setAttribute('aria-label', 'Главное на сегодня');
    listHead.before(shell);
    document.body.classList.add('sever2-home-flow-ready');
    return shell;
  }

  function render() {
    renderQueued = false;
    const shell = ensureShell();
    if (!shell) return;

    const all = todayTasks();
    const pending = all.filter(task => !task.completed);
    const done = all.filter(task => task.completed);
    const important = priorityTasks(all);
    const inbox = inboxTasks();
    const percent = all.length ? Math.round((done.length / all.length) * 100) : 0;
    const totalMinutes = pending.reduce((sum, task) => sum + (Number(task.duration) || 0), 0);

    shell.replaceChildren();

    const header = document.createElement('header');
    header.className = 'sever2-home-command-head';
    header.innerHTML = `
      <div class="sever2-home-command-title">
        <small>СЕГОДНЯ</small>
        <h2>${pending.length ? 'Главное на сегодня' : all.length ? 'День закрыт' : 'Спокойный старт'}</h2>
        <p>${pending.length ? `${remainingLabel(pending.length)}${totalMinutes ? ` · ${totalMinutes} мин` : ''}` : all.length ? 'Все задачи на сегодня выполнены.' : 'Добавь первое дело — остальное можно решить потом.'}</p>
      </div>
      <div class="sever2-home-command-progress" aria-label="Выполнено ${percent}%">
        <b>${percent}%</b><span><i style="width:${percent}%"></i></span>
      </div>`;
    shell.appendChild(header);

    const actions = document.createElement('div');
    actions.className = 'sever2-home-command-actions';
    actions.innerHTML = `
      <button type="button" class="primary" data-home-create>${icons.plus}<span>Добавить дело</span></button>
      <button type="button" data-home-inbox>${icons.inbox}<span>Входящие</span><b>${inbox.length}</b></button>
      ${all.length ? `<button type="button" data-home-all><span>Все задачи</span>${icons.arrow}</button>` : ''}`;
    actions.querySelector('[data-home-create]').addEventListener('click', openCreate);
    actions.querySelector('[data-home-inbox]').addEventListener('click', openInbox);
    actions.querySelector('[data-home-all]')?.addEventListener('click', showAllToday);
    shell.appendChild(actions);

    const focus = document.createElement('div');
    focus.className = 'sever2-home-priority-list';

    if (!important.length) {
      const empty = document.createElement('div');
      empty.className = 'sever2-home-priority-empty';
      empty.innerHTML = all.length
        ? `${icons.check}<div><b>На сегодня всё готово</b><span>Можно оставить день закрытым или добавить новое дело.</span></div>`
        : `${icons.check}<div><b>Пока ничего не запланировано</b><span>SEVER не будет заполнять день за тебя.</span></div>`;
      focus.appendChild(empty);
    } else {
      important.forEach((task, index) => {
        const row = document.createElement('article');
        row.className = `sever2-home-priority${index === 0 ? ' first' : ''}`;
        row.dataset.taskId = task.id;
        const number = document.createElement('span');
        number.className = 'sever2-home-priority-number';
        number.textContent = String(index + 1).padStart(2, '0');
        const copy = document.createElement('div');
        copy.className = 'sever2-home-priority-copy';
        const title = document.createElement('b');
        title.textContent = task.title || 'Задача';
        const meta = document.createElement('span');
        meta.textContent = taskMeta(task);
        copy.append(title, meta);
        const start = document.createElement('button');
        start.type = 'button';
        start.className = 'sever2-home-priority-start';
        start.setAttribute('aria-label', `Начать: ${task.title || 'задача'}`);
        start.innerHTML = `${icons.play}<span>${index === 0 ? 'Начать' : 'Фокус'}</span>`;
        start.addEventListener('click', () => startTask(task));
        row.append(number, copy, start);
        focus.appendChild(row);
      });
    }
    shell.appendChild(focus);
    document.documentElement.dataset.severHomeFlow = 'ready';
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(render);
  }

  function observe() {
    if (observer) return;
    const taskRoot = $('#todayTasks');
    if (!taskRoot) return;
    observer = new MutationObserver(queueRender);
    observer.observe(taskRoot, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    window.addEventListener('sever:ready', queueRender);
    window.addEventListener('focus', queueRender);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) queueRender(); });
  }

  function boot() {
    if (!window.SeverApp?.getState || !$('#todayView') || !$('#todayTasks')) {
      if (bootAttempts++ < 160) setTimeout(boot, 50);
      return;
    }
    observe();
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
