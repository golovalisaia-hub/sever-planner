(() => {
  'use strict';

  const VAPID_PUBLIC_KEY = 'BJebqzKOHHkvVsoNnlt4tJpVcvYWFyI93tcLQgO2JJZyDkQ66UsKscOTZsV9NFqqviSZY26lGapm3S7gCV4GsMM';
  const VERSION = 'v1111';
  const IOS_RE = /iPad|iPhone|iPod/i;
  let registration = null;
  let subscription = null;
  let prewarmPromise = null;

  const isIOS = () => IOS_RE.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  const supportsPush = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const $ = selector => document.querySelector(selector);

  function prefs() {
    const current = window.SeverApp?.getState?.();
    if (!current) return null;
    current.pushReminders ??= { enabled:false, dayBefore:true, fifteenMinutes:true, legacyRetired:true };
    return current.pushReminders;
  }

  function status(text, kind='neutral', code='') {
    const node = $('#severReminderStatus');
    if (node) {
      node.textContent = text;
      node.dataset.kind = kind;
      if (code) node.dataset.errorCode = code;
      else delete node.dataset.errorCode;
    }
    document.documentElement.dataset.severIosPushLast = code || kind;
  }

  function syncUi(master, enabled) {
    const current = prefs();
    if (current) current.enabled = Boolean(enabled);
    if (master) master.checked = Boolean(enabled);
    const day = $('#severReminderDayBefore');
    const fifteen = $('#severReminderFifteen');
    if (day) day.disabled = !enabled;
    if (fifteen) fifteen.disabled = !enabled;
    document.documentElement.dataset.severPushEnabled = enabled ? 'true' : 'false';
  }

  function decodePublicKey(value) {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const raw = atob((value + padding).replace(/-/g,'+').replace(/_/g,'/'));
    return Uint8Array.from(raw, char => char.charCodeAt(0));
  }

  async function prewarm() {
    if (!isIOS() || !supportsPush()) return null;
    if (registration) return registration;
    if (prewarmPromise) return prewarmPromise;
    prewarmPromise = navigator.serviceWorker.ready.then(async ready => {
      registration = ready;
      try { subscription = await ready.pushManager.getSubscription(); }
      catch { subscription = null; }
      document.documentElement.dataset.severIosPushPrewarm = 'ready';
      return ready;
    }).catch(error => {
      document.documentElement.dataset.severIosPushPrewarm = 'failed';
      console.warn('SEVER: iOS push prewarm failed', error);
      return null;
    }).finally(() => { prewarmPromise = null; });
    return prewarmPromise;
  }

  async function signedInUser(client) {
    const sessionResult = await client.auth.getSession();
    let user = sessionResult.data?.session?.user || null;
    if (!user) {
      const userResult = await client.auth.getUser();
      user = userResult.data?.user || null;
    }
    return user;
  }

  async function saveSubscription(value, master) {
    if (!window.SeverSupabase?.getClient) throw Object.assign(new Error('CLOUD_UNAVAILABLE'), { code:'CLOUD_UNAVAILABLE' });
    const client = await window.SeverSupabase.getClient();
    const user = await signedInUser(client);
    if (!user) throw Object.assign(new Error('AUTH_REQUIRED'), { code:'AUTH_REQUIRED' });

    const current = prefs();
    const keys = value.toJSON().keys || {};
    const result = await client.from('push_subscriptions').upsert({
      user_id:user.id,
      endpoint:value.endpoint,
      p256dh:keys.p256dh || '',
      auth:keys.auth || '',
      timezone:Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      user_agent:(navigator.userAgent || '').slice(0,500),
      enabled:true,
      remind_day_before:current?.dayBefore !== false,
      remind_15_minutes:current?.fifteenMinutes !== false,
      updated_at:new Date().toISOString(),
      last_seen_at:new Date().toISOString()
    }, { onConflict:'user_id,endpoint' });
    if (result.error) throw result.error;

    subscription = value;
    syncUi(master, true);
    await window.SeverApp?.persist?.().catch?.(() => {});
    status('Включено на iPhone · Web Push подключён.', 'ok');
    window.dispatchEvent(new CustomEvent('sever:push-connected', { detail:{ platform:'ios', version:VERSION } }));
  }

  function errorCode(error) {
    return String(error?.name || error?.code || error?.message || 'UNKNOWN').slice(0,80);
  }

  function errorText(error) {
    const code = errorCode(error);
    if (code === 'NotAllowedError') return ['iPhone не разрешил уведомления. Проверьте Настройки iOS → Уведомления → SEVER.', code];
    if (code === 'InvalidStateError') return ['iPhone хранит несовместимую push-подписку. Полностью закройте SEVER, откройте снова и повторите.', code];
    if (code === 'AbortError') return ['iOS не смог создать push-подписку. Полностью закройте SEVER, откройте с экрана «Домой» и повторите.', code];
    if (code === 'AUTH_REQUIRED') return ['Push создан, но аккаунт SEVER не подтверждён. Перезайдите в аккаунт и включите уведомления ещё раз.', code];
    if (code === 'CLOUD_UNAVAILABLE') return ['Push создан, но облако SEVER недоступно. Проверьте интернет и повторите.', code];
    return [`Не удалось подключить Web Push на iPhone. Код: ${code}.`, code];
  }

  function interceptEnable(event) {
    const master = event.target;
    if (!(master instanceof HTMLInputElement) || master.id !== 'settingsNotificationToggle' || !master.checked || !isIOS()) return;

    // Capture on document runs before the old target listener and survives any
    // Settings DOM replacement. The legacy iOS path must never run after this.
    event.preventDefault();
    event.stopImmediatePropagation();
    master.disabled = true;

    if (!isStandalone()) {
      syncUi(master, false);
      status('На iPhone Web Push работает только у SEVER, открытого с экрана «Домой». Добавьте SEVER туда и запускайте по иконке.', 'warning', 'IOS_NOT_STANDALONE');
      master.disabled = false;
      return;
    }
    if (!supportsPush()) {
      syncUi(master, false);
      status('Эта версия iOS не даёт SEVER доступ к Web Push.', 'warning', 'PUSH_UNSUPPORTED');
      master.disabled = false;
      return;
    }
    if (Notification.permission === 'denied') {
      syncUi(master, false);
      status('Уведомления запрещены в настройках iPhone для SEVER.', 'warning', 'NotAllowedError');
      master.disabled = false;
      return;
    }
    if (!registration) {
      syncUi(master, false);
      status('SEVER ещё подключает системный Push. Подождите секунду и включите уведомления ещё раз.', 'warning', 'SW_NOT_READY');
      master.disabled = false;
      void prewarm();
      return;
    }

    let subscribePromise;
    try {
      // Important for Safari/iOS: subscribe() is started synchronously inside
      // the direct user gesture, before any await, auth request or cloud work.
      subscribePromise = subscription
        ? Promise.resolve(subscription)
        : registration.pushManager.subscribe({
            userVisibleOnly:true,
            applicationServerKey:decodePublicKey(VAPID_PUBLIC_KEY)
          });
      document.documentElement.dataset.severIosPushGesture = 'captured';
    } catch (error) {
      const [message, code] = errorText(error);
      syncUi(master, false);
      status(message, 'warning', code);
      master.disabled = false;
      return;
    }

    void (async () => {
      try {
        const value = await subscribePromise;
        await saveSubscription(value, master);
      } catch (error) {
        console.warn('SEVER: document-level iOS Web Push failed', error);
        const [message, code] = errorText(error);
        syncUi(master, false);
        status(message, 'warning', code);
        await window.SeverApp?.persist?.().catch?.(() => {});
      } finally {
        master.disabled = false;
      }
    })();
  }

  // A link inside the installed PWA is required: opening a URL from another
  // app can inspect Safari's separate storage instead of SEVER's own device state.
  function installDiagnosticLink() {
    if (!isIOS()) return;
    const test = $('#settingsTestNotification');
    if (!test || $('#severPushDiagnosticLink')) return;
    const link = document.createElement('a');
    link.id = 'severPushDiagnosticLink';
    link.href = './push-check.html';
    link.textContent = 'Проверить доставку и подписку →';
    link.style.display = 'inline-flex';
    link.style.alignItems = 'center';
    link.style.minHeight = '44px';
    link.style.marginTop = '12px';
    link.style.color = 'inherit';
    link.style.textDecoration = 'underline';
    test.insertAdjacentElement('afterend', link);
  }

  if (isIOS()) {
    document.addEventListener('change', interceptEnable, true);
    void prewarm();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installDiagnosticLink, {once:true});
    else installDiagnosticLink();
    window.addEventListener('load', () => { void prewarm(); installDiagnosticLink(); }, { once:true });
    window.addEventListener('sever:ready', () => { void prewarm(); installDiagnosticLink(); });
    window.addEventListener('sever:cloud-ready', () => { void prewarm(); installDiagnosticLink(); });
  }

  document.documentElement.dataset.severIosPushCoreFix = VERSION;
})();
