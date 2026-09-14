(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const pad = value => String(value).padStart(2, '0');
  const iso = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const fromIso = value => new Date(`${value}T12:00:00`);
  const addDays = (value, amount) => {
    const date = typeof value === 'string' ? fromIso(value) : new Date(value);
    date.setDate(date.getDate() + amount);
    return iso(date);
  };
  const today = () => iso(new Date());
  const state = () => window.SeverApp?.getState?.() || { tasks: [], habits: [], checks: {}, focusSessions: [] };

  let bootAttempts = 0;
  let bootTimer = 0;
  let habitWeekOffset = 0;
  let habitObserver = null;
  let progressObserver = null;
  let todayObserver = null;
  let habitFrame = 0;
  let progressFrame = 0;
  let missedFrame = 0;
  let dayRefreshTimer = 0;

  function plural(count, one, few, many) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  function prettyDate(value) {
    return fromIso(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
  }

  function weekStart(offset = habitWeekOffset) {
    const now = fromIso(today());
    const mondayOffset = (now.getDay() + 6) % 7;
    now.setDate(now.getDate() - mondayOffset + offset * 7);
    return iso(now);
  }

  function habitStartDate(habit) {
    const created = Number(habit?.createdAt) || 0;
    return created ? iso(new Date(created)) : addDays(today(), -29);
  }

  function activeDaysForHabit(habit, days = 30) {
    const end = today();
    const windowStart = addDays(end, -(days - 1));
    const start = habitStartDate(habit) > windowStart ? habitStartDate(habit) : windowStart;
    if (start > end) return 0;
    return Math.floor((fromIso(end) - fromIso(start)) / 86400000) + 1;
  }

  function checksFor(habitId) {
    return new Set((state().checks?.[habitId] || []).filter(value => typeof value === 'string' && value <= today()));
  }

  function habitCurrentStreak(habit) {
    const checks = checksFor(habit.id);
    let cursor = today();
    if (!checks.has(cursor)) cursor = addDays(cursor, -1);
    let count = 0;
    while (checks.has(cursor)) {
      count += 1;
      cursor = addDays(cursor, -1);
    }
    return count;
  }

  function habitBestStreak(habit) {
    const dates = [...checksFor(habit.id)].sort();
    let best = 0;
    let run = 0;
    let previous = '';
    dates.forEach(date => {
      run = previous && addDays(previous, 1) === date ? run + 1 : 1;
      best = Math.max(best, run);
      previous = date;
    });
    return best;
  }

  function habitThirtyDayRate(habit) {
    const possible = activeDaysForHabit(habit, 30);
    if (!possible) return 0;
    const start = addDays(today(), -(possible - 1));
    const done = [...checksFor(habit.id)].filter(date => date >= start && date <= today()).length;
    return Math.round(done / possible * 100);
  }

  function aggregateHabitRate() {
    const habits = state().habits || [];
    let possible = 0;
    let done = 0;
    habits.forEach(habit => {
      const days = activeDaysForHabit(habit, 30);
      if (!days) return;
      const start = addDays(today(), -(days - 1));
      possible += days;
      done += [...checksFor(habit.id)].filter(date => date >= start && date <= today()).length;
    });
    return possible ? Math.round(done / possible * 100) : 0;
  }

  function taskRate(days = 30) {
    const start = addDays(today(), -(days - 1));
    const tasks = (state().tasks || []).filter(task => !task.challenge && task.date >= start && task.date <= today());
    const done = tasks.filter(task => task.completed).length;
    return { total: tasks.length, done, rate: tasks.length ? Math.round(done / tasks.length * 100) : 0 };
  }

  function focusMinutesBetween(start, end) {
    return (state().focusSessions || [])
      .filter(session => session?.status === 'completed')
      .filter(session => {
        const stamp = Number(session.completedAt || session.startedAt) || 0;
        if (!stamp) return false;
        const date = iso(new Date(stamp));
        return date >= start && date <= end;
      })
      .reduce((sum, session) => sum + Math.max(0, Number(session.durationMinutes) || 0), 0);
  }

  function formatFocus(minutes) {
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return rest ? `${hours}ч ${rest}м` : `${hours}ч`;
    }
    return `${minutes}м`;
  }

  function ensureProgressSummary() {
    const view = $('#progressView');
    const stats = view?.querySelector('.stats');
    if (!view || !stats) return null;
    let root = $('#sever109ProgressSummary');
    if (root) return root;
    root = document.createElement('section');
    root.id = 'sever109ProgressSummary';
    root.className = 'sever109-progress-summary';
    root.setAttribute('aria-label', 'Сводка прогресса за последние 30 дней');
    root.innerHTML = `
      <article class="sever109-progress-card" data-metric="tasks"><span>Задачи · 30 дней</span><b>0%</b><small>Пока нет данных</small></article>
      <article class="sever109-progress-card" data-metric="habits"><span>Привычки · 30 дней</span><b>0%</b><small>Пока нет привычек</small></article>
      <article class="sever109-progress-card" data-metric="streak"><span>Лучшая серия</span><b>0 дней</b><small>История привычек</small></article>
      <article class="sever109-progress-card" data-metric="focus"><span>Фокус · 7 дней</span><b>0м</b><small>Сравнение с прошлой неделей</small></article>`;
    stats.after(root);
    return root;
  }

  function ensureHabitProgress() {
    const heat = $('#progressView .heat-card');
    if (!heat) return null;
    let root = $('#sever109HabitProgress');
    if (root) return root;
    root = document.createElement('section');
    root.id = 'sever109HabitProgress';
    root.className = 'sever109-habit-progress';
    root.innerHTML = `
      <header class="sever109-habit-progress-head">
        <div><small>РИТМ ПРИВЫЧЕК</small><h2>Последние 30 дней</h2></div>
        <span id="sever109HabitProgressSummary">История сохраняется автоматически</span>
      </header>
      <div id="sever109HabitProgressList" class="sever109-habit-progress-list"></div>`;
    heat.after(root);
    return root;
  }

  function renderProgressSummary() {
    progressFrame = 0;
    const summary = ensureProgressSummary();
    const habitProgress = ensureHabitProgress();
    if (!summary || !habitProgress) return;

    const tasks = taskRate(30);
    const habits = state().habits || [];
    const habitRate = aggregateHabitRate();
    const bestStreak = habits.reduce((best, habit) => Math.max(best, habitBestStreak(habit)), 0);
    const currentBest = habits.reduce((best, habit) => Math.max(best, habitCurrentStreak(habit)), 0);
    const weekStartDate = addDays(today(), -6);
    const previousStart = addDays(today(), -13);
    const previousEnd = addDays(today(), -7);
    const focus = focusMinutesBetween(weekStartDate, today());
    const previousFocus = focusMinutesBetween(previousStart, previousEnd);

    const taskCard = summary.querySelector('[data-metric="tasks"]');
    taskCard.querySelector('b').textContent = `${tasks.rate}%`;
    taskCard.querySelector('small').textContent = tasks.total
      ? `${tasks.done} из ${tasks.total} ${plural(tasks.total, 'задачи', 'задач', 'задач')} выполнено`
      : 'За 30 дней задач ещё не было';
    taskCard.dataset.tone = tasks.rate >= 70 ? 'strong' : '';

    const habitCard = summary.querySelector('[data-metric="habits"]');
    habitCard.querySelector('b').textContent = habits.length ? `${habitRate}%` : '—';
    habitCard.querySelector('small').textContent = habits.length
      ? `${habits.length} ${plural(habits.length, 'привычка', 'привычки', 'привычек')} · без обнуления истории`
      : 'Добавь первую привычку';
    habitCard.dataset.tone = habitRate >= 70 ? 'strong' : '';

    const streakCard = summary.querySelector('[data-metric="streak"]');
    streakCard.querySelector('b').textContent = `${bestStreak} ${plural(bestStreak, 'день', 'дня', 'дней')}`;
    streakCard.querySelector('small').textContent = habits.length
      ? `Текущая лучшая серия: ${currentBest} ${plural(currentBest, 'день', 'дня', 'дней')}`
      : 'Появится после отметок привычек';
    streakCard.dataset.tone = bestStreak >= 3 ? 'strong' : '';

    const focusCard = summary.querySelector('[data-metric="focus"]');
    focusCard.querySelector('b').textContent = formatFocus(focus);
    const delta = focus - previousFocus;
    focusCard.querySelector('small').textContent = previousFocus || focus
      ? `${delta === 0 ? 'На уровне прошлой недели' : delta > 0 ? `На ${formatFocus(delta)} больше прошлой недели` : `На ${formatFocus(Math.abs(delta))} меньше прошлой недели`}`
      : 'Фокус-сессий пока не было';
    focusCard.dataset.tone = focus > 0 && focus >= previousFocus ? 'strong' : '';

    renderHabitProgress();
  }

  function renderHabitProgress() {
    const list = $('#sever109HabitProgressList');
    const label = $('#sever109HabitProgressSummary');
    if (!list || !label) return;
    const habits = state().habits || [];
    list.replaceChildren();
    if (!habits.length) {
      const empty = document.createElement('div');
      empty.className = 'sever109-progress-empty';
      empty.textContent = 'Создай привычку — здесь появится её история за 30 дней, текущая и лучшая серии.';
      list.appendChild(empty);
      label.textContent = 'История появится после первой привычки';
      return;
    }

    label.textContent = `${aggregateHabitRate()}% регулярности · ${habits.length} ${plural(habits.length, 'привычка', 'привычки', 'привычек')}`;
    habits.forEach(habit => {
      const checks = checksFor(habit.id);
      const row = document.createElement('article');
      row.className = 'sever109-habit-progress-row';
      const current = habitCurrentStreak(habit);
      const best = habitBestStreak(habit);
      const rate = habitThirtyDayRate(habit);
      row.innerHTML = `
        <div class="sever109-habit-progress-name"><b></b><small>Сейчас ${current} · рекорд ${best}</small></div>
        <div class="sever109-habit-dots" aria-hidden="true"></div>
        <strong class="sever109-habit-progress-score">${rate}%</strong>`;
      row.querySelector('.sever109-habit-progress-name b').textContent = habit.title;
      const dots = row.querySelector('.sever109-habit-dots');
      const start = habitStartDate(habit);
      for (let offset = 29; offset >= 0; offset -= 1) {
        const date = addDays(today(), -offset);
        const dot = document.createElement('i');
        dot.className = `sever109-habit-dot${checks.has(date) ? ' done' : ''}${date < start ? ' before-start' : ''}`;
        dot.title = `${prettyDate(date)} · ${date < start ? 'до создания привычки' : checks.has(date) ? 'выполнено' : 'не отмечено'}`;
        dots.appendChild(dot);
      }
      row.setAttribute('aria-label', `${habit.title}: ${rate}% за последние 30 дней, текущая серия ${current}, лучшая серия ${best}`);
      list.appendChild(row);
    });
  }

  function ensureHabitHistoryBar() {
    const list = $('#habitList');
    if (!list) return null;
    let bar = $('#sever109HabitHistoryBar');
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'sever109HabitHistoryBar';
    bar.className = 'sever109-habit-history-bar';
    bar.innerHTML = `
      <button type="button" data-week="prev" aria-label="Предыдущая неделя">‹</button>
      <div class="sever109-habit-history-copy"><small>ИСТОРИЯ</small><b id="sever109HabitWeekLabel"></b></div>
      <button type="button" data-week="next" aria-label="Следующая неделя">›</button>
      <button type="button" class="sever109-habit-current" data-week="current">Текущая неделя</button>`;
    list.before(bar);
    bar.querySelector('[data-week="prev"]').addEventListener('click', () => {
      habitWeekOffset -= 1;
      renderHabitDecorations();
    });
    bar.querySelector('[data-week="next"]').addEventListener('click', () => {
      if (habitWeekOffset >= 0) return;
      habitWeekOffset += 1;
      if (habitWeekOffset === 0) window.SeverApp?.render?.();
      else renderHabitDecorations();
    });
    bar.querySelector('[data-week="current"]').addEventListener('click', () => {
      if (habitWeekOffset === 0) return;
      habitWeekOffset = 0;
      window.SeverApp?.render?.();
    });
    return bar;
  }

  function renderHistoryWeek(card, habit) {
    const week = card.querySelector('.habit-week');
    if (!week || habitWeekOffset === 0) return;
    if (week.dataset.sever109Week === String(habitWeekOffset)) return;
    const start = weekStart();
    const checks = checksFor(habit.id);
    week.replaceChildren();
    week.classList.add('sever109-history-week');
    week.dataset.sever109Week = String(habitWeekOffset);
    week.setAttribute('aria-label', `История привычки «${habit.title}» за выбранную неделю`);
    ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].forEach((day, index) => {
      const date = addDays(start, index);
      const done = checks.has(date);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `habit-day${done ? ' done' : ''}`;
      button.disabled = true;
      button.dataset.date = date;
      button.dataset.day = day;
      button.setAttribute('aria-pressed', String(done));
      button.setAttribute('aria-label', `${habit.title}: ${prettyDate(date)} — ${done ? 'выполнено' : 'не отмечено'}`);
      button.innerHTML = `<span>${day}</span><b>${fromIso(date).getDate()}</b><i aria-hidden="true">${done ? '✓' : ''}</i>`;
      week.appendChild(button);
    });
    const doneCount = [...checks].filter(date => date >= start && date <= addDays(start, 6)).length;
    const total = card.querySelector('.habit-week-total');
    if (total) total.textContent = `${doneCount}/7`;
    const help = card.querySelector('.habit-help');
    if (help) help.textContent = 'Прошлая неделя · история сохранена';
  }

  function addHabitMetrics(card, habit) {
    let metrics = card.querySelector('.sever109-habit-metrics');
    if (!metrics) {
      metrics = document.createElement('div');
      metrics.className = 'sever109-habit-metrics';
      card.appendChild(metrics);
    }
    const current = habitCurrentStreak(habit);
    const best = habitBestStreak(habit);
    const rate = habitThirtyDayRate(habit);
    metrics.innerHTML = `
      <span class="sever109-habit-metric streak"><b>${current}</b> сейчас</span>
      <span class="sever109-habit-metric"><b>${best}</b> рекорд</span>
      <span class="sever109-habit-metric history"><b>${rate}%</b> регулярность</span>`;
  }

  function renderHabitDecorations() {
    habitFrame = 0;
    const bar = ensureHabitHistoryBar();
    if (!bar) return;
    const start = weekStart();
    const end = addDays(start, 6);
    const label = $('#sever109HabitWeekLabel');
    if (label) label.textContent = habitWeekOffset === 0 ? `Текущая · ${prettyDate(start)} — ${prettyDate(end)}` : `${prettyDate(start)} — ${prettyDate(end)}`;
    const next = bar.querySelector('[data-week="next"]');
    if (next) next.disabled = habitWeekOffset >= 0;
    const current = bar.querySelector('[data-week="current"]');
    if (current) current.disabled = habitWeekOffset === 0;

    const habits = state().habits || [];
    $$('#habitList > .habit').forEach((card, index) => {
      const habit = habits[index];
      if (!habit) return;
      addHabitMetrics(card, habit);
      renderHistoryWeek(card, habit);
    });
    scheduleProgress();
  }

  function polishMissedTasks() {
    missedFrame = 0;
    $$('#missedTasksBlock .missed-check').forEach(button => {
      if (button.textContent) button.textContent = '';
      button.dataset.state = 'pending';
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', 'Отметить пропущенную задачу выполненной');
      button.title = 'Отметить выполненной';
    });
  }

  function refreshOpenDay(date) {
    const dialog = $('#dayDialog');
    if (!dialog?.open || !date) return;
    const cell = $(`#calendar > .day[data-sever-date="${date}"]`);
    if (!cell) return;
    dialog.close();
    cell.click();
  }

  function scheduleDayRefresh(date) {
    clearTimeout(dayRefreshTimer);
    dayRefreshTimer = setTimeout(() => refreshOpenDay(date), 0);
  }

  function installDayDialogRepair() {
    if (document.documentElement.dataset.sever109DayRepair === 'ready') return;
    document.documentElement.dataset.sever109DayRepair = 'ready';
    document.addEventListener('click', event => {
      const dialog = $('#dayDialog');
      if (!dialog?.open) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('#dayTaskList .check, #toast button')) return;
      const date = window.SeverApp?.getContext?.().selectedDate || '';
      scheduleDayRefresh(date);
    }, true);
  }

  function scheduleHabitDecorations() {
    if (habitFrame) return;
    habitFrame = requestAnimationFrame(renderHabitDecorations);
  }

  function scheduleProgress() {
    if (progressFrame) return;
    progressFrame = requestAnimationFrame(renderProgressSummary);
  }

  function scheduleMissed() {
    if (missedFrame) return;
    missedFrame = requestAnimationFrame(polishMissedTasks);
  }

  function installObservers() {
    const habits = $('#habitList');
    if (habits && !habitObserver) {
      habitObserver = new MutationObserver(scheduleHabitDecorations);
      habitObserver.observe(habits, { childList: true });
    }

    const stats = $('#progressView .stats');
    if (stats && !progressObserver) {
      progressObserver = new MutationObserver(scheduleProgress);
      progressObserver.observe(stats, { childList: true, subtree: true, characterData: true });
    }

    const todayView = $('#todayView');
    if (todayView && !todayObserver) {
      todayObserver = new MutationObserver(records => {
        if (records.some(record => record.type === 'childList')) scheduleMissed();
      });
      todayObserver.observe(todayView, { childList: true, subtree: true });
    }
  }

  function boot() {
    if (!window.SeverApp?.getState || !$('#progressView') || !$('#habitList') || !$('#todayView')) return false;
    installObservers();
    installDayDialogRepair();
    ensureProgressSummary();
    ensureHabitProgress();
    ensureHabitHistoryBar();
    scheduleHabitDecorations();
    scheduleProgress();
    scheduleMissed();
    document.documentElement.dataset.severProgressHabits = 'ready';
    document.documentElement.dataset.severProgressHabitsVersion = 'v109';
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

  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest('[data-view="progress"], #desktopOpenProgress')) scheduleProgress();
    if (target.closest('[data-view="habits"], #desktopOpenHabits')) scheduleHabitDecorations();
    if (target.closest('#missedTasksBlock, #toast button, #dayTaskList')) {
      scheduleMissed();
      scheduleProgress();
    }
  }, true);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleBoot, { once: true });
  else scheduleBoot();
  window.addEventListener('load', scheduleBoot, { once: true });
  window.addEventListener('sever:ready', scheduleBoot);
})();
