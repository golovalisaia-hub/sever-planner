(() => {
  'use strict';

  const VAPID_PUBLIC_KEY = 'BJebqzKOHHkvVsoNnlt4tJpVcvYWFyI93tcLQgO2JJZyDkQ66UsKscOTZsV9NFqqviSZY26lGapm3S7gCV4GsMM';
  const $ = selector => document.querySelector(selector);
  const IOS_RE = /iPad|iPhone|iPod/i;
  let bootAttempts = 0;
  let bootTimer = 0;
  let signedInUser = null;
  let refreshPromise = null;
  let authListenerInstalled = false;

  const state = () => window.SeverApp?.getState?.() || {};
  const isIOS = () => IOS_RE.test(navigator.userAgent || '');
  const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  const supportsPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  // v115: one SEVER notification master owns both the day rhythm and the exact-task
  // cadence. The legacy per-kind booleans remain only for compatibility with the
  // already deployed database/client contract; they are not user-facing choices.
  function settings() {
    const current = state();
    current.pushReminders ??= { enabled:false, dayBefore:true, fifteenMinutes:true, legacyRetired:false };
    current.pushReminders.dayBefore = true;
    current.pushReminders.fifteenMinutes = true;
    current.pushReminders.automatic = true;
    return current.pushReminders;
  }

  async function persist() {
    try { await window.SeverApp?.persist?.(); } catch {}
  }

  function status(text, kind='neutral') {
    const node = $('#severReminderStatus');
    if (!node) return;
    node.textContent = text;
    node.dataset.kind = kind;
  }

  function decodePublicKey(value) {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const raw = atob((value + padding).replace(/-/g,'+').replace(/_/g,'/'));
    return Uint8Array.from(raw, char => char.charCodeAt(0));
  }

  async function db() {
    if (!window.SeverSupabase?.getClient) throw new Error('CLOUD_UNAVAILABLE');
    return window.SeverSupabase.getClient();
  }

  async function refreshUser() {
    try {
      const client = await db();
      const session = await client.auth.getSession();
      signedInUser = session.data?.session?.user || null;
      if (!signedInUser) {
        const user = await client.auth.getUser();
        signedInUser = user.data?.user || null;
      }
    } catch { signedInUser = null; }
    return signedInUser;
  }

  async function pushSubscription() {
    if (!supportsPush()) return null;
    try {
      const registration = await navigator.serviceWorker.ready;
      return await registration.pushManager.getSubscription();
    } catch { return null; }
  }

  function rowFor(subscription) {
    const keys = subscription.toJSON().keys || {};
    settings();
    return {
      user_id: signedInUser.id,
      endpoint: subscription.endpoint,
      p256dh: keys.p256dh || '',
      auth: keys.auth || '',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      user_agent: (navigator.userAgent || '').slice(0,500),
      enabled: true,
      remind_day_before: true,
      remind_15_minutes: true,
      updated_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString()
    };
  }

  async function upsertSubscription(subscription) {
    if (!subscription || !signedInUser) throw new Error('AUTH_REQUIRED');
    const client = await db();
    const result = await client.from('push_subscriptions').upsert(rowFor(subscription), { onConflict:'user_id,endpoint' });
    if (result.error) throw result.error;
  }

  function supportText() {
    if (!supportsPush()) {
      if (isIOS() && !isStandalone()) return 'На iPhone добавьте SEVER на экран «Домой», затем откройте его оттуда.';
      return 'Этот браузер не поддерживает Web Push для SEVER.';
    }
    if (Notification.permission === 'denied') return 'Уведомления запрещены в настройках устройства или браузера.';
    if (!signedInUser) return 'Войдите в SEVER, чтобы напоминания работали и при закрытом приложении.';
    return '';
  }

  function syncUI() {
    const prefs = settings();
    const master = $('#settingsNotificationToggle');
    if (master) master.checked = Boolean(prefs.enabled);
    document.documentElement.dataset.severPushEnabled = prefs.enabled ? 'true' : 'false';
    document.documentElement.dataset.severReminderMode = 'rhythm-v115';
    const hint = $('#severTaskReminderHint');
    if (hint) hint.textContent = prefs.enabled
      ? 'Точное время включает отдельные напоминания: за день и за 15 минут.'
      : 'Уведомления можно включить в Настройки → Уведомления SEVER.';
  }

  async function refreshServerState() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      await refreshUser();
      const prefs = settings();
      const support = supportText();
      if (support) {
        prefs.enabled = false;
        syncUI();
        const denied = typeof Notification !== 'undefined' && Notification.permission === 'denied';
        status(support, denied ? 'warning' : 'neutral');
        return;
      }

      const subscription = await pushSubscription();
      if (!subscription) {
        prefs.enabled = false;
        syncUI();
        status(Notification.permission === 'granted'
          ? 'Уведомления пока не подключены на этом устройстве.'
          : 'Разрешение появится только после вашего нажатия на переключатель.');
        return;
      }

      try {
        const client = await db();
        const result = await client.from('push_subscriptions')
          .select('enabled')
          .eq('user_id', signedInUser.id)
          .eq('endpoint', subscription.endpoint)
          .maybeSingle();
        if (result.error) throw result.error;
        prefs.enabled = Boolean(result.data && result.data.enabled !== false);
        // Opening an existing enabled installation keeps legacy subscription rows
        // normalized for the automatic exact-task cadence used by the v115 rhythm.
        if (prefs.enabled) await upsertSubscription(subscription);
        syncUI();
        if (prefs.enabled) status('Включено · SEVER держит ритм дня и отдельно напоминает о задачах с точным временем.', 'ok');
        await persist();
      } catch {
        syncUI();
        status('Не удалось проверить подписку. Остальной SEVER продолжает работать.', 'warning');
      }
    })().finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  async function enableFromGesture() {
    if (!signedInUser) {
      settings().enabled = false;
      syncUI();
      status('Сначала войдите в SEVER — подписка привязывается только к вашему аккаунту.', 'warning');
      return;
    }
    if (isIOS() && !isStandalone()) {
      settings().enabled = false;
      syncUI();
      status('На iPhone: Поделиться → На экран «Домой», затем откройте SEVER и включите уведомления здесь.', 'warning');
      return;
    }
    if (!supportsPush()) {
      settings().enabled = false;
      syncUI();
      status('Web Push недоступен в этом браузере.', 'warning');
      return;
    }

    const permission = await (Notification.permission === 'default'
      ? Notification.requestPermission()
      : Promise.resolve(Notification.permission));
    if (permission !== 'granted') {
      settings().enabled = false;
      syncUI();
      status('Разрешение не выдано. SEVER не будет беспокоить вас без согласия.', 'warning');
      await persist();
      return;
    }

    try {
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) subscription = await registration.pushManager.subscribe({
        userVisibleOnly:true,
        applicationServerKey:decodePublicKey(VAPID_PUBLIC_KEY)
      });
      settings().enabled = true;
      await upsertSubscription(subscription);
      await persist();
      syncUI();
      status('Включено · дальше SEVER сам напомнит в нужные моменты. Ничего настраивать не нужно.', 'ok');
    } catch (error) {
      console.warn('SEVER: Web Push subscription failed', error);
      settings().enabled = false;
      syncUI();
      status('Не удалось подключить Web Push. Проверьте интернет и разрешения уведомлений.', 'warning');
      await persist();
    }
  }

  async function disableReminders() {
    const subscription = await pushSubscription();
    try {
      if (subscription && signedInUser) {
        const client = await db();
        await client.from('push_subscriptions').delete().eq('user_id', signedInUser.id).eq('endpoint', subscription.endpoint);
      }
    } catch {}
    try { await subscription?.unsubscribe(); } catch {}
    settings().enabled = false;
    await persist();
    syncUI();
    status('Выключено. SEVER не будет присылать уведомления.');
  }

  async function testNotification() {
    if (isIOS() && !isStandalone()) {
      status('На iPhone тест работает после добавления SEVER на экран «Домой».', 'warning');
      return;
    }
    if (!supportsPush()) {
      status('Уведомления недоступны в этом браузере.', 'warning');
      return;
    }
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (permission !== 'granted') {
      status('Разрешение на уведомления не выдано.', 'warning');
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification('SEVER · проверка', {
      body:'Так выглядит спокойное уведомление SEVER: коротко и по делу.',
      icon:'./icon-192.png', badge:'./icon-192.png', tag:'sever-reminder-test', renotify:false,
      data:{url:'./?view=today'}
    });
    status('Тест отправлен на это устройство.', 'ok');
  }

  function retireLegacyDailyReminder() {
    const current = state();
    const prefs = settings();
    if (current.reminders) { current.reminders.enabled = false; current.reminders.lastDate = ''; }
    if (!prefs.legacyRetired) {
      prefs.legacyRetired = true;
      void persist();
    }
  }

  function installSettings() {
    const master = $('#settingsNotificationToggle');
    if (!master || master.dataset.severPushBound === 'true') return;
    master.dataset.severPushBound = 'true';
    const section = master.closest('.settings-section');
    if (!section) return;

    const title = master.closest('.settings-row')?.querySelector('b');
    const copy = master.closest('.settings-row')?.querySelector('em');
    if (title) title.textContent = 'Уведомления SEVER';
    if (copy) copy.textContent = 'Ритм дня, задачи и привычки';
    const oldTime = $('#settingsNotificationTime')?.closest('.settings-row');
    if (oldTime) oldTime.hidden = true;

    // Remove controls created by an older v82 runtime when a new service worker
    // takes over without forcing the user to reload Settings manually.
    $('#severReminderDayBefore')?.closest('.sever-reminder-option')?.remove();
    $('#severReminderFifteen')?.closest('.sever-reminder-option')?.remove();

    let options = section.querySelector('.sever-reminder-options');
    if (!options) {
      options = document.createElement('div');
      options.className = 'sever-reminder-options';
      const test = $('#settingsTestNotification');
      section.insertBefore(options, test || null);
    }
    options.innerHTML = `
      <div class="sever-reminder-note"><b>SEVER напомнит сам</b><span>Утром — план дня, днём — один следующий шаг, вечером — спокойное завершение. Привычки входят в общий ритм. Задачи с точным временем отдельно: за день и за 15 минут. SEVER объединяет сигналы, чтобы не спамить.</span></div>
      <p id="severReminderStatus" class="sever-reminder-status" data-kind="neutral"></p>`;

    const test = $('#settingsTestNotification');
    if (test) {
      if (test.querySelector('b')) test.querySelector('b').textContent = 'Проверить на этом устройстве';
      if (test.querySelector('em')) test.querySelector('em').textContent = 'Показать одно тестовое уведомление';
    }

    master.addEventListener('change', async event => {
      const input = event.currentTarget;
      input.disabled = true;
      try { if (input.checked) await enableFromGesture(); else await disableReminders(); }
      finally { input.disabled = false; syncUI(); }
    });
    test?.addEventListener('click', testNotification);

    const timeLabel = $('#taskTime')?.closest('label');
    if (timeLabel && !$('#severTaskReminderHint')) {
      const hint = document.createElement('small');
      hint.id = 'severTaskReminderHint';
      hint.className = 'sever-task-reminder-hint';
      timeLabel.appendChild(hint);
    }
  }

  function bridgeLegacySettings() {
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
      requestAnimationFrame(() => $('#settingsNotificationToggle')?.closest('.settings-section')?.scrollIntoView({behavior:'smooth',block:'start'}));
    });
    section.appendChild(button);
  }

  function fixSettingsGuide() {
    const button = $('#settingsGuide');
    if (!button || button.dataset.severGuideBound === 'true') return;
    button.dataset.severGuideBound = 'true';
    button.addEventListener('click', () => {
      const dialog = $('#tourDialog');
      if (dialog) dialog.addEventListener('close', () => window.SeverApp?.switchView?.('settings'), {once:true});
      window.SeverApp?.startGuide?.({manual:true});
    });
  }

  function applyDeepLink() {
    if (document.documentElement.dataset.severReminderDeepLink === 'done') return;
    document.documentElement.dataset.severReminderDeepLink = 'done';
    const url = new URL(location.href);
    const view = url.searchParams.get('view');
    if (['today','calendar','timer','notes','progress','habits','settings'].includes(view || '')) window.SeverApp?.switchView?.(view);
    if (url.searchParams.has('task')) window.SeverApp?.switchView?.('today');
    if (url.searchParams.has('task') || url.searchParams.has('view')) {
      url.searchParams.delete('task');
      url.searchParams.delete('view');
      const search = url.searchParams.toString();
      history.replaceState(history.state, '', url.pathname + (search ? `?${search}` : '') + url.hash);
    }
  }

  async function installAuthListener() {
    if (authListenerInstalled) return;
    authListenerInstalled = true;
    try {
      const client = await db();
      client.auth.onAuthStateChange((event, session) => {
        signedInUser = session?.user || null;
        if (event === 'SIGNED_OUT') {
          settings().enabled = false;
          void pushSubscription().then(subscription => subscription?.unsubscribe()).catch(() => {});
          syncUI();
          status('Войдите в SEVER, чтобы снова включить уведомления.');
        } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          void refreshServerState();
        }
      });
    } catch {}
  }

  function boot() {
    if (!window.SeverApp?.getState || !window.SeverSupabase?.getClient || !$('#settingsNotificationToggle') || !$('#settingsGuide')) return false;
    installSettings();
    bridgeLegacySettings();
    fixSettingsGuide();
    retireLegacyDailyReminder();
    syncUI();
    applyDeepLink();
    void installAuthListener();
    void refreshServerState();
    // Keep v82 compatibility for the iOS bridge; v115 is exposed separately.
    document.documentElement.dataset.severReminders = 'v82';
    document.documentElement.dataset.severRemindersVersion = 'v115';
    return true;
  }

  function scheduleBoot() {
    if (boot()) { clearTimeout(bootTimer); return; }
    if (bootAttempts++ >= 180) return;
    clearTimeout(bootTimer);
    bootTimer = setTimeout(scheduleBoot, 50);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleBoot, {once:true});
  else scheduleBoot();
  window.addEventListener('load', scheduleBoot, {once:true});
  window.addEventListener('sever:ready', scheduleBoot);
  window.addEventListener('sever:cloud-ready', () => void refreshServerState());
  window.addEventListener('focus', () => void refreshServerState());
})();