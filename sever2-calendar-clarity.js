(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const MONTHS = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
  let bootAttempts = 0;
  let bootTimer = 0;
  let calendarObserver = null;
  let expanded = false;

  const pad = value => String(value).padStart(2, '0');
  const iso = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const currentState = () => window.SeverApp?.getState?.() || { tasks: [] };

  function monthContext() {
    const title = String($('#monthTitle')?.textContent || '').trim().toLocaleLowerCase('ru-RU');
    const match = title.match(/^([^\s]+)\s+(\d{4})$/);
    if (!match) return null;
    const month = MONTHS.indexOf(match[1]);
    const year = Number(match[2]);
    if (month < 0 || !Number.isInteger(year)) return null;
    return { year, month };
  }

  function dateForCell(index, context) {
    const first = new Date(context.year, context.month, 1, 12);
    const offset = (first.getDay() + 6) % 7;
    return new Date(context.year, context.month, index - offset + 1, 12);
  }

  function formatDay(date) {
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  }

  function formatWeekday(date) {
    return date.toLocaleDateString('ru-RU', { weekday: 'short' }).replace('.', '');
  }

  function plural(count, one, few, many) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  function tasksFor(date) {
    return currentState().tasks.filter(task => task.date === date);
  }

  function decorateCells() {
    const context = monthContext();
    const cells = $$('#calendar > .day');
    if (!context || cells.length !== 42) return;

    cells.forEach((cell, index) => {
      const date = dateForCell(index, context);
      const key = iso(date);
      const items = tasksFor(key);
      const done = items.filter(task => task.completed).length;
      const pending = items.length - done;
      cell.dataset.severDate = key;
      cell.dataset.severTaskCount = String(items.length);
      cell.classList.toggle('sever-has-tasks', items.length > 0);
      cell.querySelector('.sever2-day-status')?.remove();

      const status = document.createElement('span');
      status.className = 'sever2-day-status';
      status.setAttribute('aria-hidden', 'true');
      items.slice(0, 3).forEach(task => {
        const dot = document.createElement('i');
        dot.className = task.completed ? 'done' : 'pending';
        status.appendChild(dot);
      });
      if (items.length > 3) {
        const more = document.createElement('b');
        more.textContent = `+${items.length - 3}`;
        status.appendChild(more);
      }
      if (items.length) cell.appendChild(status);

      const label = `${formatDay(date)}, ${items.length} ${plural(items.length, 'задача', 'задачи', 'задач')}` +
        (items.length ? `: ${pending} осталось, ${done} готово` : '');
      cell.setAttribute('aria-label', label);
    });
  }

  function activeDays() {
    const context = monthContext();
    if (!context) return [];
    const prefix = `${context.year}-${pad(context.month + 1)}-`;
    const groups = new Map();
    currentState().tasks.forEach(task => {
      if (!task?.date?.startsWith(prefix)) return;
      if (!groups.has(task.date)) groups.set(task.date, []);
      groups.get(task.date).push(task);
    });
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, tasks]) => ({ date, tasks }));
  }

  function ensureHistory() {
    let section = $('#sever2MonthHistory');
    if (section) return section;
    const calendar = $('#calendar');
    if (!calendar) return null;

    section = document.createElement('section');
    section.id = 'sever2MonthHistory';
    section.className = 'sever2-month-history';
    section.innerHTML = `
      <header class="sever2-month-history-head">
        <div><small>ДЕЛА МЕСЯЦА</small><b id="sever2MonthHistoryTitle">Что было запланировано</b></div>
        <span id="sever2MonthHistorySummary"></span>
      </header>
      <div id="sever2MonthHistoryList" class="sever2-month-history-list"></div>
      <button id="sever2MonthHistoryMore" class="sever2-month-history-more hidden" type="button"></button>`;
    calendar.after(section);
    $('#sever2MonthHistoryMore')?.addEventListener('click', () => {
      expanded = !expanded;
      renderHistory();
    });
    return section;
  }

  function openCalendarDay(date) {
    const cell = $(`#calendar > .day[data-sever-date="${date}"]`);
    if (cell) cell.click();
  }

  function renderHistory() {
    const section = ensureHistory();
    const context = monthContext();
    const list = $('#sever2MonthHistoryList');
    const summary = $('#sever2MonthHistorySummary');
    const more = $('#sever2MonthHistoryMore');
    if (!section || !context || !list || !summary || !more) return;

    const days = activeDays();
    const taskCount = days.reduce((sum, day) => sum + day.tasks.length, 0);
    const doneCount = days.reduce((sum, day) => sum + day.tasks.filter(task => task.completed).length, 0);
    summary.textContent = days.length
      ? `${days.length} ${plural(days.length, 'день', 'дня', 'дней')} · ${taskCount} ${plural(taskCount, 'дело', 'дела', 'дел')}`
      : 'Пока пусто';
    list.replaceChildren();

    if (!days.length) {
      const empty = document.createElement('div');
      empty.className = 'sever2-month-history-empty';
      empty.innerHTML = '<b>В этом месяце задач пока нет</b><span>Когда появятся дела, здесь будет видно, в какой день и что было запланировано.</span>';
      list.appendChild(empty);
      more.classList.add('hidden');
      return;
    }

    const today = iso(new Date());
    const ordered = [...days].sort((a, b) => {
      const aDistance = Math.abs(new Date(`${a.date}T12:00:00`) - new Date(`${today}T12:00:00`));
      const bDistance = Math.abs(new Date(`${b.date}T12:00:00`) - new Date(`${today}T12:00:00`));
      return aDistance - bDistance || a.date.localeCompare(b.date);
    });
    const visible = expanded ? days : ordered.slice(0, 6).sort((a, b) => a.date.localeCompare(b.date));

    visible.forEach(day => {
      const date = new Date(`${day.date}T12:00:00`);
      const done = day.tasks.filter(task => task.completed).length;
      const pending = day.tasks.length - done;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `sever2-month-history-row${day.date === today ? ' today' : ''}`;
      row.dataset.historyDate = day.date;

      const dateBox = document.createElement('span');
      dateBox.className = 'sever2-month-history-date';
      const dateTitle = document.createElement('b');
      dateTitle.textContent = formatDay(date);
      const weekday = document.createElement('small');
      weekday.textContent = formatWeekday(date);
      dateBox.append(dateTitle, weekday);

      const copy = document.createElement('span');
      copy.className = 'sever2-month-history-copy';
      const taskTitle = document.createElement('b');
      taskTitle.textContent = day.tasks.slice(0, 2).map(task => task.title).filter(Boolean).join(' · ') || 'Задачи';
      const meta = document.createElement('small');
      meta.textContent = `${pending} осталось · ${done} готово${day.tasks.length > 2 ? ` · ещё ${day.tasks.length - 2}` : ''}`;
      copy.append(taskTitle, meta);

      const arrow = document.createElement('span');
      arrow.className = 'sever2-month-history-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '›';

      row.append(dateBox, copy, arrow);
      row.setAttribute('aria-label', `${formatDay(date)}. ${pending} осталось, ${done} готово. Открыть день.`);
      row.addEventListener('click', () => openCalendarDay(day.date));
      list.appendChild(row);
    });

    if (days.length > 6) {
      more.classList.remove('hidden');
      more.textContent = expanded ? 'Свернуть' : `Показать все ${days.length}`;
    } else {
      more.classList.add('hidden');
    }

    section.dataset.completed = String(doneCount);
  }

  function goToCurrentMonth() {
    const context = monthContext();
    if (!context) return;
    const now = new Date();
    const diff = (now.getFullYear() - context.year) * 12 + (now.getMonth() - context.month);
    const button = diff >= 0 ? $('#nextMonth') : $('#prevMonth');
    for (let i = 0; i < Math.abs(diff); i += 1) button?.click();
  }

  function installMonthNavigation() {
    const heading = $('#calendarView > .heading');
    if (!heading) return;
    const actions = heading.querySelector(':scope > div:last-child');
    if (!actions) return;
    actions.classList.add('sever2-calendar-heading-actions');
    if (!$('#sever2CalendarToday')) {
      const today = document.createElement('button');
      today.id = 'sever2CalendarToday';
      today.type = 'button';
      today.className = 'sever2-calendar-today';
      today.textContent = 'Сегодня';
      today.addEventListener('click', goToCurrentMonth);
      const next = $('#nextMonth');
      if (next) actions.insertBefore(today, next);
      else actions.appendChild(today);
    }
  }

  function refreshCalendarClarity() {
    decorateCells();
    renderHistory();
  }

  function installCalendarObserver() {
    const calendar = $('#calendar');
    if (!calendar || calendarObserver) return;
    calendarObserver = new MutationObserver(records => {
      if (!records.some(record => record.type === 'childList' && record.target === calendar)) return;
      requestAnimationFrame(refreshCalendarClarity);
    });
    calendarObserver.observe(calendar, { childList: true });
  }

  function boot() {
    if (!window.SeverApp?.getState || !$('#calendar') || !$('.sever2-calendar-modes')) return false;
    installMonthNavigation();
    installCalendarObserver();
    ensureHistory();
    refreshCalendarClarity();
    document.documentElement.dataset.severCalendarClarity = 'ready';
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleBoot, { once: true });
  else scheduleBoot();
  window.addEventListener('load', scheduleBoot, { once: true });
  window.addEventListener('sever:ready', scheduleBoot);
})();
