(() => {
  'use strict';

  const VAPID_PUBLIC_KEY = 'BJebqzKOHHkvVsoNnlt4tJpVcvYWFyI93tcLQgO2JJZyDkQ66UsKscOTZsV9NFqqviSZY26lGapm3S7gCV4GsMM';
  const $ = selector => document.querySelector(selector);
  const IOS_RE = /iPad|iPhone|iPod/i;
  let bootAttempts = 0;
  let bootTimer = 0;
  let bound = false;
  let iosRegistration = null;
  let iosSubscription = null;
  let iosReadyPromise = null;
  let healthTimer = 0;
  let healthPromise = null;

  const isIOS = () => IOS_RE.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  const supportsPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

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

  function reminderStatus(text, kind='neutral') {
    const node = $('#severReminderStatus');
    if (!node) return;
    node.textContent = text;
    node.dataset.kind = kind;
  }

  function pushPrefs() {
    const current = window.SeverApp?.getState?.();
    if (!current) return null;
    current.pushReminders ??= { enabled:false, dayBefore:true, fifteenMinutes:true, legacyRetired:true };
    return current.pushReminders;
  }

  function syncPushUi(master) {
    const prefs = pushPrefs();
    if (!prefs) return;
    master.checked = Boolean(prefs.enabled);
    const day = $('#severReminderDayBefore');
    const fifteen = $('#severReminderFifteen');
    if (day) { day.checked = prefs.dayBefore !== false; day.disabled = !prefs.enabled; }
    if (fifteen) { fifteen.checked = prefs.fifteenMinutes !== false; fifteen.disabled = !prefs.enabled; }
    document.documentElement.dataset.severPushEnabled = prefs.enabled ? 'true' : 'false';
  }

  function decodePublicKey(value) {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const raw = atob((value + padding).replace(/-/g,'+').replace(/_/g,'/'));
    return Uint8Array.from(raw, char => char.charCodeAt(0));
  }

  function prewarmIosPush() {
    if (!isIOS() || !supportsPush() || iosReadyPromise) return iosReadyPromise;
    iosReadyPromise = navigator.serviceWorker.ready.then(async registration => {
      iosRegistration = registration;
      try { iosSubscription = await registration.pushManager.getSubscription(); }
      catch { iosSubscription = null; }
      return registration;
    }).catch(() => null);
    return iosReadyPromise;
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

  async function saveIosSubscription(subscription, master) {
    iosSubscription = subscription;
    if (!window.SeverSupabase?.getClient) throw new Error('CLOUD_UNAVAILABLE');
    const client = await window.SeverSupabase.getClient();
    const sessionResult = await client.auth.getSession();
    let user = sessionResult.data?.session?.user || null;
    if (!user) {
      const userResult = await client.auth.getUser();
      user = userResult.data?.user || null;
    }
    if (!user) throw new Error('AUTH_REQUIRED');

    const prefs = pushPrefs();
    const keys = subscription.toJSON().keys || {};
    const result = await client.from('push_subscriptions').upsert({
      user_id:user.id,
      endpoint:subscription.endpoint,
      p256dh:keys.p256dh || '',
      auth:keys.auth || '',
      timezone:Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      user_agent:(navigator.userAgent || '').slice(0,500),
      enabled:true,
      remind_day_before:prefs?.dayBefore !== false,
      remind_15_minutes:prefs?.fifteenMinutes !== false,
      updated_at:new Date().toISOString(),
      last_seen_at:new Date().toISOString()
    }, { onConflict:'user_id,endpoint' });
    if (result.error) throw result.error;

    if (prefs) prefs.enabled = true;
    await window.SeverApp?.persist?.().catch?.(() => {});
    syncPushUi(master);
    reminderStatus('Включено на iPhone · Web Push подключён.', 'ok');
    scheduleReminderHealth(650);
  }

  function iosPushErrorText(error) {
    const name = String(error?.name || error?.code || 'UNKNOWN');
    if (name === 'NotAllowedError') return 'iPhone не разрешил уведомления. Проверьте Настройки iOS → Уведомления → SEVER.';
    if (name === 'InvalidStateError') return 'iPhone хранит несовместимую старую push-подписку. Закройте SEVER, откройте снова и повторите включение.';
    if (name === 'AbortError') return 'iOS не смог создать push-подписку. Откройте SEVER с экрана «Домой» и повторите включение.';
    if (name === 'AUTH_REQUIRED') return 'Push создан, но аккаунт SEVER не подтверждён. Перезайдите в аккаунт и повторите включение.';
    if (name === 'CLOUD_UNAVAILABLE') return 'Push создан, но облако SEVER сейчас недоступно. Проверьте интернет и повторите включение.';
    return `Не удалось подключить Web Push на iPhone (${name}).`;
  }

  // Safari/iOS consumes transient user activation when a permission flow is
  // separated from PushManager.subscribe(). Start subscribe synchronously from
  // the toggle's change event, before any await or Supabase work.
  function interceptIosEnable(event, master) {
    if (!isIOS() || !master.checked) return false;
    if (!isStandalone() || !supportsPush()) return false;

    event.stopImmediatePropagation();
    const prefs = pushPrefs();
    master.disabled = true;

    if (Notification.permission === 'denied') {
      if (prefs) prefs.enabled = false;
      syncPushUi(master);
      reminderStatus('Уведомления запрещены в настройках iPhone для SEVER.', 'warning');
      master.disabled = false;
      return true;
    }

    if (!iosRegistration) {
      if (prefs) prefs.enabled = false;
      syncPushUi(master);
      reminderStatus('SEVER ещё готовит Web Push. Подождите секунду и включите уведомления ещё раз.', 'warning');
      master.disabled = false;
      void prewarmIosPush();
      return true;
    }

    let subscriptionPromise;
    try {
      subscriptionPromise = iosSubscription
        ? Promise.resolve(iosSubscription)
        : iosRegistration.pushManager.subscribe({
            userVisibleOnly:true,
            applicationServerKey:decodePublicKey(VAPID_PUBLIC_KEY)
          });
    } catch (error) {
      if (prefs) prefs.enabled = false;
      syncPushUi(master);
      reminderStatus(iosPushErrorText(error), 'warning');
      master.disabled = false;
      return true;
    }

    void (async () => {
      try {
        const subscription = await subscriptionPromise;
        await saveIosSubscription(subscription, master);
      } catch (error) {
        console.warn('SEVER: iOS direct Web Push subscription failed', error);
        if (prefs) prefs.enabled = false;
        syncPushUi(master);
        reminderStatus(iosPushErrorText(error), 'warning');
        await window.SeverApp?.persist?.().catch?.(() => {});
      } finally {
        master.disabled = false;
      }
    })();
    return true;
  }

  function boot() {
    if (!window.SeverApp?.getState || document.documentElement.dataset.severReminders !== 'v82') return false;
    const master = detachLegacySettingsBridges();
    if (!master) return false;

    retireLegacyState();
    isolateLegacyReminderMirror(master);
    void prewarmIosPush();
    if (!bound) {
      bound = true;
      master.addEventListener('change', event => {
        if (interceptIosEnable(event, master)) return;
        queueMicrotask(retireLegacyState);
        scheduleReminderHealth(800);
      }, true);
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

    master.dataset.severIosPushFix = 'v1102';
    document.documentElement.dataset.severReminderBridge = 'v111';
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

  prewarmIosPush();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleBoot, { once:true });
  else scheduleBoot();
  window.addEventListener('load', scheduleBoot, { once:true });
  window.addEventListener('sever:ready', scheduleBoot);
})();
