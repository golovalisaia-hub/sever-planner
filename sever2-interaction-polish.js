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
  let stalePushChecked = false;

  const state = () => window.SeverApp?.getState?.() || { tasks: [] };

  function installReminderLayer() {
    if (!document.querySelector('link[data-sever2-reminders]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'sever2-reminders.css?v=82';
      link.dataset.sever2Reminders = 'v82';
      document.head.appendChild(link);
    }
    if (!document.querySelector('script[data-sever2-reminders]')) {
      const script = document.createElement('script');
      script.src = 'sever2-task-reminders.js?v=82';
      script.async = false;
      script.defer = true;
      script.dataset.sever2Reminders = 'v82';
      document.head.appendChild(script);
    }
  }

  async function retireStalePushSubscription() {
    if (stalePushChecked) return;
    if (!window.SeverSupabase?.getClient || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    stalePushChecked = true;
    try {
      const client = await window.SeverSupabase.getClient();
      const sessionResult = await client.auth.getSession();
      if (sessionResult.data?.session) return;
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager?.getSubscription();
      await subscription?.unsubscribe();
      const current = state();
      if (current.pushReminders) current.pushReminders.enabled = false;
    } catch {
      stalePushChecked = false;
    }
  }

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
      cell.querySelectorAll(':scope > .sever2-day-status').forEach(status => status.remove());
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

  function calendarNeedsPolish() {
    return $$('#calendar > .day').some(cell => {
      const date = cell.dataset.severDate;
      if (!date) return false;
      const summary = taskSummaryFor(date);
      const status = cell.querySelector(':scope > .sever2-v78-status');
      return summary.total > 0 ? !status : Boolean(status);
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
        const rebuilt = records.some(record => record.type === 'childList' && record.target === calendar);
        if (rebuilt || calendarNeedsPolish()) scheduleCalendar();
      });
      calendarObserver.observe(calendar, { childList: true, subtree: true });
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
    void retireStalePushSubscription();
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

  installReminderLayer();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleBoot, { once: true });
  else scheduleBoot();
  window.addEventListener('load', scheduleBoot, { once: true });
  window.addEventListener('sever:ready', () => {
    scheduleBoot();
    scheduleCalendar();
    scheduleChecks();
    void retireStalePushSubscription();
  });
  window.addEventListener('sever:cloud-ready', () => void retireStalePushSubscription());
})();