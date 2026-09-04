import { CLOUD_TABLES, collectionsFor, prepareState, diffCollections, queueLatest, hasPlannerData, mergeStates, rowsToState } from './sync-core.mjs?v=25';

const QUEUE_PREFIX = 'sever-cloud-queue-v2';
const MARKER_PREFIX = 'sever-cloud-migration-v2';
const CHANNEL_PREFIX = 'sever-cloud-v2';
const ACTIVE_USER_KEY = 'sever-cloud-active-user-v1';
const ANONYMOUS_STATE_KEY = 'sever-anonymous-state-v1';
const LEGACY_OWNER_KEY = 'sever-cloud-legacy-owner-v1';
const RETRIES = [1200, 3500, 12000, 30000, 60000];
const tables = Object.values(CLOUD_TABLES);
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const cloudTime = value => { const parsed = typeof value === 'number' ? value : Date.parse(value || ''); return new Date(Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now()).toISOString(); };
const keyFor = (prefix, userId) => `${prefix}:${userId}`;

const operationTime = operation => Date.parse(operation.record?.updatedAt || operation.record?.deletedAt || '') || 0;

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
    this.initializing = false;
    this.timer = null;
    this.retryIndex = 0;
    this.subscription = null;
    this.channel = null;
  }

  get configured() { return Boolean(window.SeverSupabase?.configured()); }
  get queueKey() { return this.user ? keyFor(QUEUE_PREFIX, this.user.id) : ''; }
  get markerKey() { return this.user ? keyFor(MARKER_PREFIX, this.user.id) : ''; }
  get marker() { return this.user ? read(this.markerKey, null) : null; }
  get localOnly() { return this.marker?.mode === 'local'; }
  get queued() { return this.user ? read(this.queueKey, []) : []; }

  setStatus(status) { this.status = status; this.app.setCloudStatus(status, this.user); }
  async client() { return window.SeverSupabase.getClient(); }

  queue(operations) {
    if (!this.user || this.localOnly || !operations.length) return;
    write(this.queueKey, queueLatest([...this.queued, ...operations]));
    this.setStatus(navigator.onLine ? 'pending' : 'offline');
    this.syncSoon(550);
  }

  capture() {
    if (!this.user) return;
    if (this.localOnly) {
      this.baseline = collectionsFor(this.app.getState());
      this.setStatus('local');
      return;
    }
    const next = prepareState(this.app.getState(), this.baseline);
    const changes = diffCollections(this.baseline, next);
    this.baseline = next;
    this.queue(changes);
  }

  async start() {
    if (!this.configured) { this.setStatus('local'); return; }
    try {
      const client = await this.client();
      const { data: { session } } = await client.auth.getSession();
      await this.handleSession(session?.user || null);
      client.auth.onAuthStateChange((_event, nextSession) => { this.handleSession(nextSession?.user || null).catch(() => this.setStatus('pending')); });
    } catch {
      const hint = read(ACTIVE_USER_KEY, null);
      if (hint?.id) {
        this.user = hint;
        this.app.switchStorageScope(hint.id, this.app.freshState());
        this.baseline = collectionsFor(this.app.getState());
        this.app.render();
        this.setStatus('offline');
      } else this.setStatus('offline');
    }
    window.addEventListener('online', () => this.restoreSession());
  }

  async restoreSession() {
    try {
      const client = await this.client();
      const { data: { session } } = await client.auth.getSession();
      await this.handleSession(session?.user || null);
      if (!this.localOnly) this.syncSoon(0);
    } catch { this.setStatus(this.localOnly ? 'local' : 'pending'); }
  }

  async handleSession(user) {
    if (!user) {
      const wasSignedIn = Boolean(this.user);
      this.user = null;
      localStorage.removeItem(ACTIVE_USER_KEY);
      this.subscription?.unsubscribe();
      this.subscription = null;
      this.channel?.close();
      this.channel = null;
      if (wasSignedIn) {
        const anonymousState = read(ANONYMOUS_STATE_KEY, this.app.freshState());
        this.app.switchStorageScope(null, anonymousState);
        await this.app.persist();
        this.app.render();
      }
      this.baseline = collectionsFor(this.app.getState());
      this.setStatus(this.configured ? 'signed-out' : 'local');
      return;
    }

    if (this.user?.id === user.id && this.baseline) {
      this.user = user;
      this.app.setCloudStatus(this.status, user);
      if (this.localOnly) {
        this.setStatus('local');
      } else if (navigator.onLine && !this.subscription) {
        await this.initialSync();
      }
      return;
    }

    const previousUserId = this.user?.id || null;
    const localBeforeSwitch = this.app.getState();
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.channel?.close();
    this.channel = null;

    this.user = user;
    localStorage.setItem(ACTIVE_USER_KEY, JSON.stringify({ id: user.id, email: user.email || '' }));
    const legacyOwner = localStorage.getItem(LEGACY_OWNER_KEY);
    const mayUseLocalFallback = !previousUserId && (!legacyOwner || legacyOwner === user.id);
    this.app.switchStorageScope(user.id, mayUseLocalFallback ? localBeforeSwitch : this.app.freshState());
    this.channel = 'BroadcastChannel' in window ? new BroadcastChannel(`${CHANNEL_PREFIX}:${user.id}`) : null;
    this.channel?.addEventListener('message', () => this.pull());
    this.app.render();
    await this.initialSync();
  }

  async initialSync() {
    if (!this.user || this.initializing) return;
    if (this.localOnly) {
      this.baseline = collectionsFor(this.app.getState());
      this.setStatus('local');
      return;
    }

    this.initializing = true;
    this.setStatus('syncing');
    try {
      const remoteRows = await this.fetchAll();
      const cloudEmpty = tables.every(table => !(remoteRows[table] || []).length);
      const local = this.app.getState();
      const marker = this.marker;
      this.baseline = collectionsFor(rowsToState(local, rowCollections(remoteRows)));
      if (cloudEmpty && hasPlannerData(local) && !marker) {
        this.setStatus('migration');
        window.SeverCloudUI?.showMigration(local);
        return;
      }
      const remote = rowsToState(local, rowCollections(remoteRows));
      const merged = mergeStates(local, remote);
      await this.app.replaceState(merged);
      this.baseline = collectionsFor(remote);
      this.capture();
      await this.flush();
      this.subscribe();
    } catch {
      this.setStatus(navigator.onLine ? 'pending' : 'offline');
      this.scheduleRetry();
    } finally {
      this.initializing = false;
    }
  }

  async acceptMigration() {
    if (!this.user) return;
    write(this.markerKey, { mode: 'cloud', at: Date.now() });
    localStorage.setItem(LEGACY_OWNER_KEY, this.user.id);
    write(this.queueKey, []);
    this.baseline = { tasks: new Map(), habits: new Map(), habitEntries: new Map(), notes: new Map(), folders: new Map(), focusSessions: new Map(), settings: new Map() };
    this.capture();
    await this.app.persist();
    await this.flush();
    this.subscribe();
  }

  keepLocalOnly() {
    if (!this.user) return;
    write(this.markerKey, { mode: 'local', at: Date.now() });
    write(this.queueKey, []);
    clearTimeout(this.timer);
    this.timer = null;
    this.retryIndex = 0;
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.baseline = collectionsFor(this.app.getState());
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
    if (!this.user || this.localOnly || !navigator.onLine || this.running) {
      if (this.localOnly) this.setStatus('local');
      return;
    }
    const operations = this.queued;
    if (!operations.length) { this.setStatus('synced'); return; }
    this.running = true;
    this.setStatus('syncing');
    try {
      const client = await this.client();
      for (const operation of operations) {
        const table = CLOUD_TABLES[operation.collection];
        const conflict = operation.collection === 'habitEntries' ? 'user_id,habit_id,entry_date' : operation.collection === 'settings' ? 'user_id' : 'id';
        const { error } = await client.from(table).upsert(rowFor(operation.collection, operation.record, this.user.id), { onConflict: conflict });
        if (error) throw error;
      }
      const sent = new Map(operations.map(operation => [`${operation.collection}:${operation.id}`, operationTime(operation)]));
      write(this.queueKey, this.queued.filter(operation => {
        const sentAt = sent.get(`${operation.collection}:${operation.id}`);
        return sentAt === undefined || operationTime(operation) > sentAt;
      }));
      this.retryIndex = 0;
      this.setStatus('synced');
      this.channel?.postMessage({ syncedAt: Date.now() });
    } catch {
      this.setStatus(navigator.onLine ? 'pending' : 'offline');
      this.scheduleRetry();
    } finally {
      this.running = false;
    }
  }

  async pull() {
    if (!this.user || this.localOnly || !navigator.onLine || this.running) return;
    try {
      const local = this.app.getState();
      const remote = rowsToState(local, rowCollections(await this.fetchAll()));
      const merged = mergeStates(local, remote);
      await this.app.replaceState(merged);
      this.baseline = collectionsFor(merged);
      this.setStatus('synced');
    } catch { this.setStatus('pending'); }
  }

  syncSoon(delay = 300) {
    if (this.localOnly) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), delay);
  }

  scheduleRetry() {
    if (this.localOnly) return;
    this.syncSoon(RETRIES[Math.min(this.retryIndex++, RETRIES.length - 1)]);
  }

  subscribe() {
    if (this.subscription || !this.user || this.localOnly) return;
    this.client().then(client => {
      this.subscription = client
        .channel(`sever:${this.user.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', filter: `user_id=eq.${this.user.id}` }, () => this.pull())
        .subscribe();
    });
  }

  async signIn(email, password, register) {
    const client = await this.client();
    const redirectTo = new URL('./', window.location.href).href;
    const result = register
      ? await client.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } })
      : await client.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    if (register && !result.data.session) return { confirmationRequired: true };
    return result.data;
  }

  async signOut() {
    const client = await this.client();
    const { error } = await client.auth.signOut();
    if (error) throw error;
    await this.handleSession(null);
  }
}

function counts(state) { return [{ label: 'задач', value: state.tasks.length }, { label: 'заметок', value: state.notes.length }, { label: 'привычек', value: state.habits.length }]; }
function setupUi(cloud) {
  const dialog = document.querySelector('#accountDialog');
  const form = document.querySelector('#accountForm');
  let register = false;
  const setMode = () => {
    document.querySelector('#accountTitle').textContent = register ? 'Создать аккаунт' : 'Войти в SEVER';
    document.querySelector('#accountSubmit').textContent = register ? 'Создать аккаунт' : 'Войти';
    document.querySelector('#accountMode').textContent = register ? 'У меня уже есть аккаунт' : 'Создать аккаунт';
    document.querySelector('#accountPassword').autocomplete = register ? 'new-password' : 'current-password';
  };
  const open = () => {
    if (!cloud.configured) {
      document.querySelector('#accountEyebrow').textContent = 'ЛОКАЛЬНЫЙ РЕЖИМ';
      document.querySelector('#accountCopy').textContent = 'Supabase ещё не настроен. Добавьте публичные URL и ключ в supabase-config.js — SEVER продолжит работать локально.';
      document.querySelector('#accountSubmit').disabled = true;
    } else {
      document.querySelector('#accountEyebrow').textContent = 'SEVER ACCOUNT';
      document.querySelector('#accountCopy').textContent = cloud.user
        ? cloud.localOnly
          ? `Вы вошли как ${cloud.user.email}. На этом устройстве включён локальный режим.`
          : `Вы вошли как ${cloud.user.email}.`
        : 'Войдите, чтобы безопасно синхронизировать план между устройствами.';
      document.querySelector('#accountSubmit').disabled = false;
    }
    document.querySelector('#accountSignOut').classList.toggle('hidden', !cloud.user);
    setMode();
    dialog.showModal();
  };
  document.querySelector('#openAccount')?.addEventListener('click', open);
  document.querySelector('#openAccountFromSettings')?.addEventListener('click', open);
  document.querySelector('#accountMode').addEventListener('click', () => { register = !register; setMode(); });
  document.querySelector('#accountSignOut').addEventListener('click', async () => { await cloud.signOut(); dialog.close(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const error = document.querySelector('#accountError');
    error.classList.add('hidden');
    const submit = document.querySelector('#accountSubmit');
    submit.disabled = true;
    try {
      const result = await cloud.signIn(document.querySelector('#accountEmailInput').value.trim(), document.querySelector('#accountPassword').value, register);
      if (result.confirmationRequired) {
        error.textContent = 'Проверьте почту и подтвердите адрес, затем войдите.';
        error.classList.remove('hidden');
      } else dialog.close();
    } catch (reason) {
      error.textContent = reason.message || 'Не удалось выполнить вход';
      error.classList.remove('hidden');
    } finally {
      submit.disabled = false;
    }
  });
  window.SeverCloudUI = {
    showMigration(state) {
      const root = document.querySelector('#migrationCounts');
      root.innerHTML = counts(state).map(item => `<span><b>${item.value}</b> ${item.label}</span>`).join('');
      document.querySelector('#migrationDialog').showModal();
    }
  };
  document.querySelector('#acceptMigration').addEventListener('click', async () => {
    document.querySelector('#migrationDialog').close();
    await cloud.acceptMigration();
  });
  document.querySelector('#keepLocalOnly').addEventListener('click', () => {
    cloud.keepLocalOnly();
    document.querySelector('#migrationDialog').close();
  });
}

function boot() {
  const cloud = new SeverCloud(window.SeverApp);
  window.SeverCloud = cloud;
  window.SeverApp.onLocalSave = () => cloud.capture();
  setupUi(cloud);
  cloud.start().catch(() => cloud.setStatus('pending'));
}
if (window.SeverApp) boot(); else window.addEventListener('sever:ready', boot, { once: true });
