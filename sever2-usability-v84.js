(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  let bootAttempts = 0;
  let bootTimer = 0;
  let moneyObserver = null;
  let guideObserver = null;
  let reconcileRunning = false;
  let powerUserInstalled = false;
  let settingsDetails = null;
  let settingsRecords = [];
  const rapidSubmitAt = new WeakMap();
  const rapidClickAt = new WeakMap();
  const mobileSettings = window.matchMedia('(max-width: 700px)');
  const RAPID_GUARD_MS = 450;

  const state = () => window.SeverApp?.getState?.() || null;
  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const amount = value => Math.max(0, Number(value) || 0);
  const text = value => String(value || '');

  function moneyItems() {
    const current = state();
    const items = current?.profile?.money?.items;
    return Array.isArray(items) ? items : [];
  }

  function itemById(id) {
    return moneyItems().find(item => String(item.id) === String(id)) || null;
  }

  function pendingTaskIds(item) {
    const current = state();
    if (!current || !Array.isArray(item?.calendarTaskIds)) return [];
    const tasks = new Map((current.tasks || []).map(task => [String(task.id), task]));
    return item.calendarTaskIds.map(String).filter(id => {
      const task = tasks.get(id);
      return task && !task.completed;
    });
  }

  function clearPendingSchedule(item) {
    const current = state();
    if (!current || !item) return false;
    const ids = new Set((item.calendarTaskIds || []).map(String));
    if (!ids.size) return false;
    const before = current.tasks.length;
    current.tasks = (current.tasks || []).filter(task => !ids.has(String(task.id)) || task.completed);
    const changed = current.tasks.length !== before || item.calendarTaskIds.length > 0;
    item.calendarTaskIds = [];
    if (changed) item.updatedAt = Date.now();
    return changed;
  }

  function pruneFinishedScheduleRefs(item) {
    const current = state();
    if (!current || !item || !Array.isArray(item.calendarTaskIds) || !item.calendarTaskIds.length) return false;
    const tasks = new Map((current.tasks || []).map(task => [String(task.id), task]));
    const next = item.calendarTaskIds.map(String).filter(id => {
      const task = tasks.get(id);
      return task && !task.completed;
    });
    if (next.length === item.calendarTaskIds.length && next.every((id, index) => id === String(item.calendarTaskIds[index]))) return false;
    item.calendarTaskIds = next;
    item.updatedAt = Date.now();
    return true;
  }

  function scheduleIsStale(item) {
    if (!item) return false;
    if (amount(item.currentAmount) >= amount(item.targetAmount) && amount(item.targetAmount) > 0) return true;
    return /^\d{4}-\d{2}-\d{2}$/.test(item.deadline || '') && item.deadline < todayISO();
  }

  function planningFieldsChanged(item) {
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

  async function persistMoneyCleanup() {
    try {
      await window.SeverApp?.persist?.();
      window.SeverCloud?.capture?.();
      window.SeverCloud?.syncSoon?.(0);
    } catch {}
  }

  async function reconcileSchedules({ persist = true } = {}) {
    if (reconcileRunning) return false;
    reconcileRunning = true;
    try {
      let changed = false;
      for (const item of moneyItems()) {
        if (scheduleIsStale(item)) changed = clearPendingSchedule(item) || changed;
        else changed = pruneFinishedScheduleRefs(item) || changed;
      }
      if (changed && persist) await persistMoneyCleanup();
      if (changed && $('#moneyView')?.classList.contains('active')) window.SeverMoney?.render?.();
      return changed;
    } finally {
      reconcileRunning = false;
    }
  }

  function rapidSubmitGuard(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.closest('main, dialog')) return;
    const current = performance.now();
    const previous = rapidSubmitAt.get(form) || -Infinity;
    if (current - previous < RAPID_GUARD_MS) {
      event.preventDefault();
      event.stopImmediatePropagation();
      form.dataset.severRapidBlocked = 'true';
      window.setTimeout(() => delete form.dataset.severRapidBlocked, RAPID_GUARD_MS);
      return;
    }
    rapidSubmitAt.set(form, current);
    form.dataset.severSubmitting = 'true';
    form.setAttribute('aria-busy', 'true');
    window.setTimeout(() => {
      if ((performance.now() - (rapidSubmitAt.get(form) || 0)) < RAPID_GUARD_MS - 40) return;
      delete form.dataset.severSubmitting;
      form.removeAttribute('aria-busy');
    }, RAPID_GUARD_MS + 25);
  }

  function rapidClickGuard(event) {
    const target = event.target instanceof Element
      ? event.target.closest('.task .check, #timerToggle, #todayFocusToggle, #moneyScheduleConfirm')
      : null;
    if (!(target instanceof HTMLElement)) return;
    const current = performance.now();
    const previous = rapidClickAt.get(target) || -Infinity;
    if (current - previous < RAPID_GUARD_MS) {
      event.preventDefault();
      event.stopImmediatePropagation();
      target.dataset.severRapidBlocked = 'true';
      window.setTimeout(() => delete target.dataset.severRapidBlocked, RAPID_GUARD_MS);
      return;
    }
    rapidClickAt.set(target, current);
  }

  function settingsTitle(section) {
    return section.querySelector(':scope > small')?.textContent?.trim().toUpperCase() || '';
  }

  function mountAdvancedSettings() {
    if (!mobileSettings.matches || settingsDetails) return;
    const list = $('#settingsView .settings-list');
    if (!list) return;
    const advanced = [...list.querySelectorAll(':scope > .settings-section')].filter(section =>
      ['БЕЗОПАСНОСТЬ', 'ДАННЫЕ', 'SEVER AI', 'ОПАСНАЯ ЗОНА'].includes(settingsTitle(section))
    );
    if (!advanced.length) return;

    const details = document.createElement('details');
    details.id = 'severSettingsAdvanced';
    details.className = 'sever-settings-advanced';
    const summary = document.createElement('summary');
    summary.innerHTML = '<span><b>Дополнительно</b><em>Безопасность, данные, SEVER AI и сброс</em></span><i aria-hidden="true">›</i>';
    details.appendChild(summary);
    list.insertBefore(details, advanced[0]);

    settingsRecords = advanced.map((section, index) => {
      const marker = document.createComment(`sever-settings-${index}`);
      list.insertBefore(marker, section);
      details.appendChild(section);
      return { section, marker };
    });
    settingsDetails = details;
    try { details.open = sessionStorage.getItem('sever-settings-advanced-open') === '1'; } catch {}
    details.addEventListener('toggle', () => {
      try { sessionStorage.setItem('sever-settings-advanced-open', details.open ? '1' : '0'); } catch {}
    });
  }

  function unmountAdvancedSettings() {
    if (!settingsDetails) return;
    for (const { section, marker } of settingsRecords) {
      marker.parentNode?.insertBefore(section, marker.nextSibling);
      marker.remove();
    }
    settingsRecords = [];
    settingsDetails.remove();
    settingsDetails = null;
  }

  function syncAdvancedSettings() {
    if (mobileSettings.matches) mountAdvancedSettings();
    else unmountAdvancedSettings();
  }

  function installPowerUserHardening() {
    if (!powerUserInstalled) {
      powerUserInstalled = true;
      mobileSettings.addEventListener?.('change', syncAdvancedSettings);
    }
    syncAdvancedSettings();
    document.documentElement.dataset.severPowerUser = 'v91';
  }

  function handleCaptureSubmit(event) {
    if (event.target?.id === 'moneyItemForm') {
      const existing = itemById($('#moneyItemId')?.value);
      if (existing && planningFieldsChanged(existing)) clearPendingSchedule(existing);
      return;
    }
    if (event.target?.id === 'moneyProgressForm') {
      const item = itemById($('#moneyProgressId')?.value);
      const delta = amount($('#moneyProgressAmount')?.value);
      if (item && delta > 0 && amount(item.currentAmount) + delta >= amount(item.targetAmount)) clearPendingSchedule(item);
    }
  }

  function handleCaptureClick(event) {
    const deleteButton = event.target instanceof Element ? event.target.closest('#moneyItemDelete') : null;
    if (deleteButton?.dataset.confirm === 'true') {
      const item = itemById($('#moneyItemId')?.value);
      if (item) clearPendingSchedule(item);
      return;
    }
    const moneyNav = event.target instanceof Element
      ? event.target.closest('[data-view="money"], [data-menu-view="money"]')
      : null;
    if (moneyNav) void reconcileSchedules();
  }

  function polishGuideCopy() {
    const dialog = $('#tourDialog');
    if (!dialog?.open || dialog.dataset.step !== '5') return;
    const title = $('#tourTitle');
    const copy = $('#tourText');
    if (title) title.textContent = 'Всё под рукой';
    if (copy) copy.textContent = 'Главная — дела на сегодня. Календарь — планы и история, Заметки — мысли и чек-листы, а в «Ещё» находятся Фокус, Привычки, Деньги и настройки. Этот гид всегда можно открыть снова в Настройках.';
  }

  function installObservers() {
    const moneyView = $('#moneyView');
    if (moneyView && !moneyObserver) {
      moneyObserver = new MutationObserver(() => {
        if (moneyView.classList.contains('active')) void reconcileSchedules();
      });
      moneyObserver.observe(moneyView, { attributes: true, attributeFilter: ['class'] });
    }

    const guide = $('#tourDialog');
    if (guide && !guideObserver) {
      guideObserver = new MutationObserver(polishGuideCopy);
      guideObserver.observe(guide, { attributes: true, attributeFilter: ['open', 'data-step'] });
      polishGuideCopy();
    }
  }

  function boot() {
    if (!window.SeverApp?.getState || !window.SeverMoney || !$('#moneyView') || !$('#tourDialog')) return false;
    installObservers();
    installPowerUserHardening();
    document.documentElement.dataset.severUsability = 'v84';
    void reconcileSchedules();
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

  document.addEventListener('submit', rapidSubmitGuard, true);
  document.addEventListener('click', rapidClickGuard, true);
  document.addEventListener('submit', handleCaptureSubmit, true);
  document.addEventListener('click', handleCaptureClick, true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void reconcileSchedules();
  });
  window.addEventListener('sever:account-scope', () => void reconcileSchedules({ persist: false }));
  window.addEventListener('sever:cloud-status', () => {
    if ($('#moneyView')?.classList.contains('active')) void reconcileSchedules();
  });
  window.addEventListener('sever:ready', scheduleBoot);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleBoot, { once: true });
  else scheduleBoot();
})();
