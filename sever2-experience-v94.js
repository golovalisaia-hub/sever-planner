(() => {
  'use strict';

  const $ = selector => document.querySelector(selector);
  let installed = false;
  let retryBusy = false;

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
      if (retryBusy || !navigator.onLine || !window.SeverCloudRecovery?.recover) return;
      retryBusy = true;
      render();
      try { await window.SeverCloudRecovery.recover(); }
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
