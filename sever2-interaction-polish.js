(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  let bootAttempts = 0;
  let bootTimer = 0;
  let calendarObserver = null;
  let taskObserver = null;
  let habitObserver = null;
  let calendarQueued = false;
  let checksQueued = false;

  const state = () => window.SeverApp?.getState?.() || { tasks: [] };

  function taskSummaryFor(date) {
    const tasks = (state().tasks || []).filter(task => task?.date === date);
    const done = tasks.filter(task => task.completed).length;
    return { total: tasks.length, done, pending: tasks.length - done };
  }

  function polishCalendar() {
    calendarQueued = false;
    $$('#calendar > .day').forEach(cell => {
      const date = cell.dataset.severDate;
      if (!date) return;
      const summary = taskSummaryFor(date);
      cell.querySelector('.sever2-day-status')?.remove();
      if (!summary.total) return;

      const status = document.createElement('div');
      status.className = `sever2-day-status sever2-v78-status${summary.pending ? '' : ' all-done'}`;
      status.setAttribute('aria-hidden', 'true');
      status.title = `${summary.total} ${summary.total === 1 ? 'задача' : summary.total < 5 ? 'задачи' : 'задач'}`;

      const dot = document.createElement('i');
      dot.className = 'sever2-v78-task-dot';
      const count = document.createElement('b');
      count.textContent = String(summary.total);
      status.append(dot, count);
      cell.appendChild(status);
    });
  }

  function scheduleCalendar() {
    if (calendarQueued) return;
    calendarQueued = true;
    requestAnimationFrame(polishCalendar);
  }

  function syncTaskChecks() {
    checksQueued = false;
    $$('.task').forEach(task => {
      const check = task.querySelector('.check');
      if (!check) return;
      const done = task.classList.contains('done');
      check.setAttribute('aria-pressed', String(done));
      check.setAttribute('aria-label', done ? 'Отметить задачу как невыполненную' : 'Отметить задачу выполненной');
      check.title = done ? 'Задача выполнена' : 'Отметить выполненной';
    });
  }

  function scheduleChecks() {
    if (checksQueued) return;
    checksQueued = true;
    requestAnimationFrame(syncTaskChecks);
  }

  function installObservers() {
    const calendar = $('#calendar');
    if (calendar && !calendarObserver) {
      calendarObserver = new MutationObserver(records => {
        if (records.some(record => record.type === 'childList' && record.target === calendar)) scheduleCalendar();
      });
      calendarObserver.observe(calendar, { childList: true });
    }

    const tasks = $('#todayTasks');
    if (tasks && !taskObserver) {
      taskObserver = new MutationObserver(scheduleChecks);
      taskObserver.observe(tasks, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }

    const habits = $('#habitList');
    if (habits && !habitObserver) {
      habitObserver = new MutationObserver(() => {
        document.querySelectorAll('.habit-week .habit-day').forEach(button => {
          const done = button.classList.contains('done');
          button.setAttribute('aria-pressed', String(done));
        });
      });
      habitObserver.observe(habits, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }
  }

  function boot() {
    if (!window.SeverApp?.getState || !$('#calendar') || !$('#todayTasks') || !$('#habitList')) return false;
    installObservers();
    scheduleCalendar();
    scheduleChecks();
    document.documentElement.dataset.severInteractionPolish = 'ready';
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
  window.addEventListener('sever:ready', () => {
    scheduleBoot();
    scheduleCalendar();
    scheduleChecks();
  });
})();
