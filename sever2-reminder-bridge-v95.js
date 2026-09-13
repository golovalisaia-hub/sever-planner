(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  let bootAttempts = 0;
  let bootTimer = 0;
  let bound = false;

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

  function boot() {
    if (!window.SeverApp?.getState || document.documentElement.dataset.severReminders !== 'v82') return false;
    const master = detachLegacySettingsBridges();
    if (!master) return false;

    retireLegacyState();
    if (!bound) {
      bound = true;
      master.addEventListener('change', () => queueMicrotask(retireLegacyState));
      window.addEventListener('sever:ready', retireLegacyState);
      window.addEventListener('sever:cloud-ready', retireLegacyState);
    }

    document.documentElement.dataset.severReminderBridge = 'v95';
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
