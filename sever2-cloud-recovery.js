(function () {
  'use strict';

  /* SEVER 2 cloud recovery v80.
     This layer does not create another data model. It only bounds stalled client
     operations, decouples successful authentication from initial sync, and
     exposes a safe recovery action that keeps the local outbox intact. */
  const overrides = window.__SEVER_CLOUD_RECOVERY_TIMEOUTS__ || {};
  const bounded = (value, fallback, min = 20, max = 120000) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  };
  const CLIENT_TIMEOUT_MS = bounded(overrides.client, 8000);
  const AUTH_TIMEOUT_MS = bounded(overrides.auth, 15000);
  const SESSION_TIMEOUT_MS = bounded(overrides.session, 18000);
  const SYNC_TIMEOUT_MS = bounded(overrides.sync, 18000);
  const WATCHDOG_MS = bounded(overrides.watchdog, 26000, 50, 180000);

  function timeoutError(code) {
    const error = new Error(code === 'AUTH_TIMEOUT'
      ? 'network timeout while contacting authentication service'
      : 'network timeout while synchronizing SEVER');
    error.code = code;
    return error;
  }

  function withTimeout(value, ms, code) {
    let timer;
    return new Promise((resolve, reject) => {
      timer = window.setTimeout(() => reject(timeoutError(code)), ms);
      Promise.resolve(value).then(resolve, reject);
    }).finally(() => window.clearTimeout(timer));
  }

  function invalidRefreshToken(reason) {
    const source = String(reason?.message || reason || '').toLocaleLowerCase('en-US');
    return source.includes('invalid refresh token') || source.includes('refresh token not found');
  }

  function statusCopy(cloud) {
    const health = cloud.health();
    if (!cloud.configured) return ['local', 'Облако не настроено — данные остаются на этом устройстве.'];
    if (health.session === 'signed-out') {
      if (health.lastErrorCode === 'AUTH_TIMEOUT' || health.lastErrorCode === 'NETWORK_ERROR') return ['warning', 'Сервер входа не ответил. Можно безопасно повторить попытку.'];
      return ['idle', 'Облако доступно. Войдите, чтобы синхронизировать устройства.'];
    }
    if (health.status === 'synced') return ['ok', 'Синхронизация работает. Изменения сохранены в облаке.'];
    if (health.status === 'syncing') return ['busy', 'Синхронизация… Локальные данные при этом не удаляются.'];
    if (health.status === 'migration') return ['busy', 'Нужно выбрать, как перенести локальные данные в аккаунт.'];
    if (health.status === 'local') return ['local', 'Для этого аккаунта выбран локальный режим.'];
    if (health.status === 'offline') return ['warning', 'Сейчас нет связи с облаком. Изменения останутся в очереди и отправятся позже.'];
    if (health.lastErrorCode === 'SESSION_TIMEOUT') return ['warning', 'Сессия зависла. Нажмите «Восстановить связь» — локальные данные сохранятся.'];
    if (health.lastErrorCode === 'SYNC_TIMEOUT') return ['warning', 'Синхронизация зависла. Нажмите «Восстановить связь» — очередь изменений не пропадёт.'];
    if (health.lastErrorCode) return ['warning', 'Есть проблема со связью с облаком. Локальные данные сохранены; связь можно восстановить.'];
    return ['busy', 'Есть изменения, которые ещё не дошли до облака.'];
  }

  function boot(attempt = 0) {
    const cloud = window.SeverCloud;
    if (!cloud || !window.SeverCloudUI || !window.SeverSupabase) {
      if (attempt < 240) window.setTimeout(() => boot(attempt + 1), 50);
      return;
    }
    if (cloud.__severCloudRecoveryV80) return;
    cloud.__severCloudRecoveryV80 = true;

    const original = {
      applySession: cloud.applySession.bind(cloud),
      fetchAll: cloud.fetchAll.bind(cloud),
      flush: cloud.flush.bind(cloud),
      signOut: cloud.signOut.bind(cloud)
    };

    function resetCoordination({ resetSession = true } = {}) {
      window.clearTimeout(cloud.timer);
      window.clearTimeout(cloud.pullRetryTimer);
      window.clearTimeout(cloud.realtimeReconnectTimer);
      cloud.timer = null;
      cloud.pullRetryTimer = null;
      cloud.realtimeReconnectTimer = null;
      cloud.running = false;
      cloud.pullQueued = false;
      cloud.pullRequested = false;
      cloud.pullPromise = null;
      if (resetSession) {
        cloud.sessionVersion += 1;
        cloud.sessionTask = null;
        cloud.sessionTarget = undefined;
      }
      cloud.clearRealtime?.();
    }

    cloud.fetchAll = function () {
      return withTimeout(original.fetchAll(), SYNC_TIMEOUT_MS, 'SYNC_TIMEOUT');
    };

    cloud.flush = function () {
      return withTimeout(original.flush(), SYNC_TIMEOUT_MS, 'SYNC_TIMEOUT').catch(reason => {
        if (reason?.code !== 'SYNC_TIMEOUT') throw reason;
        this.running = false;
        this.lastErrorCode = 'SYNC_TIMEOUT';
        this.setStatus(navigator.onLine ? 'pending' : 'offline');
        this.scheduleRetry?.();
        return false;
      });
    };

    cloud.applySession = function (user) {
      const target = user?.id || null;
      if (this.sessionTask && this.sessionTarget !== target) resetCoordination({ resetSession: true });
      return withTimeout(original.applySession(user), SESSION_TIMEOUT_MS, 'SESSION_TIMEOUT').catch(reason => {
        if (reason?.code !== 'SESSION_TIMEOUT') throw reason;
        resetCoordination({ resetSession: true });
        this.lastErrorCode = 'SESSION_TIMEOUT';
        this.setStatus(navigator.onLine ? 'pending' : 'offline');

        // handleSession assigns the authenticated user before its first await.
        // A second bounded attempt therefore lets login finish even if the
        // initial cloud download is temporarily unhealthy.
        const recovery = this.handleSession(user);
        return withTimeout(recovery, SESSION_TIMEOUT_MS, 'SESSION_TIMEOUT').catch(inner => {
          if (inner?.code === 'SESSION_TIMEOUT' || inner?.code === 'SYNC_TIMEOUT') {
            this.lastErrorCode = 'SYNC_TIMEOUT';
            this.running = false;
            this.setStatus(navigator.onLine ? 'pending' : 'offline');
            this.scheduleRetry?.();
          }
          throw inner;
        });
      });
    };

    cloud.signIn = async function (email, password, register) {
      try {
        const client = await withTimeout(this.client(), CLIENT_TIMEOUT_MS, 'AUTH_TIMEOUT');
        this.bindAuthListener(client, true);
        const request = register
          ? client.auth.signUp({ email, password, options: { emailRedirectTo: new URL('./', window.location.href).href } })
          : client.auth.signInWithPassword({ email, password });
        const result = await withTimeout(request, AUTH_TIMEOUT_MS, 'AUTH_TIMEOUT');
        this.authReachable = true;
        if (result.error) throw result.error;
        this.lastErrorCode = null;
        if (register && !result.data.session) return { confirmationRequired: true };

        if (result.data.session?.user) {
          try {
            await this.applySession(result.data.session.user);
          } catch (reason) {
            if (reason?.code !== 'SESSION_TIMEOUT' && reason?.code !== 'SYNC_TIMEOUT') throw reason;
            // Authentication succeeded. Do not present a sync timeout as a bad
            // password/login failure; keep the account signed in and retry sync.
            this.lastErrorCode = 'SYNC_TIMEOUT';
            this.setStatus(navigator.onLine ? 'pending' : 'offline');
            this.scheduleRetry?.();
          }
        }
        return result.data;
      } catch (reason) {
        this.lastErrorCode = reason?.code || (String(reason?.message || '').includes('network') ? 'NETWORK_ERROR' : 'SESSION_ERROR');
        this.authReachable = !['AUTH_TIMEOUT', 'NETWORK_ERROR', 'SDK_LOAD_FAILED', 'SDK_INIT_FAILED'].includes(this.lastErrorCode);
        throw reason;
      }
    };

    cloud.recoverNow = async function () {
      resetCoordination({ resetSession: true });
      this.lastErrorCode = null;
      this.setStatus(navigator.onLine ? 'syncing' : 'offline');
      try {
        this.authSubscription?.unsubscribe?.();
      } catch {}
      this.authSubscription = null;

      try {
        const client = await withTimeout(window.SeverSupabase.retry(), CLIENT_TIMEOUT_MS, 'AUTH_TIMEOUT');
        const result = await withTimeout(client.auth.getSession(), AUTH_TIMEOUT_MS, 'AUTH_TIMEOUT');
        if (result.error) throw result.error;
        this.authReachable = true;
        this.bindAuthListener(client, true);
        const session = result.data?.session || null;
        if (!session?.user) {
          await this.applySession(null);
          this.lastErrorCode = null;
          return { signedIn: false, syncPending: false };
        }

        try {
          await this.applySession(session.user);
        } catch (reason) {
          if (reason?.code !== 'SESSION_TIMEOUT' && reason?.code !== 'SYNC_TIMEOUT') throw reason;
          this.lastErrorCode = 'SYNC_TIMEOUT';
          this.setStatus(navigator.onLine ? 'pending' : 'offline');
          this.scheduleRetry?.();
          return { signedIn: true, syncPending: true };
        }

        if (this.hydrated && !this.localOnly) {
          this.syncSoon?.(0);
          queueMicrotask(() => this.pull?.());
        }
        this.lastErrorCode = null;
        return { signedIn: true, syncPending: !this.hydrated || this.status !== 'synced' };
      } catch (reason) {
        if (invalidRefreshToken(reason)) {
          try {
            const client = await this.client();
            await withTimeout(client.auth.signOut({ scope: 'local' }), CLIENT_TIMEOUT_MS, 'AUTH_TIMEOUT');
          } catch {}
          resetCoordination({ resetSession: true });
          await this.applySession(null).catch(() => {});
          this.authReachable = true;
          this.lastErrorCode = null;
          return { signedIn: false, syncPending: false, clearedBrokenSession: true };
        }
        this.lastErrorCode = reason?.code || 'NETWORK_ERROR';
        this.authReachable = false;
        this.setStatus(navigator.onLine ? 'pending' : 'offline');
        throw reason;
      }
    };

    cloud.retryBootstrap = function () {
      return this.recoverNow();
    };

    cloud.signOut = async function () {
      resetCoordination({ resetSession: true });
      this.app.lockProtectedNotes('logout');
      const client = await withTimeout(this.client(), CLIENT_TIMEOUT_MS, 'AUTH_TIMEOUT');
      const result = await withTimeout(client.auth.signOut({ scope: 'local' }), AUTH_TIMEOUT_MS, 'AUTH_TIMEOUT');
      if (result?.error) throw result.error;
      await this.applySession(null);
    };

    const dialog = document.querySelector('#accountDialog');
    const retry = document.querySelector('#accountRetry');
    const copy = document.querySelector('#accountCopy');
    let healthLine = document.querySelector('#accountHealth');
    if (!healthLine && copy) {
      healthLine = document.createElement('p');
      healthLine.id = 'accountHealth';
      healthLine.className = 'account-health';
      healthLine.setAttribute('role', 'status');
      healthLine.setAttribute('aria-live', 'polite');
      copy.after(healthLine);
    }

    function renderHealth() {
      const health = cloud.health();
      const [state, text] = statusCopy(cloud);
      if (healthLine) {
        healthLine.dataset.state = state;
        healthLine.textContent = text;
      }
      const recoverable = cloud.configured && Boolean(
        health.lastErrorCode || ['pending', 'offline'].includes(health.status)
      );
      if (retry && health.lastErrorCode !== 'SDK_LOAD_FAILED') {
        retry.classList.toggle('hidden', !recoverable);
        if (recoverable) retry.textContent = 'Восстановить связь';
      }
    }

    let busySince = 0;
    window.setInterval(() => {
      if (cloud.status === 'syncing') {
        if (!busySince) busySince = Date.now();
        if (navigator.onLine && Date.now() - busySince > WATCHDOG_MS) {
          busySince = Date.now();
          cloud.running = false;
          cloud.lastErrorCode = 'SYNC_TIMEOUT';
          cloud.setStatus('pending');
        }
      } else busySince = 0;
    }, Math.max(50, Math.min(5000, Math.floor(WATCHDOG_MS / 4))));

    window.addEventListener('sever:cloud-status', renderHealth);
    dialog?.addEventListener('toggle', () => requestAnimationFrame(renderHealth));
    document.querySelector('#openAccount')?.addEventListener('click', () => requestAnimationFrame(renderHealth));
    document.querySelector('#openAccountFromSettings')?.addEventListener('click', () => requestAnimationFrame(renderHealth));
    renderHealth();

    window.SeverCloudRecovery = Object.freeze({
      recover: () => cloud.recoverNow(),
      health: () => cloud.health(),
      timeouts: Object.freeze({ CLIENT_TIMEOUT_MS, AUTH_TIMEOUT_MS, SESSION_TIMEOUT_MS, SYNC_TIMEOUT_MS, WATCHDOG_MS })
    });
    document.documentElement.dataset.severCloudRecovery = 'ready';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(), { once: true });
  else boot();
  window.addEventListener('sever:cloud-ready', () => boot());
})();
