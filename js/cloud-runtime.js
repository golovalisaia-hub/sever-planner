import { CLOUD_TABLES, collectionsFor, prepareState, diffCollections, queueLatest, hasPlannerData, mergeStates, rowsToState, settleCloudOperations } from './sync-core.mjs?v=37';

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

const operationTime = operation => Date.parse(operation.record?.updatedAt || operation.record?.deletedAt || '') || 0;
const authRedirectUrl = () => new URL('./', window.location.href).href;
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
  if (collection === 'tasks') return { ...base, id: record.id, title: record.title, scheduled_for: record.date || null, duration_minutes: record.duration, category: record.category, priority: record.priority, challenge: record.challenge, completed: record.completed, completed_at: record.completedAt ? cloudTime(record.completedAt) : null };
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
    this.poller = null;
    this.lastErrorCode = null;
    this.authReachable = false;
    this.realtimeStatus = 'idle';
    this.authSubscription = null;
    this.skipNextInitialSession = false;
    this.sessionTask = null;
    this.sessionTarget = undefined;
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
    try { this.subscription?.unsubscribe(); } catch {}
    try { this.channel?.close(); } catch {}
    this.subscription = null;
    this.realtimeStarting = null;
    this.channel = null;
    this.realtimeStatus = 'idle';
  }

  queue(operations) {
    if (!this.user || !operations.length || this.localOnly) return;
    try { operations.forEach(operation => window.SeverSecurityCore.assertCloudOperation(operation)); }
    catch { this.setStatus('pending'); return; }
    write(this.queueKey, queueLatest([...this.queued, ...operations]));
    this.setStatus(navigator.onLine ? 'pending' : 'offline');
    this.syncSoon(550);
  }

  capture() {
    // Writes are intentionally disabled before the first authenticated read completes.
    // That protects an account from a new device with empty local storage.
    if (!this.user || !this.hydrated) return;
    const next = prepareState(this.app.getState(), this.baseline);
    const changes = diffCollections(this.baseline, next);
    this.baseline = next;
    this.queue(changes);
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
      this.authReachable = false;
      this.lastErrorCode = errorCode(reason);
      const hint = read(ACTIVE_USER_KEY, null);
      if (hint?.id) {
        this.user = hint;
        this.hydrated = false;
        this.app.switchStorageScope(hint.id, this.app.freshState());
        this.baseline = collectionsFor(this.app.getState());
        this.app.render();
        this.setStatus(this.lastErrorCode === 'SDK_LOAD_FAILED' ? 'unavailable' : 'offline');
      } else this.setStatus(this.lastErrorCode === 'SDK_LOAD_FAILED' ? 'unavailable' : 'offline');
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
      if (!session?.user && !navigator.onLine && read(ACTIVE_USER_KEY, null)?.id) {
        this.setStatus('offline');
        return;
      }
      this.authReachable = true;
      this.lastErrorCode = null;
      await this.applySession(session?.user || null);
      this.bindAuthListener(client, true);
      if (this.hydrated && !this.localOnly) await this.pull();
      this.syncSoon(0);
      return true;
    } catch (reason) {
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
    this.app.switchStorageScope(user.id, this.app.getLegacyStateFor(user.id));
    this.channel = 'BroadcastChannel' in window ? new BroadcastChannel(`${CHANNEL_PREFIX}:${user.id}`) : null;
    this.channel?.addEventListener('message', () => this.pull());
    this.app.render();
    await this.initialSync();
  }

  async initialSync() {
    this.setStatus('syncing');
    try {
      const remoteRows = await this.fetchAll();
      const cloudEmpty = tables.every(table => !(remoteRows[table] || []).length);
      const local = this.app.getState();
      const marker = read(this.markerKey, null);
      const remote = rowsToState(local, rowCollections(remoteRows));
      const localHasPlannerData = hasPlannerData(local);
      this.baseline = collectionsFor(remote);

      if (cloudEmpty && localHasPlannerData && !marker) {
        this.setStatus('migration');
        window.SeverCloudUI?.showMigration(local);
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
      const merged = !cloudEmpty && !localHasPlannerData && !local.syncMeta?.seededAt ? remote : mergeStates(local, remote);
      await this.app.replaceState(merged);
      this.baseline = collectionsFor(remote);
      this.hydrated = true;
      this.capture();
      await this.flush();
      this.subscribe();
    } catch (reason) {
      this.lastErrorCode = errorCode(reason) === 'SESSION_ERROR' ? 'SYNC_ERROR' : errorCode(reason);
      this.hydrated = false;
      this.setStatus(navigator.onLine ? 'pending' : 'offline');
      this.scheduleRetry();
    }
  }

  async acceptMigration() {
    if (!this.user) return;
    write(this.markerKey, { mode: 'cloud', at: Date.now() });
    this.localOnly = false;
    this.hydrated = true;
    this.baseline = { tasks: new Map(), habits: new Map(), habitEntries: new Map(), notes: new Map(), folders: new Map(), focusSessions: new Map(), settings: new Map() };
    this.capture();
    await this.app.persist();
    await this.flush();
    this.subscribe();
  }

  keepLocalOnly() {
    if (!this.user) return;
    write(this.markerKey, { mode: 'local', at: Date.now() });
    this.localOnly = true;
    this.hydrated = true;
    this.baseline = prepareState(this.app.getState(), this.baseline);
    this.app.persist();
    this.setStatus('local');
  }

  async fetchAll() {
    const client = await this.client();
    const entries = await Promise.all(tables.map(async table => {
      const { data, error } = await client.from(table).select('*');
      if (error) throw error;
      return [table, data || []];
    }));
    return Object.fromEntries(entries);
  }

  async flush() {
    if (!this.user || !this.hydrated || this.localOnly || !navigator.onLine || this.running) return;
    const operations = this.queued;
    if (!operations.length) { this.setStatus('synced'); return; }
    this.running = true;
    this.setStatus('syncing');
    try {
      const client = await this.client();
      const { succeeded, failed } = await settleCloudOperations(operations, async operation => {
        const table = CLOUD_TABLES[operation.collection];
        const conflict = operation.collection === 'habitEntries' ? 'user_id,habit_id,entry_date' : operation.collection === 'settings' ? 'user_id' : 'id';
        const { error } = await client.from(table).upsert(rowFor(operation.collection, operation.record, this.user.id), { onConflict: conflict });
        if (error) throw error;
      });
      const sent = new Map(succeeded.map(operation => [`${operation.collection}:${operation.id}`, operationTime(operation)]));
      write(this.queueKey, this.queued.filter(operation => {
        const sentAt = sent.get(`${operation.collection}:${operation.id}`);
        return sentAt === undefined || operationTime(operation) > sentAt;
      }));
      if (failed.length) {
        this.setStatus('pending');
        this.scheduleRetry();
        return;
      }
      this.retryIndex = 0;
      this.setStatus('synced');
      this.channel?.postMessage({ syncedAt: Date.now() });
    } catch (reason) {
      this.lastErrorCode = errorCode(reason) === 'SESSION_ERROR' ? 'SYNC_ERROR' : errorCode(reason);
      this.setStatus(navigator.onLine ? 'pending' : 'offline');
      this.scheduleRetry();
    } finally {
      this.running = false;
      if (this.pullQueued) { this.pullQueued = false; this.pull(); }
    }
  }

  async pull() {
    if (!this.user || !this.hydrated || this.localOnly || !navigator.onLine) return;
    if (this.running) { this.pullQueued = true; return; }
    try {
      const local = this.app.getState();
      const remote = rowsToState(local, rowCollections(await this.fetchAll()));
      const merged = mergeStates(local, remote);
      await this.app.replaceState(merged);
      this.baseline = collectionsFor(merged);
      this.setStatus('synced');
    } catch (reason) {
      this.lastErrorCode = errorCode(reason) === 'SESSION_ERROR' ? 'SYNC_ERROR' : errorCode(reason);
      this.setStatus(navigator.onLine ? 'pending' : 'offline');
    }
  }

  syncSoon(delay = 300) { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), delay); }
  scheduleRetry() { this.syncSoon(RETRIES[Math.min(this.retryIndex++, RETRIES.length - 1)]); }

  subscribe() {
    if (this.subscription || this.realtimeStarting || !this.user || this.localOnly) return;
    const userId = this.user.id;
    this.realtimeStarting = userId;
    this.realtimeStatus = 'connecting';
    this.client().then(client => {
      if (!this.user || this.user.id !== userId || this.localOnly) return;
      const channel = client.channel(`sever:${userId}`);
      tables.forEach(table => channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `user_id=eq.${userId}` }, () => this.pull()));
      this.subscription = channel.subscribe(status => {
        if (!this.user || this.user.id !== userId) return;
        this.realtimeStatus = status === 'SUBSCRIBED' ? 'connected' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' ? 'error' : String(status || 'connecting').toLocaleLowerCase('en-US');
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') this.lastErrorCode = 'REALTIME_ERROR';
        window.dispatchEvent(new CustomEvent('sever:cloud-status', { detail: this.health() }));
      });
    }).catch(reason => {
      if (!this.user || this.user.id !== userId) return;
      this.lastErrorCode = errorCode(reason) === 'SESSION_ERROR' ? 'REALTIME_ERROR' : errorCode(reason);
      this.setStatus('pending');
    }).finally(() => { if (this.realtimeStarting === userId) this.realtimeStarting = null; });
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
  window.SeverCloudUI = {
    openAccount: open,
    health: () => cloud.health(),
    retry: () => cloud.retryBootstrap(),
    showMigration(state) { const root = document.querySelector('#migrationCounts'); root.textContent = ''; counts(state).forEach(item => { const row = document.createElement('span'), value = document.createElement('b'); value.textContent = String(item.value); row.append(value, document.createTextNode(` ${item.label}`)); root.appendChild(row); }); document.querySelector('#migrationDialog').showModal(); }
  };
  document.querySelector('#acceptMigration').addEventListener('click', async () => { document.querySelector('#migrationDialog').close(); await cloud.acceptMigration(); });
  document.querySelector('#keepLocalOnly').addEventListener('click', () => { cloud.keepLocalOnly(); document.querySelector('#migrationDialog').close(); });
}

let booted = false;
function boot() {
  if (booted || !window.SeverApp || !window.SeverSupabase) return false;
  booted = true;
  const cloud = new SeverCloud(window.SeverApp);
  window.SeverCloud = cloud;
  window.SeverApp.onLocalSave = () => cloud.capture();
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
