(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  let bootAttempts = 0;
  let bootTimer = 0;
  let bound = false;
  let healthTimer = 0;
  let healthPromise = null;

  function retireLegacyState() {
    const current = window.SeverApp?.getState?.();
    if (!current) return false;
    let changed = false;
    current.reminders ??= { enabled:false, time:'19:00', lastDate:'' };
    if (current.reminders.enabled) {
      current.reminders.enabled = false;
      changed = true;
    }
    if (current.reminders.lastDate) {
      current.reminders.lastDate = '';
      changed = true;
    }
    current.pushReminders ??= { enabled:false, dayBefore:true, fifteenMinutes:true, legacyRetired:true };
    if (current.pushReminders.legacyRetired !== true) {
      current.pushReminders.legacyRetired = true;
      changed = true;
    }
    if (changed) void window.SeverApp?.persist?.().catch?.(() => {});
    return changed;
  }

  function detachLegacySettingsBridges() {
    const master = $('#settingsNotificationToggle');
    const legacyTime = $('#settingsNotificationTime');
    const test = $('#settingsTestNotification');
    const guide = $('#settingsGuide');
    if (master) master.onchange = null;
    if (legacyTime) legacyTime.onchange = null;
    if (test) test.onclick = null;
    if (guide) guide.onclick = null;
    return master;
  }

  // mobile-ui predates task Web Push and still mirrors the old hidden daily
  // reminder checkbox into Settings. Once v82 owns the visible Settings switch,
  // make the retired source read the visible switch instead. The old core may
  // continue writing its hidden checkbox, but those writes can no longer race
  // the task-reminder state back into the UI during resize/view mutations.
  function isolateLegacyReminderMirror(master) {
    const legacy = $('#notificationToggle');
    if (!legacy || !master || legacy.dataset.severPushProxy === 'true') return;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
    if (!descriptor?.get || !descriptor?.set) return;
    try {
      Object.defineProperty(legacy, 'checked', {
        configurable: true,
        get() { return descriptor.get.call(master); },
        set(value) { descriptor.set.call(this, Boolean(value)); }
      });
      legacy.dataset.severPushProxy = 'true';
    } catch {}
  }

  function taskStamp(date, time) {
    if (!date || !time) return NaN;
    return new Date(`${String(date).slice(0,10)}T${String(time).slice(0,8)}`).getTime();
  }

  function futureLocalTimedTasks() {
    const now = Date.now();
    const tasks = window.SeverApp?.getState?.()?.tasks || [];
    return tasks.filter(task => {
      if (!task || task.completed || task.deletedAt || task.deleted_at) return false;
      const stamp = taskStamp(task.date || task.scheduled_for, task.time || task.scheduled_time);
      return Number.isFinite(stamp) && stamp > now;
    }).length;
  }

  function taskWord(count) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return 'задача';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'задачи';
    return 'задач';
  }

  async function refreshReminderHealth() {
    if (healthPromise) return healthPromise;
    healthPromise = (async () => {
      const master = $('#settingsNotificationToggle');
      const status = $('#severReminderStatus');
      if (!master?.checked || !status || !window.SeverSupabase?.getClient) return;

      try {
        const client = await window.SeverSupabase.getClient();
        const session = await client.auth.getSession();
        const user = session.data?.session?.user;
        if (!user) return;

        const result = await client.from('tasks')
          .select('scheduled_for,scheduled_time,completed,deleted_at')
          .eq('user_id', user.id)
          .eq('completed', false)
          .is('deleted_at', null)
          .not('scheduled_for', 'is', null)
          .not('scheduled_time', 'is', null);
        if (result.error) return;

        const now = Date.now();
        const cloudCount = (result.data || []).filter(task => {
          const stamp = taskStamp(task.scheduled_for, task.scheduled_time);
          return Number.isFinite(stamp) && stamp > now;
        }).length;
        const localCount = futureLocalTimedTasks();

        if (cloudCount > 0) {
          status.textContent = `Подписка работает · ${cloudCount} ${taskWord(cloudCount)} с временем ${cloudCount === 1 ? 'готова' : 'готовы'} к напоминаниям.`;
          status.dataset.kind = 'ok';
        } else if (localCount > 0) {
          status.textContent = `Уведомления включены, но ${localCount} ${taskWord(localCount)} с временем ещё ${localCount === 1 ? 'не появилась' : 'не появились'} в облаке. Проверьте синхронизацию.`;
          status.dataset.kind = 'warning';
        } else {
          status.textContent = 'Подписка работает · пока нет будущих задач с датой и временем.';
          status.dataset.kind = 'neutral';
        }
        document.documentElement.dataset.severReminderHealth = 'v111';
      } catch {
        // The v82 reminder layer already reports connection/auth failures. Health
        // diagnostics are intentionally additive and never replace that warning.
      }
    })().finally(() => { healthPromise = null; });
    return healthPromise;
  }

  function scheduleReminderHealth(delay = 450) {
    clearTimeout(healthTimer);
    healthTimer = setTimeout(() => void refreshReminderHealth(), delay);
  }

  function boot() {
    if (!window.SeverApp?.getState || document.documentElement.dataset.severReminders !== 'v82') return false;
    const master = detachLegacySettingsBridges();
    if (!master) return false;

    retireLegacyState();
    isolateLegacyReminderMirror(master);
    if (!bound) {
      bound = true;
      master.addEventListener('change', () => {
        queueMicrotask(retireLegacyState);
        scheduleReminderHealth(800);
      });
      window.addEventListener('sever:ready', () => {
        retireLegacyState();
        scheduleReminderHealth();
      });
      window.addEventListener('sever:cloud-ready', () => {
        retireLegacyState();
        scheduleReminderHealth(700);
      });
      window.addEventListener('focus', () => scheduleReminderHealth(700));
    }

    document.documentElement.dataset.severReminderBridge = 'v98';
    scheduleReminderHealth();
    return true;
  }

  function scheduleBoot() {
    if (boot()) {
      clearTimeout(bootTimer);
      return;
    }
    if (bootAttempts++ >= 180) return;
    clearTimeout(bootTimer);
    bootTimer = setTimeout(scheduleBoot, 50);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleBoot, { once:true });
  else scheduleBoot();
  window.addEventListener('load', scheduleBoot, { once:true });
  window.addEventListener('sever:ready', scheduleBoot);
})();
