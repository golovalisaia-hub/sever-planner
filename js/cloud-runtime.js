import { CLOUD_TABLES, collectionsFor, prepareState, diffCollections, queueLatest, hasPlannerData, mergeStates, rowsToState, settleCloudOperations, changedCollections, changedRecordIds, stableStringify } from './sync-core.mjs?v=43';

const QUEUE_PREFIX = 'sever-cloud-queue-v2';
const MARKER_PREFIX = 'sever-cloud-migration-v2';
const CHANNEL_PREFIX = 'sever-cloud-v2';
const ACTIVE_USER_KEY = 'sever-cloud-active-user-v1';
const RETRIES = [1200, 3500, 12000, 30000, 60000];
const tables = Object.values(CLOUD_TABLES);
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const cloudTime = value => { const parsed = typeof value === 'number' ? value : Date.parse(value || ''); return new Date(Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now()).toISOString(); };
const keyFor = (prefix, userId) => `${prefix}:${userId}`;

const authRedirectUrl = () => new URL('./', window.location.href).href;
const hasInvalidRefreshToken = reason => {
  const source = String(reason?.message || reason || '').toLocaleLowerCase('en-US');
  return source.includes('invalid refresh token') || source.includes('refresh token not found');
};
const errorCode = reason => {
  if (reason?.code && /^[A-Z][A-Z0-9_]+$/.test(reason.code)) return reason.code;
  const source = String(reason?.message || reason || '').toLocaleLowerCase('en-US');
  if (source.includes('supabase sdk unavailable')) return 'SDK_LOAD_FAILED';
  if (source.includes('not configured')) return 'CONFIG_MISSING';
  if (source.includes('invalid login credentials')) return 'INVALID_CREDENTIALS';
  if (source.includes('email not confirmed')) return 'EMAIL_NOT_CONFIRMED';
  if (source.includes('rate limit') || source.includes('too many')) return 'RATE_LIMIT';
  if (source.includes('redirect')) return 'REDIRECT_MISMATCH';
  if (source.includes('fetch') || source.includes('network')) return 'NETWORK_ERROR';
  return 'SESSION_ERROR';
};
const authMessage = reason => {
  const source = String(reason?.message || reason || '').toLocaleLowerCase('ru-RU');
  if (source.includes('invalid login credentials')) return 'Неверный email или пароль.';
  if (source.includes('email not confirmed')) return 'Сначала подтвердите email по ссылке из письма.';
  if (source.includes('password') && (source.includes('least') || source.includes('weak'))) return 'Пароль должен содержать минимум 8 символов.';
  if (source.includes('valid email') || (source.includes('email address') && source.includes('invalid'))) return 'Проверьте правильность email.';
  if (source.includes('signup') && source.includes('disabled')) return 'Регистрация временно отключена.';
  if (source.includes('rate limit') || source.includes('too many')) return 'Слишком много попыток. Подождите немного и попробуйте снова.';
  if (source.includes('redirect')) return 'Не удалось вернуться в SEVER после подтверждения email. Проверьте адрес приложения.';
  if (source.includes('supabase sdk unavailable')) return 'Не удалось загрузить модуль синхронизации. Нажмите «Повторить».';
  if (source.includes('not configured')) return 'Облачная синхронизация пока не настроена.';
  if (source.includes('fetch') || source.includes('network')) return 'Нет связи с сервером. Проверьте интернет и повторите попытку.';
  return 'Не удалось выполнить вход или регистрацию. Проверьте данные и попробуйте позже.';
};

function rowFor(collection, record, userId) {
  const base = { user_id: userId, updated_at: cloudTime(record.updatedAt), deleted_at: record.deletedAt ? cloudTime(record.deletedAt) : null };
  if (collection === 'tasks') return { ...base, id: record.id, title: record.title, scheduled_for: record.date || null, scheduled_time: record.time || null, duration_minutes: record.duration, category: record.category, priority: record.priority, challenge: record.challenge, completed: record.completed, completed_at: record.completedAt ? cloudTime(record.completedAt) : null };
  if (collection === 'habits') return { ...base, id: record.id, title: record.title };
  if (collection === 'habitEntries') return { ...base, habit_id: record.habitId, entry_date: record.date, completed: !record.deletedAt && Boolean(record.completed) };
  if (collection === 'notes') return { ...base, id: record.id, folder_id: record.folderId || null, title: record.protected ? '' : record.title || '', body: record.protected ? '' : record.body || '', kind: record.kind, items: record.protected ? [] : record.items || [], done: Boolean(record.done), protected: Boolean(record.protected), secure: record.protected ? record.secure || null : null };
  if (collection === 'folders') return { ...base, id: record.id, name: record.name };
  if (collection === 'focusSessions') return { ...base, id: record.id, task_id: record.taskId || null, duration_minutes: record.durationMinutes, started_at: record.startedAt ? cloudTime(record.startedAt) : null, completed_at: record.completedAt ? cloudTime(record.completedAt) : null, status: record.status || 'completed' };
  return { ...base, data: record.data || {} };
}

function rowCollections(rows) {
  return { tasks: rows.tasks || [], habits: rows.habits || [], habitEntries: rows.habit_entries || [], notes: rows.notes || [], folders: rows.note_folders || [], focusSessions: rows.focus_sessions || [], settings: rows.user_settings || [] };
}

class SeverCloud {
  constructor(app) {
    this.app = app;
    this.user = null;
    this.status = 'local';
    this.baseline = null;
    this.running = false;
    this.timer = null;
    this.retryIndex = 0;
    this.subscription = null;
    this.realtimeStarting = null;
    this.channel = null;
    this.hydrated = false;
    this.localOnly = false;
    this.pullQueued = false;
    this.pullPromise = null;
    this.pullRequested = false;
    this.pullRetryTimer = null;
    this.poller = null;
    this.realtimeReconnectTimer = null;
    this.lastErrorCode = null;
    this.syncStage = 'idle';
    this.authReachable = false;
    this.realtimeStatus = 'idle';
    this.authSubscription = null;
    this.skipNextInitialSession = false;
    this.sessionTask = null;
    this.sessionTarget = undefined;
    this.sessionVersion = 0;
  }

  get configured() { return Boolean(window.SeverSupabase?.configured()); }
  get queueKey() { return this.user ? keyFor(QUEUE_PREFIX, this.user.id) : ''; }
  get markerKey() { return this.user ? keyFor(MARKER_PREFIX, this.user.id) : ''; }
  get queued() { return this.user ? read(this.queueKey, []) : []; }

  setStatus(status) {
    this.status = status;
    this.app.setCloudStatus(status, this.user);
    window.dispatchEvent(new CustomEvent('sever:cloud-status', { detail: this.health() }));
  }
  async client() { return window.SeverSupabase.getClient(); }

  async recoverInvalidRefreshToken(reason) {
    if (!hasInvalidRefreshToken(reason)) return false;
    try { await (await this.client()).auth.signOut({ scope: 'local' }); } catch {}
    await this.applySession(null);
    this.authReachable = true;
    this.lastErrorCode = null;
    return true;
  }

  health() {
    const base = window.SeverSupabase?.health?.() || { configured: false, sdkLoaded: false, clientReady: false, lastErrorCode: 'BOOTSTRAP_PENDING' };
    return Object.freeze({
      ...base,
      authReachable: this.authReachable,
      session: this.user ? 'signed-in' : 'signed-out',
      realtime: this.realtimeStatus,
      status: this.status,
      lastErrorCode: this.lastErrorCode || base.lastErrorCode || null
    });
  }

  applySession(user) {
    const target = user?.id || null;
    if (this.sessionTask && this.sessionTarget === target) return this.sessionTask;
    if (target !== (this.sessionTask ? this.sessionTarget : this.user?.id || null)) this.sessionVersion += 1;
    const previous = this.sessionTask?.catch(() => {}) || Promise.resolve();
    this.sessionTarget = target;
    let current;
    current = previous.then(() => this.handleSession(user)).finally(() => {
      if (this.sessionTask === current) {
        this.sessionTask = null;
        this.sessionTarget = undefined;
      }
    });
    this.sessionTask = current;
    return current;
  }

  bindAuthListener(client, skipInitialSession = false) {
    if (this.authSubscription) return;
    this.skipNextInitialSession = skipInitialSession;
    const { data } = client.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'INITIAL_SESSION' && this.skipNextInitialSession) {
        this.skipNextInitialSession = false;
        return;
      }
      queueMicrotask(() => this.handleAuthEvent(event, nextSession));
    });
    this.authSubscription = data?.subscription || { unsubscribe() {} };
  }

  clearRealtime() {
    clearTimeout(this.realtimeReconnectTimer);
    this.realtimeReconnectTimer = null;
    const activeChannel = this.subscription;
    const broadcast = this.channel;
    this.subscription = null;
    this.realtimeStarting = null;
    this.channel = null;
    this.realtimeStatus = 'idle';
    try { activeChannel?.unsubscribe()?.catch(() => {}); } catch {}
    try { broadcast?.close(); } catch {}
  }

  queue(operations) {
    if (!this.user || !operations.length || this.localOnly) return true;
    try { operations.forEach(operation => window.SeverSecurityCore.assertCloudOperation(operation)); }
    catch { this.setStatus('pending'); return false; }
    try { write(this.queueKey, queueLatest([...this.queued, ...operations])); }
    catch { this.lastErrorCode = 'LOCAL_QUEUE_ERROR'; this.setStatus('pending'); return false; }
    this.setStatus(navigator.onLine ? 'pending' : 'offline');
    this.syncSoon(550);
    return true;
  }

  capture() {
    // Writes are intentionally disabled before the first authenticated read completes.
    // That protects an account from a new device with empty local storage.
    if (!this.user || !this.hydrated) return;
    const next = prepareState(this.app.getState(), this.baseline);
    const changes = diffCollections(this.baseline, next);
    if (this.queue(changes)) this.baseline = next;
  }

  async start() {
    if (!this.configured) { this.setStatus('local'); window.SeverCloudReady = true; window.dispatchEvent(new Event('sever:cloud-ready')); return; }
    try {
      const client = await window.SeverSupabase.ready();
      const { data: { session }, error } = await client.auth.getSession();
      if (error) throw error;
      this.authReachable = true;
      this.lastErrorCode = null;
      await this.applySession(session?.user || null);
      this.bindAuthListener(client, true);
    } catch (reason) {
      if (!await this.recoverInvalidRefreshToken(reason)) {
        this.authReachable = false;
        this.lastErrorCode = errorCode(reason);
        // ACTIVE_USER_KEY is only a diagnostic hint. It never authorizes an account scope.
        this.user = null;
        this.hydrated = false;
        this.app.switchStorageScope(null, this.app.freshState());
        this.baseline = collectionsFor(this.app.getState());
        this.app.render();
        this.setStatus(this.lastErrorCode === 'SDK_LOAD_FAILED' ? 'unavailable' : 'offline');
    }
    }
    window.addEventListener('online', () => this.restoreSession());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.restoreSession(); });
    this.poller ||= window.setInterval(() => { if (document.visibilityState === 'visible') this.pull(); }, 30000);
    window.SeverCloudReady = true;
    window.dispatchEvent(new Event('sever:cloud-ready'));
  }

  async handleAuthEvent(event, nextSession) {
    try {
      this.authReachable = true;
      if (event === 'SIGNED_OUT' || event === 'USER_DELETED') await this.applySession(null);
      else if (nextSession?.user) await this.applySession(nextSession.user);
      else if (event === 'INITIAL_SESSION') await this.applySession(null);
      this.lastErrorCode = null;
    } catch (reason) {
      this.lastErrorCode = errorCode(reason) === 'SESSION_ERROR' ? 'SYNC_ERROR' : errorCode(reason);
      this.setStatus(navigator.onLine ? 'pending' : 'offline');
    }
  }

  async restoreSession({ throwOnError = false } = {}) {
    try {
      const client = await this.client();
      const { data: { session }, error } = await client.auth.getSession();
      if (error) throw error;
      this.authReachable = true;
      this.lastErrorCode = null;
      await this.applySession(session?.user || null);
      this.bindAuthListener(client, true);
      if (this.hydrated && !this.localOnly) await this.pull();
      this.syncSoon(0);
      return true;
    } catch (reason) {
      if (await this.recoverInvalidRefreshToken(reason)) return true;
      this.authReachable = false;
      this.lastErrorCode = errorCode(reason);
      this.setStatus(this.lastErrorCode === 'SDK_LOAD_FAILED' ? 'unavailable' : navigator.onLine ? 'pending' : 'offline');
      if (throwOnError) throw reason;
      return false;
    }
  }

  async handleSession(user) {
    const nextUserId = user?.id || null;
    if (this.user?.id !== nextUserId) {
      this.sessionVersion += 1;
      clearTimeout(this.timer);
      clearTimeout(this.pullRetryTimer);
      this.pullRetryTimer = null;
      this.pullQueued = false;
      this.pullRequested = false;
      this.app.lockProtectedNotes('account-change');
      this.clearRealtime();
    }
    if (!user) {
      const wasSignedIn = Boolean(this.user);
      this.user = null;
      this.hydrated = false;
      this.localOnly = false;
      localStorage.removeItem(ACTIVE_USER_KEY);
      if (wasSignedIn) {
        this.app.switchStorageScope(null, this.app.freshState());
        await this.app.persist();
        this.app.render();
      }
      this.baseline = collectionsFor(this.app.getState());
      this.setStatus(this.configured ? 'signed-out' : 'local');
      return;
    }
    if (this.user?.id === user.id && this.baseline && this.hydrated) {
      this.user = user;
      this.app.setCloudStatus(this.status, user);
      return;
    }
    this.user = user;
    this.hydrated = false;
    this.localOnly = false;
    localStorage.setItem(ACTIVE_USER_KEY, JSON.stringify({ id: user.id, email: user.email || '' }));
    // Anonymous and legacy data are never an account cache.
    this.app.switchStorageScope(user.id, this.app.freshState());
    this.channel?.close();
    this.channel = 'BroadcastChannel' in window ? new BroadcastChannel(`${CHANNEL_PREFIX}:${user.id}`) : null;
    this.channel?.addEventListener('message', () => this.pull());
    this.app.render();
    await this.initialSync();
  }

  async initialSync() {
    const userId = this.user?.id, version = this.sessionVersion;
    if (!userId) return;
    const current = () => this.user?.id === userId && this.sessionVersion === version;
    this.setStatus('syncing');
    try {
      this.syncStage = 'download';
      const remoteRows = await this.fetchAll();
      if (!current()) return;
      const cloudEmpty = tables.every(table => !(remoteRows[table] || []).length);
      const local = this.app.getState();
      const marker = read(this.markerKey, null);
      this.syncStage = 'decode';
      const remote = rowsToState(local, rowCollections(remoteRows));
      const localHasPlannerData = hasPlannerData(local);
      this.baseline = collectionsFor(remote);

      const anonymousCandidate = this.app.getAnonymousImportCandidate?.();
      const hasAnonymousCandidate = Boolean(anonymousCandidate && hasPlannerData(anonymousCandidate));
      if (hasAnonymousCandidate && !marker?.anonymousImportHandled) {
        this.syncStage = 'import-choice';
        const collections = changedCollections(local, remote);
        await this.app.replaceState(remote, { collections, recordIds: changedRecordIds(local, remote, collections), source: 'account-download' });
        if (!current()) return;
        this.baseline = collectionsFor(remote);
        this.hydrated = true;
        this.setStatus('migration');
        window.SeverCloudUI?.showMigration(anonymousCandidate, { anonymous: true });
        if (current()) this.subscribe();
        return;
      }

      if (cloudEmpty && localHasPlannerData && !marker) {
        this.setStatus('migration');
        window.SeverCloudUI?.showMigration(local, { anonymous: false });
        return;
      }
      if (cloudEmpty && marker?.mode === 'local') {
        this.localOnly = true;
        this.hydrated = true;
        this.baseline = prepareState(local, this.baseline);
        this.setStatus('local');
        return;
      }

      // A truly fresh device gets remote state directly, preventing an empty local cache
      // from receiving timestamps and racing to overwrite the account.
      this.syncStage = 'merge';
      const merged = !cloudEmpty && !localHasPlannerData && !local.syncMeta?.seededAt ? remote : mergeStates(local, remote);
      const collections = changedCollections(local, merged);
      this.syncStage = 'apply';
      await this.app.replaceState(merged, { collections, recordIds: changedRecordIds(local, merged, collections), source: 'initial-sync' });
      if (!current()) return;
      this.baseline = collectionsFor(remote);
      this.hydrated = true;
      this.syncStage = 'queue';
      this.capture();
      this.syncStage = 'upload';
      await this.flush();
      if (current()) this.subscribe();
    } catch (reason) {
      if (!current()) return;
      this.lastErrorCode = errorCode(reason) === 'SESSION_ERROR' ? 'SYNC_ERROR' : errorCode(reason);
      this.hydrated = false;
      this.setStatus(navigator.onLine ? 'pending' : 'offline');
      this.scheduleRetry();
    }
  }

  async acceptMigration({ anonymous = false } = {}) {
    if (!this.user) return;
    write(this.markerKey, { mode: 'cloud', at: Date.now(), anonymousImportHandled: Boolean(anonymous) });
    this.localOnly = false;
    if (anonymous) {
      const candidate = this.app.getAnonymousImportCandidate?.() || this.app.freshState();
      const before = this.app.getState();
      const merged = mergeStates(before, candidate);
      const collections = changedCollections(before, merged);
      await this.app.replaceState(merged, { collections, recordIds: changedRecordIds(before, merged, collections), source: 'confirmed-anonymous-import' });
    }
    this.hydrated = true;
    this.baseline = this.baseline || { tasks: new Map(), habits: new Map(), habitEntries: new Map(), notes: new Map(), folders: new Map(), focusSessions: new Map(), settings: new Map() };
    this.capture();
    await this.app.persist();
    await this.flush();
    this.subscribe();
  }

  keepLocalOnly({ anonymous = false } = {}) {
    if (!this.user) return;
    if (anonymous) {
      const marker = read(this.markerKey, {});
      write(this.markerKey, { ...marker, anonymousImportHandled: true, at: Date.now() });
      this.setStatus('synced');
      return;
    }
    write(this.markerKey, { mode: 'local', at: Date.now() });
    this.localOnly = true;
    this.hydrated = true;
    this.baseline = prepareState(this.app.getState(), this.baseline);
    this.app.persist();
    this.setStatus('local');
  }
  async fetchAll() {
    const userId = this.user?.id, version = this.sessionVersion;
    const client = await this.client();
    const entries = await Promise.all(tables.map(async table => {
      const rows = [], pageSize = 500;
      for (let offset = 0; ; offset += pageSize) {
        if (this.user?.id !== userId || this.sessionVersion !== version) throw new Error('Session changed');
        const { data, error } = await client.from(table).select('*').eq('user_id', userId)
          .order(table === 'user_settings' ? 'user_id' : 'id').range(offset, offset + pageSize - 1);
        if (error) {
          // Preserve the failing collection for a useful, non-sensitive UI
          // diagnosis instead of leaving the user at a generic pending state.
          error.code = `SYNC_TABLE_${table.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
          throw error;
        }
        rows.push(...(data || []));
        if (!data || data.length < pageSize) break;
      }
      return [table, rows];
    }));
    return Object.fromEntries(entries);
  }

  async flush() {
    if (!this.user || !this.hydrated || this.localOnly || !navigator.onLine || this.running) return;
    const operations = this.queued;
    if (!operations.length) { this.setStatus('synced'); return; }
    const userId = this.user.id, queueKey = this.queueKey, version = this.sessionVersion;
    const current = () => this.user?.id === userId && this.sessionVersion === version && !this.localOnly;
    let retryScheduled = false;
    this.running = true;
    this.setStatus('syncing');
    try {
      const client = await this.client();
      const { succeeded, failed } = await settleCloudOperations(operations, async operation => {
        if (!current()) throw new Error('Session changed');
        const table = CLOUD_TABLES[operation.collection];
        const conflict = operation.collection === 'habitEntries' ? 'user_id,habit_id,entry_date' : operation.collection === 'settings' ? 'user_id' : 'id';
        const { error } = await client.from(table).upsert(rowFor(operation.collection, operation.record, userId), { onConflict: conflict });
        if (error) throw error;
      });
      if (!current()) return;
      const sent = new Map(succeeded.map(operation => [`${operation.collection}:${operation.id}`, stableStringify(operation.record)]));
      write(queueKey, read(queueKey, []).filter(operation => {
        const sentRecord = sent.get(`${operation.collection}:${operation.id}`);
        return sentRecord === undefined || stableStringify(operation.record) !== sentRecord;
      }));
      if (failed.length) {
        const failure = failed[0];
        const code = String(failure.error?.code || 'UNKNOWN');
        this.lastErrorCode = `SYNC_WRITE_${CLOUD_TABLES[failure.operation.collection].toUpperCase()}_${/^[A-Z0-9_]+$/.test(code) ? code : 'UNKNOWN'}`;
        this.setStatus('pending');
        this.scheduleRetry();
        retryScheduled = true;
        return;
      }
      this.retryIndex = 0;
      this.setStatus(this.queued.length ? 'pending' : 'synced');
      this.channel?.postMessage({ syncedAt: Date.now() });
    } catch (reason) {
      if (!current()) return;
      this.lastErrorCode = errorCode(reason) === 'SESSION_ERROR' ? 'SYNC_ERROR' : errorCode(reason);
      this.setStatus(navigator.onLine ? 'pending' : 'offline');
      this.scheduleRetry();
      retryScheduled = true;
    } finally {
      this.running = false;
      if (!retryScheduled && this.user && this.hydrated && !this.localOnly && this.queued.length) this.syncSoon(0);
      if (this.pullQueued) { this.pullQueued = false; this.pull(); }
    }
  }

  async pull() {
    if (!this.user || !this.hydrated || this.localOnly || !navigator.onLine) return;
    if (this.running) { this.pullQueued = true; return; }
    if (this.pullPromise) { this.pullRequested = true; return this.pullPromise; }
    const userId = this.user.id;
    const version = this.sessionVersion;
    this.pullPromise = (async () => {
      try {
        const remoteRows = await this.fetchAll();
        if (!this.user || this.user.id !== userId || this.sessionVersion !== version || this.localOnly) return;
        const local = this.app.getState();
        const remote = rowsToState(local, rowCollections(remoteRows));
        const merged = mergeStates(local, remote);
        const collections = changedCollections(local, merged);
        await this.app.replaceState(merged, { collections, recordIds: changedRecordIds(local, merged, collections), source: 'background-sync' });
        if (this.user?.id !== userId || this.sessionVersion !== version || this.localOnly) return;

        // Keep the server snapshot as the baseline. Any newer local record is
        // then re-queued instead of being silently treated as already synced.
        this.baseline = collectionsFor(remote);
        this.capture();
        clearTimeout(this.pullRetryTimer);
        this.pullRetryTimer = null;
        this.retryIndex = 0;
        if (this.queued.length) this.syncSoon(0);
        else this.setStatus('synced');
        this.lastErrorCode = null;
      } catch (reason) {
        if (!this.user || this.user.id !== userId || this.sessionVersion !== version) return;
        this.lastErrorCode = errorCode(reason) === 'SESSION_ERROR' ? 'SYNC_ERROR' : errorCode(reason);
        this.setStatus(navigator.onLine ? 'pending' : 'offline');
        this.schedulePullRetry();
      }
    })().finally(() => {
      this.pullPromise = null;
      if (this.pullRequested) {
        this.pullRequested = false;
        queueMicrotask(() => this.pull());
      }
    });
    return this.pullPromise;
  }

  syncSoon(delay = 300) { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), delay); }
  scheduleRetry() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.user || this.localOnly) return;
      return this.hydrated ? this.flush() : this.restoreSession();
    }, RETRIES[Math.min(this.retryIndex++, RETRIES.length - 1)]);
  }
  schedulePullRetry() {
    clearTimeout(this.pullRetryTimer);
    const delay = RETRIES[Math.min(this.retryIndex++, RETRIES.length - 1)];
    this.pullRetryTimer = window.setTimeout(() => {
      this.pullRetryTimer = null;
      this.pull();
    }, delay);
  }

  subscribe() {
    if (this.subscription || this.realtimeStarting || !this.user || this.localOnly) return;
    const userId = this.user.id;
    const attempt = { userId, version: this.sessionVersion };
    this.realtimeStarting = attempt;
    this.realtimeStatus = 'connecting';
    this.client().then(client => {
      if (!this.user || this.user.id !== userId || this.localOnly || this.realtimeStarting !== attempt || this.sessionVersion !== attempt.version) return;
      const channel = client.channel(`sever:${userId}`);
      tables.forEach(table => channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `user_id=eq.${userId}` }, () => this.pull()));
      this.subscription = channel;
      channel.subscribe(status => {
        if (!this.user || this.user.id !== userId || this.subscription !== channel || this.sessionVersion !== attempt.version) return;
        const failed = status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED';
        this.realtimeStatus = status === 'SUBSCRIBED' ? 'connected' : failed ? 'error' : String(status || 'connecting').toLocaleLowerCase('en-US');
        if (status === 'SUBSCRIBED') {
          clearTimeout(this.realtimeReconnectTimer);
          this.realtimeReconnectTimer = null;
          if (this.lastErrorCode === 'REALTIME_ERROR') this.lastErrorCode = null;
        } else if (failed) {
          this.lastErrorCode = 'REALTIME_ERROR';
          this.subscription = null;
          if (status !== 'CLOSED') {
            try { channel.unsubscribe()?.catch(() => {}); } catch {}
          }
          clearTimeout(this.realtimeReconnectTimer);
          this.realtimeReconnectTimer = window.setTimeout(() => {
            this.realtimeReconnectTimer = null;
            if (this.user?.id === userId && this.sessionVersion === attempt.version && navigator.onLine && !this.localOnly) this.subscribe();
          }, 3000);
        }
        window.dispatchEvent(new CustomEvent('sever:cloud-status', { detail: this.health() }));
      });
    }).catch(reason => {
      if (!this.user || this.user.id !== userId || this.realtimeStarting !== attempt) return;
      this.lastErrorCode = errorCode(reason) === 'SESSION_ERROR' ? 'REALTIME_ERROR' : errorCode(reason);
      this.setStatus('pending');
      clearTimeout(this.realtimeReconnectTimer);
      this.realtimeReconnectTimer = window.setTimeout(() => {
        this.realtimeReconnectTimer = null;
        if (this.user?.id === userId && this.sessionVersion === attempt.version && !this.localOnly) this.subscribe();
      }, 3000);
    }).finally(() => { if (this.realtimeStarting === attempt) this.realtimeStarting = null; });
  }

  async signIn(email, password, register) {
    try {
      const client = await this.client();
      this.bindAuthListener(client, true);
      const result = register
        ? await client.auth.signUp({ email, password, options: { emailRedirectTo: authRedirectUrl() } })
        : await client.auth.signInWithPassword({ email, password });
      this.authReachable = true;
      if (result.error) throw result.error;
      this.lastErrorCode = null;
      if (register && !result.data.session) return { confirmationRequired: true };
      if (result.data.session?.user) await this.applySession(result.data.session.user);
      return result.data;
    } catch (reason) {
      this.lastErrorCode = errorCode(reason);
      this.authReachable = !['SDK_LOAD_FAILED', 'SDK_INIT_FAILED', 'NETWORK_ERROR'].includes(this.lastErrorCode);
      throw reason;
    }
  }

  async signOut() {
    this.app.lockProtectedNotes('logout');
    const client = await this.client();
    const { error } = await client.auth.signOut();
    if (error) throw error;
    await this.applySession(null);
  }

  async retryBootstrap() {
    try {
      this.authSubscription?.unsubscribe();
      this.authSubscription = null;
      await window.SeverSupabase.retry();
      this.lastErrorCode = null;
      await this.restoreSession({ throwOnError: true });
      return true;
    } catch (reason) {
      this.lastErrorCode = errorCode(reason);
      this.setStatus(this.lastErrorCode === 'SDK_LOAD_FAILED' ? 'unavailable' : navigator.onLine ? 'pending' : 'offline');
      throw reason;
    }
  }
}
function counts(state) { return [{ label: 'задач', value: state.tasks.length }, { label: 'заметок', value: state.notes.length }, { label: 'привычек', value: state.habits.length }]; }
function setupUi(cloud) {
  const dialog = document.querySelector('#accountDialog');
  const form = document.querySelector('#accountForm');
  const error = document.querySelector('#accountError');
  const submit = document.querySelector('#accountSubmit');
  const mode = document.querySelector('#accountMode');
  const emailInput = document.querySelector('#accountEmailInput');
  const passwordInput = document.querySelector('#accountPassword');
  const retry = document.querySelector('#accountRetry');
  let register = false;
  const clearNotice = () => { error.textContent = ''; error.classList.add('hidden'); error.classList.remove('success'); };
  const setMode = () => {
    document.querySelector('#accountTitle').textContent = cloud.user ? 'Аккаунт SEVER' : register ? 'Создать аккаунт' : 'Войти в SEVER';
    submit.textContent = register ? 'Создать аккаунт' : 'Войти';
    mode.textContent = register ? 'У меня уже есть аккаунт' : 'Создать аккаунт';
    passwordInput.autocomplete = register ? 'new-password' : 'current-password';
    document.querySelector('#accountCopy').textContent = !cloud.configured
      ? 'Облачная синхронизация пока не настроена. SEVER продолжит надёжно работать на этом устройстве.'
      : cloud.user
      ? `Вы вошли как ${cloud.user.email}. Данные синхронизируются через защищённое облако.`
      : register
        ? 'Укажите email и пароль. После регистрации подтвердите адрес по ссылке из письма.'
        : 'Войдите, чтобы безопасно синхронизировать план между устройствами.';
  };
  const open = () => {
    window.SeverUiState?.begin('accountDialog');
    for (const id of ['localProfileDialog', 'moreDialog']) { const parent = document.querySelector(`#${id}`); if (parent?.open) parent.close(); }
    register = false;
    form.reset();
    clearNotice();
    document.querySelector('#accountEyebrow').textContent = cloud.configured ? 'SEVER ACCOUNT' : 'ЛОКАЛЬНЫЙ РЕЖИМ';
    const signedIn = Boolean(cloud.user);
    const sdkUnavailable = cloud.health().lastErrorCode === 'SDK_LOAD_FAILED';
    emailInput.closest('label').classList.toggle('hidden', signedIn);
    passwordInput.closest('label').classList.toggle('hidden', signedIn);
    submit.classList.toggle('hidden', signedIn);
    mode.classList.toggle('hidden', signedIn);
    document.querySelector('#accountSignOut').classList.toggle('hidden', !signedIn);
    submit.disabled = !cloud.configured || sdkUnavailable;
    retry.classList.toggle('hidden', !sdkUnavailable);
    if (!cloud.configured) document.querySelector('#accountCopy').textContent = 'Облачная синхронизация пока не настроена. SEVER продолжит надёжно работать на этом устройстве.';
    setMode();
    if (sdkUnavailable) document.querySelector('#accountCopy').textContent = 'Не удалось загрузить модуль синхронизации. Проверьте соединение и попробуйте снова.';
    if (!dialog.open) dialog.showModal();
    if (!signedIn) requestAnimationFrame(() => emailInput.focus());
  };
  document.querySelector('#openAccount')?.addEventListener('click', open);
  document.querySelector('#openAccountFromSettings')?.addEventListener('click', open);
  retry.addEventListener('click', async () => {
    clearNotice();
    if (cloud.health().lastErrorCode === 'SDK_LOAD_FAILED') {
      window.location.reload();
      return;
    }
    retry.disabled = true;
    retry.textContent = 'Проверяем…';
    try { await cloud.retryBootstrap(); open(); }
    catch (reason) { error.textContent = authMessage(reason); error.classList.remove('hidden'); }
    finally { retry.disabled = false; retry.textContent = 'Повторить'; }
  });
  mode.addEventListener('click', () => { register = !register; clearNotice(); setMode(); });
  document.querySelector('#accountSignOut').addEventListener('click', async () => { clearNotice(); try { await cloud.signOut(); dialog.close(); } catch (reason) { error.textContent = authMessage(reason); error.classList.remove('hidden'); } });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    clearNotice();
    const wasRegistering = register;
    const idleLabel = wasRegistering ? 'Создать аккаунт' : 'Войти';
    submit.disabled = true;
    submit.textContent = wasRegistering ? 'Создаём…' : 'Входим…';
    try {
      const result = await cloud.signIn(emailInput.value.trim(), passwordInput.value, wasRegistering);
      if (result.confirmationRequired) {
        register = false;
        error.textContent = 'Аккаунт создан. Откройте письмо, подтвердите email и вернитесь сюда для входа.';
        error.classList.add('success');
        error.classList.remove('hidden');
        passwordInput.value = '';
        setMode();
      } else dialog.close();
    } catch (reason) {
      error.textContent = authMessage(reason);
      error.classList.remove('hidden');
      passwordInput.value = '';
    } finally {
      submit.disabled = false;
      if (dialog.open && !error.classList.contains('success')) submit.textContent = idleLabel;
    }
  });
  let migrationKind = 'account-cache';
  window.SeverCloudUI = {
    openAccount: open,
    health: () => cloud.health(),
    retry: () => cloud.retryBootstrap(),
    showMigration(state, { anonymous = false } = {}) {
      migrationKind = anonymous ? 'anonymous' : 'account-cache';
      const root = document.querySelector('#migrationCounts');
      root.textContent = '';
      counts(state).forEach(item => { const row = document.createElement('span'), value = document.createElement('b'); value.textContent = String(item.value); row.append(value, document.createTextNode(` ${item.label}`)); root.appendChild(row); });
      document.querySelector('#migrationDialog').showModal();
    }
  };
  document.querySelector('#acceptMigration').addEventListener('click', async () => { document.querySelector('#migrationDialog').close(); await cloud.acceptMigration({ anonymous: migrationKind === 'anonymous' }); });
  document.querySelector('#keepLocalOnly').addEventListener('click', () => { cloud.keepLocalOnly({ anonymous: migrationKind === 'anonymous' }); document.querySelector('#migrationDialog').close(); });
}

let booted = false;
function boot() {
  if (booted || !window.SeverApp || !window.SeverSupabase) return false;
  booted = true;
  const cloud = new SeverCloud(window.SeverApp);
  window.SeverCloud = cloud;
  window.SeverApp.beforeLocalSave = () => cloud.capture();
  setupUi(cloud);
  cloud.start().catch(() => cloud.setStatus('pending'));
  return true;
}
const tryBoot = () => boot();
if (!tryBoot()) {
  window.addEventListener('sever:ready', tryBoot, { once: true });
  window.addEventListener('sever:supabase-ready', tryBoot, { once: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryBoot, { once: true });
  else queueMicrotask(tryBoot);
}
