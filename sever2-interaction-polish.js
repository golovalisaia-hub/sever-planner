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
  const pendingTaskCards = new Set();

  const state = () => window.SeverApp?.getState?.() || { tasks: [] };
  const amount = value => Math.max(0, Number(value) || 0);
  const text = value => String(value || '');

  function moneyItemById(id) {
    const items = state()?.profile?.money?.items;
    return Array.isArray(items) ? items.find(item => String(item.id) === String(id)) || null : null;
  }

  function clearPendingMoneySchedule(item) {
    const current = state();
    if (!current || !item || !Array.isArray(item.calendarTaskIds) || !item.calendarTaskIds.length) return false;
    const ids = new Set(item.calendarTaskIds.map(String));
    const before = Array.isArray(current.tasks) ? current.tasks.length : 0;
    current.tasks = (current.tasks || []).filter(task => !ids.has(String(task.id)) || task.completed);
    const changed = current.tasks.length !== before || item.calendarTaskIds.length > 0;
    item.calendarTaskIds = [];
    if (changed) item.updatedAt = Date.now();
    return changed;
  }

  function moneyPlanningFieldsChanged(item) {
    if (!item) return false;
    const type = $('#moneyItemType')?.value === 'goal' ? 'goal' : 'debt';
    const targetAmount = amount($('#moneyItemTarget')?.value);
    const currentAmount = Math.min(targetAmount || Infinity, amount($('#moneyItemCurrent')?.value));
    const title = text($('#moneyItemName')?.value).trim() || (type === 'debt' ? 'Долг' : 'Накопление');
    const deadline = text($('#moneyItemDeadline')?.value);
    const monthlyBudget = amount($('#moneyItemBudget')?.value);
    return item.type !== type
      || item.title !== title
      || amount(item.targetAmount) !== targetAmount
      || amount(item.currentAmount) !== currentAmount
      || text(item.deadline) !== deadline
      || amount(item.monthlyBudget) !== monthlyBudget;
  }

  /* v96.3: Money owns the actual save, but v84 historically retired generated
     calendar tasks only after the dialog closed. That allowed a second async
     persistence pass to race the just-saved Money object on fast phones. Retire
     pending generated tasks synchronously in the capture phase instead; the
     existing Money submit handler then persists the plan + task cleanup once. */
  function guardMoneyLifecycleSubmit(event) {
    if (event.target?.id === 'moneyItemForm') {
      const item = moneyItemById($('#moneyItemId')?.value);
      if (item && moneyPlanningFieldsChanged(item)) clearPendingMoneySchedule(item);
      return;
    }
    if (event.target?.id === 'moneyProgressForm') {
      const item = moneyItemById($('#moneyProgressId')?.value);
      const delta = amount($('#moneyProgressAmount')?.value);
      if (item && delta > 0 && amount(item.currentAmount) + delta >= amount(item.targetAmount)) {
        clearPendingMoneySchedule(item);
      }
    }
  }

  function guardMoneyLifecycleDelete(event) {
    const button = event.target instanceof Element ? event.target.closest('#moneyItemDelete') : null;
    if (button?.dataset.confirm !== 'true') return;
    const item = moneyItemById($('#moneyItemId')?.value);
    if (item) clearPendingMoneySchedule(item);
  }

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
    if (!document.querySelector('script[data-sever2-reminder-bridge]')) {
      const bridge = document.createElement('script');
      bridge.src = 'sever2-reminder-bridge-v95.js?v=95';
      bridge.async = false;
      bridge.defer = true;
      bridge.dataset.sever2ReminderBridge = 'v95';
      document.head.appendChild(bridge);
    }
  }

  function installNotesOrganizationRepair() {
    if (document.querySelector('script[data-sever2-notes-org-repair]')) return;
    const script = document.createElement('script');
    script.src = 'sever2-notes-org-repair-v95.js?v=95';
    script.async = false;
    script.defer = true;
    script.dataset.sever2NotesOrgRepair = 'v95';
    document.head.appendChild(script);
  }

  /* v101 intentionally kept autumn as an 11px signature to the right of the
     mobile wordmark. v103 changes that product decision: the same tiny leaf
     sprites start at the left edge of SEVER and travel across the letters using
     transform-only keyframes from interaction-polish.css. A dedicated late
     style resolves the old higher-specificity phone rule without changing the
     winter/spring/summer signatures. */
  function installAutumnMobileFlightAnchor() {
    if (document.querySelector('style[data-sever-autumn-mobile-v103]')) return;
    const style = document.createElement('style');
    style.dataset.severAutumnMobileV103 = 'true';
    style.textContent = `
      @media (max-width: 900px) {
        html[data-sever-season="autumn"] body .topbar .mobile-wordmark.mobile-wordmark .sever-season-mark[data-season="autumn"] {
          position: absolute !important;
          inset: auto !important;
          left: -4px !important;
          right: auto !important;
          top: 50% !important;
          bottom: auto !important;
          inline-size: 11px !important;
          block-size: 11px !important;
          width: 11px !important;
          min-width: 11px !important;
          max-width: 11px !important;
          height: 11px !important;
          min-height: 11px !important;
          max-height: 11px !important;
          margin: -5.5px 0 0 !important;
          padding: 0 !important;
          overflow: visible !important;
        }
      }
    `;
    document.head.appendChild(style);
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

  function queueTaskCard(node) {
    if (!(node instanceof Element)) return;
    if (node.matches('.task')) pendingTaskCards.add(node);
    node.querySelectorAll?.('.task').forEach(card => pendingTaskCards.add(card));
  }

  function syncTaskCard(task) {
    if (!task?.isConnected) return;
    const check = task.querySelector('.check');
    if (!check) return;
    const done = task.classList.contains('done');
    check.setAttribute('aria-pressed', String(done));
    check.setAttribute('aria-label', done ? 'Отметить задачу как невыполненную' : 'Отметить задачу выполненной');
    check.title = done ? 'Задача выполнена' : 'Отметить выполненной';
  }

  function syncTaskChecks() {
    checksQueued = false;
    const cards = [...pendingTaskCards];
    pendingTaskCards.clear();
    cards.forEach(syncTaskCard);
  }

  function scheduleChecks() {
    if (checksQueued || !pendingTaskCards.size) return;
    checksQueued = true;
    requestAnimationFrame(syncTaskChecks);
  }

  function syncHabitButton(button) {
    if (!(button instanceof Element) || !button.matches('.habit-day')) return;
    const done = button.classList.contains('done');
    button.setAttribute('aria-pressed', String(done));
  }

  function syncHabitMutationRecords(records) {
    records.forEach(record => {
      if (record.type === 'attributes') syncHabitButton(record.target);
      record.addedNodes.forEach(node => {
        if (!(node instanceof Element)) return;
        syncHabitButton(node);
        node.querySelectorAll?.('.habit-day').forEach(syncHabitButton);
      });
    });
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
      taskObserver = new MutationObserver(records => {
        records.forEach(record => {
          if (record.type === 'attributes') queueTaskCard(record.target);
          record.addedNodes.forEach(queueTaskCard);
        });
        scheduleChecks();
      });
      taskObserver.observe(tasks, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      tasks.querySelectorAll('.task').forEach(card => pendingTaskCards.add(card));
      scheduleChecks();
    }

    const habits = $('#habitList');
    if (habits && !habitObserver) {
      habitObserver = new MutationObserver(syncHabitMutationRecords);
      habitObserver.observe(habits, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      habits.querySelectorAll('.habit-day').forEach(syncHabitButton);
    }
  }

  function boot() {
    if (!window.SeverApp?.getState || !$('#calendar') || !$('#todayTasks') || !$('#habitList')) return false;
    installObservers();
    scheduleCalendar();
    document.documentElement.dataset.severInteractionPolish = 'v107';
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

  document.addEventListener('submit', guardMoneyLifecycleSubmit, true);
  document.addEventListener('click', guardMoneyLifecycleDelete, true);
  document.documentElement.dataset.severMoneyLifecycle = 'v96.3';
  installReminderLayer();
  installNotesOrganizationRepair();
  installAutumnMobileFlightAnchor();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleBoot, { once: true });
  else scheduleBoot();
  window.addEventListener('load', scheduleBoot, { once: true });
  window.addEventListener('sever:ready', () => {
    scheduleBoot();
    scheduleCalendar();
    $('#todayTasks')?.querySelectorAll('.task').forEach(card => pendingTaskCards.add(card));
    scheduleChecks();
  });
})();
