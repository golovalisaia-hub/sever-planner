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
  let habitChecksQueued = false;
  const pendingTaskCards = new Set();
  const pendingHabitButtons = new Set();
  const taskCheckGestures = new WeakMap();

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

  function installProgressHabitsV109Layer() {
    if (!document.querySelector('link[data-sever-progress-habits-v109]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'sever2-progress-habits-v109.css?v=109';
      link.dataset.severProgressHabitsV109 = 'true';
      document.head.appendChild(link);
    }
    if (!document.querySelector('script[data-sever-progress-habits-v109]')) {
      const script = document.createElement('script');
      script.src = 'sever2-progress-habits-v109.js?v=109';
      script.async = false;
      script.defer = true;
      script.dataset.severProgressHabitsV109 = 'true';
      document.head.appendChild(script);
    }
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

  function installTaskInputStyles() {
    if (document.querySelector('style[data-sever-task-input-v113]')) return;
    const style = document.createElement('style');
    style.dataset.severTaskInputV113 = 'true';
    style.textContent = `
      .task,
      .task .check,
      .task .task-open,
      .task .edit,
      .task .task-name,
      .task .task-meta {
        -webkit-user-select: none !important;
        user-select: none !important;
        -webkit-touch-callout: none !important;
      }
      .task .check,
      .task .task-open,
      .task .edit {
        touch-action: manipulation;
        -webkit-tap-highlight-color: transparent;
      }
    `;
    document.head.appendChild(style);
  }

  function taskSummaryFor(date) {
    const tasks = (state().tasks || []).filter(task => task?.date === date);
    const done = tasks.filter(task => task.completed).length;
    return { total: tasks.length, done, pending: tasks.length - done };
  }

  function validCalendarStatus(status) {
    return status instanceof HTMLElement
      && status.matches('div.sever2-day-status.sever2-v78-status')
      && Boolean(status.querySelector(':scope > .sever2-v78-task-dot'))
      && Boolean(status.querySelector(':scope > b'));
  }

  function polishCalendar() {
    calendarQueued = false;
    $$('#calendar > .day').forEach(cell => {
      const date = cell.dataset.severDate;
      if (!date) return;
      const summary = taskSummaryFor(date);
      const statuses = [...cell.querySelectorAll(':scope > .sever2-day-status')];

      if (!summary.total) {
        statuses.forEach(status => status.remove());
        return;
      }

      let status = statuses.find(validCalendarStatus) || null;
      statuses.forEach(candidate => {
        if (candidate !== status) candidate.remove();
      });

      if (!status) {
        status = document.createElement('div');
        status.setAttribute('aria-hidden', 'true');
        const dot = document.createElement('i');
        dot.className = 'sever2-v78-task-dot';
        const count = document.createElement('b');
        status.append(dot, count);
        cell.appendChild(status);
      }

      status.className = `sever2-day-status sever2-v78-status${summary.pending ? '' : ' all-done'}`;
      status.setAttribute('aria-hidden', 'true');
      status.title = `${summary.total} ${summary.total === 1 ? 'задача' : summary.total < 5 ? 'задачи' : 'задач'}`;
      const count = status.querySelector(':scope > b');
      if (count && count.textContent !== String(summary.total)) count.textContent = String(summary.total);
    });
  }

  function calendarNeedsPolish() {
    return $$('#calendar > .day').some(cell => {
      const date = cell.dataset.severDate;
      if (!date) return false;
      const summary = taskSummaryFor(date);
      const statuses = [...cell.querySelectorAll(':scope > .sever2-day-status')];
      if (!summary.total) return statuses.length > 0;
      if (statuses.length !== 1 || !validCalendarStatus(statuses[0])) return true;
      const status = statuses[0];
      const count = status.querySelector(':scope > b');
      const allDone = !summary.pending;
      return status.classList.contains('all-done') !== allDone
        || count?.textContent !== String(summary.total)
        || status.title !== `${summary.total} ${summary.total === 1 ? 'задача' : summary.total < 5 ? 'задачи' : 'задач'}`;
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

  function hardenTaskCheck(check) {
    if (!(check instanceof HTMLElement) || taskCheckGestures.has(check)) return;
    const gesture = { sequence: 0, consumed: 0, pointerAt: 0 };
    taskCheckGestures.set(check, gesture);

    check.addEventListener('pointerdown', event => {
      if (event.pointerType === 'touch' || event.pointerType === 'pen') {
        gesture.sequence += 1;
        gesture.pointerAt = performance.now();
      }
      const selection = window.getSelection?.();
      if (selection?.rangeCount) selection.removeAllRanges();
    }, { passive: true });

    check.addEventListener('click', event => {
      const fromRecentPointer = gesture.sequence > 0 && performance.now() - gesture.pointerAt < 900;
      if (fromRecentPointer && gesture.consumed === gesture.sequence) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (fromRecentPointer) gesture.consumed = gesture.sequence;
      event.stopPropagation();
    }, true);

    check.addEventListener('selectstart', event => event.preventDefault());
    check.addEventListener('contextmenu', event => event.preventDefault());
  }

  function syncTaskCard(task) {
    if (!task?.isConnected) return;
    const check = task.querySelector('.check');
    if (!check) return;
    hardenTaskCheck(check);
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

  function queueHabitButton(node) {
    if (!(node instanceof Element)) return;
    if (node.matches('.habit-day')) pendingHabitButtons.add(node);
    node.querySelectorAll?.('.habit-day').forEach(button => pendingHabitButtons.add(button));
  }

  function syncHabitButton(button) {
    if (!(button instanceof Element) || !button.matches('.habit-day') || !button.isConnected) return;
    const done = button.classList.contains('done');
    button.setAttribute('aria-pressed', String(done));
  }

  function syncHabitChecks() {
    habitChecksQueued = false;
    const buttons = [...pendingHabitButtons];
    pendingHabitButtons.clear();
    buttons.forEach(syncHabitButton);
  }

  function scheduleHabitChecks() {
    if (habitChecksQueued || !pendingHabitButtons.size) return;
    habitChecksQueued = true;
    requestAnimationFrame(syncHabitChecks);
  }

  function syncHabitMutationRecords(records) {
    records.forEach(record => {
      if (record.type === 'attributes') queueHabitButton(record.target);
      record.addedNodes.forEach(queueHabitButton);
    });
    scheduleHabitChecks();
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
      habits.querySelectorAll('.habit-day').forEach(button => pendingHabitButtons.add(button));
      scheduleHabitChecks();
    }
  }

  function boot() {
    if (!window.SeverApp?.getState || !$('#calendar') || !$('#todayTasks') || !$('#habitList')) return false;
    installTaskInputStyles();
    installObservers();
    scheduleCalendar();
    document.documentElement.dataset.severInteractionPolish = 'ready';
    document.documentElement.dataset.severInteractionPolishVersion = 'v113';
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
  installProgressHabitsV109Layer();
  installAutumnMobileFlightAnchor();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleBoot, { once: true });
  else scheduleBoot();
  window.addEventListener('load', scheduleBoot, { once: true });
  window.addEventListener('sever:ready', () => {
    scheduleBoot();
    scheduleCalendar();
    $('#todayTasks')?.querySelectorAll('.task').forEach(card => pendingTaskCards.add(card));
    scheduleChecks();
    $('#habitList')?.querySelectorAll('.habit-day').forEach(button => pendingHabitButtons.add(button));
    scheduleHabitChecks();
  });
})();