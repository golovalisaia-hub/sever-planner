(() => {
  'use strict';
  const PUBLIC_KEY = 'BJebqzKOHHkvVsoNnlt4tJpVcvYWFyI93tcLQgO2JJZyDkQ66UsKscOTZsV9NFqqviSZY26lGapm3S7gCV4GsMM';
  const $ = id => document.getElementById(id);
  const put = (id, value) => { const node = $(id); if (node) node.textContent = value; };
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  const bytes = value => {
    const padded = value + '='.repeat((4 - value.length % 4) % 4);
    return Uint8Array.from(atob(padded.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
  };
  const matchesKey = subscription => {
    const actual = subscription.options?.applicationServerKey;
    if (!actual) return null;
    const a = new Uint8Array(actual), b = bytes(PUBLIC_KEY);
    return a.length === b.length && a.every((item, index) => item === b[index]);
  };

  function workerVersion(registration) {
    return new Promise(resolve => {
      const worker = registration?.active;
      if (!worker || !('MessageChannel' in window)) return resolve(false);
      const channel = new MessageChannel();
      let finished = false;
      const done = result => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        channel.port1.close();
        resolve(result);
      };
      const timeout = setTimeout(() => done(false), 2200);
      channel.port1.onmessage = event => done(event.data?.type === 'SEVER_PUSH_DIAG_VERSION' && event.data.version === 'v124');
      try { worker.postMessage({type:'SEVER_PUSH_DIAG_VERSION'}, [channel.port2]); }
      catch { done(false); }
    });
  }

  function readLastReceipt() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IDB_UNAVAILABLE'));
      const open = indexedDB.open('sever-push-diagnostics-v124', 1);
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains('events')) open.result.createObjectStore('events', {keyPath:'name'});
      };
      open.onerror = () => reject(new Error('IDB_OPEN_FAILED'));
      open.onsuccess = () => {
        const db = open.result;
        try {
          const request = db.transaction('events', 'readonly').objectStore('events').get('last');
          request.onsuccess = () => { resolve(request.result || null); db.close(); };
          request.onerror = () => { reject(new Error('IDB_READ_FAILED')); db.close(); };
        } catch { db.close(); reject(new Error('IDB_READ_FAILED')); }
      };
    });
  }

  async function refresh() {
    put('message', 'Читаю данные этого устройства…');
    const allowed = 'Notification' in window ? Notification.permission : 'unsupported';
    put('permission', allowed === 'granted' ? 'Разрешено' : allowed === 'denied' ? 'Запрещено в настройках' : allowed === 'default' ? 'Разрешение ещё не запрошено' : 'Не поддерживается');
    put('standalone', standalone() ? 'Да' : isIOS ? 'Нет — откройте SEVER с иконки на экране «Домой»' : 'Нет — обычная вкладка');
    if (!('serviceWorker' in navigator)) {
      put('worker', 'Service Worker не поддерживается');
      put('subscription', 'Недоступна');
      put('key', 'Недоступен');
      put('receipt', 'Нет обработчика');
      put('message', 'Устройство не поддерживает Web Push SEVER.');
      return;
    }
    let registration = null;
    try { registration = await navigator.serviceWorker.getRegistration(); }
    catch { /* Surface an honest local state below. */ }
    if (!registration?.active) {
      put('worker', 'Не активен — откройте SEVER с главного экрана');
      put('subscription', 'Не удалось проверить');
      put('key', 'Не удалось проверить');
      put('receipt', 'Диагностика ещё не активна');
      put('message', 'Сначала откройте установленный SEVER и включите уведомления.');
      return;
    }
    const current = await workerVersion(registration);
    put('worker', current ? 'Активна диагностика v124' : 'Версия v124 не подтверждена — откройте SEVER повторно');
    try {
      const sub = await registration.pushManager?.getSubscription();
      put('subscription', sub ? 'Есть на этом устройстве' : 'Отсутствует — подключите в настройках SEVER');
      const same = sub ? matchesKey(sub) : null;
      put('key', !sub ? 'Нет подписки' : same === true ? 'Совпадает с ключом сервера' : same === false ? 'Устаревший ключ — нужно переподключить подписку' : 'Браузер не предоставляет ключ для сравнения');
    } catch {
      put('subscription', 'Не удалось проверить');
      put('key', 'Не удалось проверить');
    }
    if (current) {
      try {
        const receipt = await readLastReceipt();
        const time = receipt?.receivedAt && Number.isFinite(Date.parse(receipt.receivedAt))
          ? new Date(receipt.receivedAt).toLocaleString('ru-RU') : null;
        put('receipt', time ? `Push-событие получено ${time}; появление баннера не подтверждено` : 'Записей после установки диагностики v124 ещё нет');
      } catch { put('receipt', 'Локальный журнал недоступен'); }
    } else put('receipt', 'Невозможно проверить, пока версия v124 не активна');
    put('message', 'Результаты прочитаны локально. Снимок экрана безопасен: адрес и ключи подписки не показаны.');
  }

  async function localTest() {
    const button = $('localTest');
    button.disabled = true;
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') {
        put('message', 'Уведомления не разрешены. Проверьте настройки iPhone или браузера.');
        return;
      }
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration?.active) throw new Error('SW_NOT_ACTIVE');
      await registration.showNotification('SEVER · локальная проверка', {
        body:'Это только проверка показа, без отправки через Apple или Google.',
        icon:'./icon-192.png', badge:'./icon-192.png',
        tag:`sever-local-check-${Date.now()}`, renotify:false,
        data:{url:'./?view=today'}
      });
      put('message', 'Запрос на показ принят браузером. Если баннера нет, проверьте уведомления и Фокусирование iOS. Это не тест серверной доставки.');
    } catch {
      put('message', 'Локальный показ не удался. Проверьте разрешения и статус установленного SEVER.');
    } finally { button.disabled = false; }
  }

  $('refresh')?.addEventListener('click', () => void refresh());
  $('localTest')?.addEventListener('click', () => void localTest());
  void refresh();
})();
