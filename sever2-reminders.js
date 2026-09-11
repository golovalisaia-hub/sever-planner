(() => {
  'use strict';

  const VAPID_PUBLIC_KEY = 'BGZgDkSfY_K2my7NyLzsWprVLUMKdVGH_Kd2k0DceANXmqwN4cgafdaLNvb9KOPcfFUAWHkxha9ykisXfRsVpx0';
  const $ = selector => document.querySelector(selector);
  const IOS_RE = /iPad|iPhone|iPod/i;
  let bootAttempts = 0;
  let bootTimer = 0;
  let signedInUser = null;
  let refreshInFlight = null;

  const plannerState = () => window.SeverApp?.getState?.() || {};
  const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const supportsPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = () => IOS_RE.test(navigator.userAgent || '');

  function prefs() {
    const state = plannerState();
    state.pushReminders ??= { enabled: false, dayBefore: true, fifteenMinutes: true, legacyRetired: false };
    state.pushReminders.dayBefore = state.pushReminders.dayBefore !== false;
    state.pushReminders.fifteenMinutes = state.pushReminders.fifteenMinutes !== false;
    return state.pushReminders;
  }

  async function persistPrefs() {
    try { await window.SeverApp?.persist?.(); } catch {}
  }

  function setStatus(text, kind = 'neutral') {
    const status = $('#severReminderStatus');
    if (!status) return;
    status.textContent = text;
    status.dataset.kind = kind;
  }

  function base64UrlToUint8Array(value) {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from(raw, char => char.charCodeAt(0));
  }

  async function supabase() {
    if (!window.SeverSupabase?.getClient) throw new Error('CLOUD_UNAVAILABLE');
    return window.SeverSupabase.getClient();
  }

  async function currentUser() {
    try {
      const client = await supabase();
      const result = await client.auth.getUser();
      signedInUser = result.data?.user || null;
    } catch {
      signedInUser = null;
    }
    return signedInUser;
  }

  async function existingSubscription() {
    if (!supportsPush()) return null;
    try {
      const registration = await navigator.serviceWorker.ready;
      return await registration.pushManager.getSubscription();
    } catch {
      return null;
    }
  }

  function subscriptionRecord(subscription, user, reminderPrefs = prefs()) {
    const serialized = subscription.toJSON();
    return {
      user_id: user.id,
      endpoint: subscription.endpoint,
      p256dh: serialized.keys?.p256dh || '',
      auth: serialized.keys?.auth || '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      user_agent: (navigator.userAgent || '').slice(0, 500),
      enabled: true,
      remind_day_before: reminderPrefs.dayBefore !== false,
      remind_15_minutes: reminderPrefs.fifteenMinutes !== false,
      updated_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString()
    };
  }

  async function saveSubscription(subscription, user = signedInUser) {
    if (!subscription || !user) throw new Error('AUTH_REQUIRED');
    const client = await supabase();
    const record = subscriptionRecord(subscription, user);
    const result = await client.from('push_subscriptions').upsert(record, { onConflict: 'user_id,endpoint' });
    if (result.error) throw result.error;
  }

  function supportMessage() {
    if (!supportsPush()) {
      if (isIOS() && !isStandalone()) return 'На iPhone добавьте SEVER на экран «Домой», затем откройте его оттуда.';
      return 'Этот браузер не поддерживает Web Push для SEVER.';
    }
    if (Notification.permission === 'denied') return 'Уведомления запрещены в настройках устройства или браузера.';
    if (!signedInUser) return 'Войдите в SEVER, чтобы напоминания работали и при закрытом приложении.';
    return '';
  }

  function syncControls() {
    const reminderPrefs = prefs();
    const master = $('#settingsNotificationToggle');
    const day = $('#severReminderDayBefore');
    const fifteen = $('#severReminderFifteen');
    if (master) master.checked = Boolean(reminderPrefs.enabled);
    if (day) day.checked = reminderPrefs.dayBefore !== false;
    if (fifteen) fifteen.checked = reminderPrefs.fifteenMinutes !== false;
    const disabled = !reminderPrefs.enabled;
    if (day) day.disabled = disabled;
    if (fifteen) fifteen.disabled = disabled;
    document.documentElement.dataset.severPushEnabled = reminderPrefs.enabled ? 'true' : 'false';
    updateTaskTimeHint();
  }

  function updateTaskTimeHint() {
    const hint = $('#severTaskReminderHint');
    if (!hint) return;
    hint.textContent = prefs().enabled
      ? 'SEVER напомнит за 1 день и за 15 минут до задач, у которых указано время.'
      : 'Чтобы получать напоминания о задаче, включите их в Настройки → Уведомления.';
  }

  async function refreshFromServer() {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      await currentUser();
      const reminderPrefs = prefs();
      const message = supportMessage();
      if (message) {
        reminderPrefs.enabled = false;
        syncControls();
        setStatus(message, Notification?.permission === 'denied' ? 'warning' : 'neutral');
        return;
      }

      const subscription = await existingSubscription();
      if (!subscription) {
        reminderPrefs.enabled = false;
        syncControls();
        setStatus(Notification.permission === 'granted' ? 'Напоминания пока не подключены на этом устройстве.' : 'Включите напоминания — запрос разрешения появится только после вашего нажатия.', 'neutral');
        return;
      }

      try {
        const client = await supabase();
        const result = await client.from('push_subscriptions')
          .select('enabled,remind_day_before,remind_15_minutes')
          .eq('user_id', signedInUser.id)
          .eq('endpoint', subscription.endpoint)
          .maybeSingle();
        if (result.error) throw result.error;
        if (result.data) {
          reminderPrefs.enabled = result.data.enabled !== false;
          reminderPrefs.dayBefore = result.data.remind_day_before !== false;
          reminderPrefs.fifteenMinutes = result.data.remind_15_minutes !== false;
          if (reminderPrefs.enabled) await saveSubscription(subscription, signedInUser);
        } else {
          reminderPrefs.enabled = false;
        }
      } catch {
        setStatus('Не удалось проверить подписку. Остальной SEVER продолжает работать.', 'warning');
      }
      syncControls();
      if (reminderPrefs.enabled) setStatus('Включено · максимум 2 спокойных напоминания на задачу.', 'ok');
      await persistPrefs();
    })().finally(() => { refreshInFlight = null; });
    return refreshInFlight;
  }

  async function enableFromGesture() {
    if (!signedInUser) {
      prefs().enabled = false;
      syncControls();
      setStatus('Сначала войдите в SEVER — подписка привязывается только к вашему аккаунту.', 'warning');
      return false;
    }
    if (isIOS() && !isStandalone()) {
      prefs().enabled = false;
      syncControls();
      setStatus('На iPhone: Поделиться → На экран «Домой», затем откройте SEVER и включите уведомления здесь.', 'warning');
      return false;
    }
    if (!supportsPush()) {
      prefs().enabled = false;
      syncControls();
      setStatus('Web Push недоступен в этом браузере.', 'warning');
      return false;
    }

    const permissionPromise = Notification.permission === 'default'
      ? Notification.requestPermission()
      : Promise.resolve(Notification.permission);
    const permission = await permissionPromise;
    if (permission !== 'granted') {
      prefs().enabled = false;
      syncControls();
      setStatus('Разрешение не выдано. SEVER не будет беспокоить вас без согласия.', 'warning');
      await persistPrefs();
      return false;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToUint8Array(VAPID_PUBLIC_KEY)
        });
      }
      prefs().enabled = true;
      await saveSubscription(subscription, signedInUser);
      await persistPrefs();
      syncControls();
      setStatus('Включено · за 1 день и за 15 минут. Без повторов и ежедневного спама.', 'ok');
      return true;
    } catch (error) {
      console.warn('SEVER push subscription failed', error);
      prefs().enabled = false;
      syncControls();
      setStatus('Не удалось подключить Web Push. Проверьте интернет и разрешения уведомлений.', 'warning');
      await persistPrefs();
      return false;
    }
  }

  async function disableReminders() {
    const subscription = await existingSubscription();
    try {
      if (subscription && signedInUser) {
        const client = await supabase();
        await client.from('push_subscriptions').delete()
          .eq('user_id', signedInUser.id)
          .eq('endpoint', subscription.endpoint);
      }
    } catch {}
    try { await subscription?.unsubscribe(); } catch {}
    prefs().enabled = false;
    await persistPrefs();
    syncControls();
    setStatus('Выключено. SEVER не будет присылать напоминания.', 'neutral');
  }

  async function saveKinds() {
    const reminderPrefs = prefs();
    reminderPrefs.dayBefore = $('#severReminderDayBefore')?.checked !== false;
    reminderPrefs.fifteenMinutes = $('#severReminderFifteen')?.checked !== false;
    if (!reminderPrefs.dayBefore && !reminderPrefs.fifteenMinutes) {
      reminderPrefs.dayBefore = true;
      const day = $('#severReminderDayBefore');
      if (day) day.checked = true;
      setStatus('Оставили одно напоминание за 1 день, чтобы режим не был пустым.', 'neutral');
    }
    const subscription = await existingSubscription();
    if (subscription && signedInUser && reminderPrefs.enabled) {
      try { await saveSubscription(subscription, signedInUser); }
      catch { setStatus('Настройка сохранена на устройстве, но облако пока недоступно.', 'warning'); }
    }
    await persistPrefs();
    syncControls();
  }

  async function testNotificationFromGesture() {
    if (isIOS() && !isStandalone()) {
      setStatus('На iPhone тест работает после добавления SEVER на экран «Домой».', 'warning');
      return;
    }
    if (!supportsPush()) {
      setStatus('Уведомления недоступны в этом браузере.', 'warning');
      return;
    }
    const permission = Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission;
    if (permission !== 'granted') {
      setStatus('Разрешение на уведомления не выдано.', 'warning');
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification('SEVER · проверка', {
      body: 'Так будет выглядеть спокойное напоминание о задаче.',
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: 'sever-reminder-test',
      renotify: false,
      data: { url: './?view=today' }
    });
    setStatus('Тест отправлен на это устройство.', 'ok');
  }

  function retireLegacyDailyReminder() {
    const state = plannerState();
    const reminderPrefs = prefs();
    if (reminderPrefs.legacyRetired) return;
    if (state.reminders) {
      state.reminders.enabled = false;
      state.reminders.lastDate = '';
    }
    reminderPrefs.legacyRetired = true;
    void persistPrefs();
  }

  function installSettingsUI() {
    const master = $('#settingsNotificationToggle');
    if (!master || master.dataset.severPushBound === 'true') return;
    master.dataset.severPushBound = 'true';
    const section = master.closest('.settings-section');
    if (!section) return;

    const masterCopy = master.closest('.settings-row')?.querySelector('span > span, span:first-child');
    const title = master.closest('.settings-row')?.querySelector('b');
    const description = master.closest('.settings-row')?.querySelector('em');
    if (title) title.textContent = 'Напоминания о задачах';
    if (description) description.textContent = 'Только по вашим задачам, без ежедневного спама';

    const oldTime = $('#settingsNotificationTime')?.closest('.settings-row');
    if (oldTime) oldTime.hidden = true;

    const options = document.createElement('div');
    options.className = 'sever-reminder-options';
    options.innerHTML = `
      <label class="settings-row settings-switch-row sever-reminder-option">
        <span><b>За 1 день</b><em>Спокойно напомнить заранее</em></span>
        <span class="switch"><input id="severReminderDayBefore" type="checkbox" checked><i></i></span>
      </label>
      <label class="settings-row settings-switch-row sever-reminder-option">
        <span><b>За 15 минут</b><em>Только перед самым началом задачи</em></span>
        <span class="switch"><input id="severReminderFifteen" type="checkbox" checked><i></i></span>
      </label>
      <div class="sever-reminder-note"><b>Без спама</b><span>Одинаковое напоминание не повторяется. Для задач без времени уведомления не отправляются.</span></div>
      <p id="severReminderStatus" class="sever-reminder-status" data-kind="neutral"></p>`;
    const testButton = $('#settingsTestNotification');
    section.insertBefore(options, testButton || null);
    if (testButton) {
      const testTitle = testButton.querySelector('b');
      const testCopy = testButton.querySelector('em');
      if (testTitle) testTitle.textContent = 'Проверить на этом устройстве';
      if (testCopy) testCopy.textContent = 'Показать одно тестовое уведомление';
    }

    master.addEventListener('change', async event => {
      const input = event.currentTarget;
      input.disabled = true;
      try {
        if (input.checked) await enableFromGesture();
        else await disableReminders();
      } finally {
        input.disabled = false;
        syncControls();
      }
    });
    $('#severReminderDayBefore')?.addEventListener('change', saveKinds);
    $('#severReminderFifteen')?.addEventListener('change', saveKinds);
    testButton?.addEventListener('click', testNotificationFromGesture);

    const timeLabel = $('#taskTime')?.closest('label');
    if (timeLabel && !$('#severTaskReminderHint')) {
      const hint = document.createElement('small');
      hint.id = 'severTaskReminderHint';
      hint.className = 'sever-task-reminder-hint';
      timeLabel.appendChild(hint);
    }
  }

  function installLegacySettingsBridge() {
    const section = $('#notificationToggle')?.closest('.notification-settings');
    if (!section || section.dataset.severPushRetired === 'true') return;
    section.dataset.severPushRetired = 'true';
    section.classList.add('sever2-reminder-legacy');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary sever-open-reminder-settings';
    button.textContent = 'Настроить уведомления';
    button.addEventListener('click', () => {
      $('#moreDialog')?.close();
      window.SeverApp?.switchView?.('settings');
      requestAnimationFrame(() => $('#settingsNotificationToggle')?.closest('.settings-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    });
    section.appendChild(button);
  }

  function installGuideFix() {
    const button = $('#settingsGuide');
    if (!button || button.dataset.severGuideBound === 'true') return;
    button.dataset.severGuideBound = 'true';
    button.addEventListener('click', () => {
      const dialog = $('#tourDialog');
      if (dialog) dialog.addEventListener('close', () => window.SeverApp?.switchView?.('settings'), { once: true });
      window.SeverApp?.startGuide?.({ manual: true });
    });
  }

  function applyDeepLink() {
    if (document.documentElement.dataset.severReminderDeepLink === 'done') return;
    document.documentElement.dataset.severReminderDeepLink = 'done';
    const url = new URL(location.href);
    const view = url.searchParams.get('view');
    if (['today','calendar','timer','notes','progress','habits','settings'].includes(view || '')) {
      window.SeverApp?.switchView?.(view);
    }
    if (url.searchParams.has('task')) {
      window.SeverApp?.switchView?.('today');
      url.searchParams.delete('task');
      url.searchParams.delete('view');
      history.replaceState(history.state, '', url.pathname + (url.searchParams.size ? `?${url.searchParams}` : '') + url.hash);
    }
  }

  function boot() {
    if (!window.SeverApp?.getState || !window.SeverSupabase?.getClient || !$('#settingsNotificationToggle') || !$('#settingsGuide')) return false;
    installSettingsUI();
    installLegacySettingsBridge();
    installGuideFix();
    retireLegacyDailyReminder();
    syncControls();
    applyDeepLink();
    void refreshFromServer();
    document.documentElement.dataset.severReminders = 'v82';
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleBoot, { once: true });
  else scheduleBoot();
  window.addEventListener('load', scheduleBoot, { once: true });
  window.addEventListener('sever:ready', scheduleBoot);
  window.addEventListener('sever:cloud-ready', () => void refreshFromServer());
  window.addEventListener('focus', () => void refreshFromServer());
})();
