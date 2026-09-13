(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  let installed = false;
  let retryBusy = false;

  const seasonIcons = {
    winter: `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9"/>
        <path d="m12 3-2 2m2-2 2 2m-2 16-2-2m2 2 2-2"/>
      </svg>`,
    spring: `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 20v-8"/>
        <path d="M12 13c-1.2-4-4.1-5.3-7-4.8.4 3.4 2.7 5.7 7 5.8Z"/>
        <path d="M12 11c1-3.6 3.7-5 7-4.8-.2 3.1-2.4 5.4-7 5.8Z"/>
      </svg>`,
    summer: `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="3.5"/>
        <path d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.5 5.5 7 7M17 17l1.5 1.5M18.5 5.5 17 7M7 17l-1.5 1.5"/>
      </svg>`,
    autumn: `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M19 4C11.6 4.3 6.2 7.2 5 14.1c3.2 1.7 7.2 1.1 10-1.8C17.6 9.7 18.7 6.8 19 4Z"/>
        <path d="M5 20c2.1-4.4 5.4-7.8 10-10.2"/>
      </svg>`
  };

  function seasonForMonth(month) {
    if (month === 11 || month <= 1) return 'winter';
    if (month <= 4) return 'spring';
    if (month <= 7) return 'summer';
    return 'autumn';
  }

  function ensureSeasonalSignature() {
    const season = seasonForMonth(new Date().getMonth());
    document.documentElement.dataset.severSeason = season;
    document.documentElement.dataset.severSeasonSignature = 'v96';

    document.querySelectorAll('.mobile-wordmark, .desktop-sidebar > .wordmark').forEach(wordmark => {
      let mark = wordmark.querySelector('.sever-season-mark');
      if (!mark) {
        mark = document.createElement('span');
        mark.className = 'sever-season-mark';
        mark.setAttribute('aria-hidden', 'true');
        wordmark.append(mark);
      }
      if (mark.dataset.season !== season) {
        mark.dataset.season = season;
        mark.innerHTML = seasonIcons[season];
      }
    });
  }

  function ensureIndicator() {
    let root = $('#severMobileSyncIndicator');
    if (root) return root;
    const actions = $('.topbar .top-actions');
    if (!actions) return null;

    root = document.createElement('div');
    root.id = 'severMobileSyncIndicator';
    root.className = 'sever-sync-indicator hidden';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    root.innerHTML = `
      <span class="sever-sync-dot" aria-hidden="true"></span>
      <span class="sever-sync-copy"></span>
      <button class="sever-sync-retry hidden" type="button" aria-label="Повторить синхронизацию">↻</button>`;
    actions.prepend(root);

    root.querySelector('.sever-sync-retry').addEventListener('click', async event => {
      event.preventDefault();
      event.stopPropagation();
      const cloud = window.SeverCloud;
      if (retryBusy || !navigator.onLine || typeof cloud?.recoverNow !== 'function') return;
      retryBusy = true;
      render();
      try { await cloud.recoverNow(); }
      catch {}
      finally {
        retryBusy = false;
        render();
      }
    });
    return root;
  }

  function viewModel() {
    const cloud = window.SeverCloud;
    const health = cloud?.health?.();
    if (!cloud || !health || !cloud.configured || health.session !== 'signed-in') return { hidden: true };

    const status = health.status || cloud.status || 'local';
    const error = health.lastErrorCode || cloud.lastErrorCode || '';
    if (status === 'synced' || status === 'local' || status === 'signed-out') return { hidden: true };

    if (!navigator.onLine || status === 'offline') {
      return {
        state: 'offline',
        short: 'Офлайн',
        full: 'Офлайн. Изменения сохраняются на устройстве и отправятся позже.',
        retry: false
      };
    }
    if (retryBusy || status === 'syncing') {
      return {
        state: 'busy',
        short: 'Синхронизация…',
        full: 'SEVER синхронизирует изменения.',
        retry: false
      };
    }
    if (status === 'migration') {
      return {
        state: 'attention',
        short: 'Нужен выбор',
        full: 'Нужно выбрать, как перенести локальные данные в аккаунт.',
        retry: false
      };
    }
    if (error || status === 'unavailable') {
      return {
        state: 'warning',
        short: 'Связь с облаком',
        full: 'Есть проблема с облаком. Локальные изменения сохранены.',
        retry: true
      };
    }
    return {
      state: 'busy',
      short: 'Сохраняем…',
      full: 'Есть изменения, которые ещё отправляются в облако.',
      retry: false
    };
  }

  function render() {
    ensureSeasonalSignature();
    const root = ensureIndicator();
    if (!root) return;
    const model = viewModel();
    root.classList.toggle('hidden', Boolean(model.hidden));
    if (model.hidden) {
      delete root.dataset.state;
      return;
    }
    root.dataset.state = model.state;
    root.setAttribute('aria-label', model.full);
    root.title = model.full;
    const copy = root.querySelector('.sever-sync-copy');
    if (copy && copy.textContent !== model.short) copy.textContent = model.short;
    const retry = root.querySelector('.sever-sync-retry');
    retry?.classList.toggle('hidden', !model.retry);
    if (retry) retry.disabled = retryBusy || !navigator.onLine;
  }

  function boot(attempt = 0) {
    if (installed) return;
    if (!$('.topbar .top-actions')) {
      if (attempt < 160) setTimeout(() => boot(attempt + 1), 50);
      return;
    }
    installed = true;
    ensureSeasonalSignature();
    ensureIndicator();
    window.addEventListener('sever:cloud-status', render);
    window.addEventListener('sever:cloud-ready', render);
    window.addEventListener('online', render);
    window.addEventListener('offline', render);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') render();
    });
    render();
    document.documentElement.dataset.severExperience = 'v94';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(), { once: true });
  else boot();
  window.addEventListener('sever:ready', () => { if (!installed) boot(); else render(); });
})();
