// In-memory doubles for the TAVRO Edge Functions: a PostgREST-shaped client, a
// Telegram Bot API recorder, and scripted AI/speech providers. Enough of the
// real contract to exercise the actual handlers — quota claims, idempotency,
// ownership filters and reminder scheduling all run for real against this.

import { randomUUID } from 'node:crypto';

const DEFAULTS = {
  tavro_accounts: () => ({ id: randomUUID(), timezone: 'Europe/Moscow', timezone_source: 'default', reminders_enabled: true, first_name: '', username: null, language_code: null, sever_user_id: null, onboarded_at: null, deleted_at: null, created_at: now(), updated_at: now(), last_seen_at: now() }),
  tavro_tasks: () => ({ id: randomUUID(), title: '', details: null, scheduled_for: null, scheduled_time: null, duration_minutes: null, category: 'Личное', priority: false, completed: false, completed_at: null, source: 'text', capture_id: null, deleted_at: null, created_at: now(), updated_at: now() }),
  tavro_events: () => ({ id: randomUUID(), title: '', details: null, event_date: null, event_time: null, duration_minutes: 60, timezone: 'Europe/Moscow', starts_at: null, ends_at: null, location: null, participants: [], status: 'planned', source: 'text', capture_id: null, deleted_at: null, created_at: now(), updated_at: now() }),
  tavro_notes: () => ({ id: randomUUID(), kind: 'note', title: '', body: '', entry_date: null, tags: [], photo_file_id: null, photo_summary: null, photo_summary_is_estimate: true, source: 'text', capture_id: null, deleted_at: null, created_at: now(), updated_at: now() }),
  tavro_habits: () => ({ id: randomUUID(), title: '', target_per_week: 7, deleted_at: null, created_at: now(), updated_at: now() }),
  tavro_habit_entries: () => ({ id: randomUUID(), completed: true, created_at: now(), updated_at: now() }),
  tavro_captures: () => ({ id: randomUUID(), status: 'pending', draft: {}, raw_text: null, transcript: null, chat_id: null, message_id: null, ai_request_id: null, created_record_ids: [], confirmed_at: null, created_at: now(), updated_at: now() }),
  tavro_ai_usage: () => ({ billable: true, latency_ms: 0, input_tokens: 0, output_tokens: 0, audio_seconds: 0, success: null, error_code: null, provider: null, model: null, created_at: now() }),
  tavro_subscriptions: () => ({ plan: 'free', status: 'active', current_period_end: null, auto_renew: false, telegram_charge_id: null, terms_version: 'v1', granted_at: now(), updated_at: now() }),
  tavro_payments: () => ({ currency: 'XTR', status: 'paid', is_recurring: false, is_first_recurring: false, subscription_expiration_date: null, refunded_at: null, created_at: now() }),
  tavro_reminders: () => ({ id: randomUUID(), status: 'scheduled', attempts: 0, sent_at: null, error_code: null, created_at: now(), updated_at: now() }),
  tavro_quick_tokens: () => ({ id: randomUUID(), label: 'Быстрый ввод', scope: 'capture', uses: 0, last_used_at: null, expires_at: null, revoked_at: null, created_at: now() }),
};

const UNIQUE_KEYS = {
  tavro_accounts: ['telegram_id'],
  tavro_payments: ['telegram_payment_charge_id'],
  tavro_ai_usage: ['request_id'],
  tavro_subscriptions: ['account_id'],
  tavro_reminders: ['target_kind', 'target_id', 'kind', 'remind_at'],
  tavro_habit_entries: ['habit_id', 'entry_date'],
};

function now() { return new Date().toISOString(); }

const compare = (a, b) => (a === null || a === undefined ? '' : String(a)).localeCompare(b === null || b === undefined ? '' : String(b));

class Query {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.filters = [];
    this.operation = 'select';
    this.payload = null;
    this.orderBy = null;
    this.limitTo = Infinity;
    this.conflict = null;
    this.ignoreDuplicates = false;
    this.returning = false;
  }

  select() { this.returning = true; return this; }
  eq(column, value) { this.filters.push(row => String(row[column]) === String(value)); return this; }
  neq(column, value) { this.filters.push(row => String(row[column]) !== String(value)); return this; }
  is(column, value) { this.filters.push(row => (value === null ? row[column] === null || row[column] === undefined : row[column] === value)); return this; }
  not(column, operator, value) { if (operator === 'is' && value === null) this.filters.push(row => row[column] !== null && row[column] !== undefined); return this; }
  lt(column, value) { this.filters.push(row => row[column] !== null && row[column] !== undefined && row[column] < value); return this; }
  lte(column, value) { this.filters.push(row => row[column] !== null && row[column] !== undefined && row[column] <= value); return this; }
  gte(column, value) { this.filters.push(row => row[column] !== null && row[column] !== undefined && row[column] >= value); return this; }
  in(column, values) { this.filters.push(row => values.includes(row[column])); return this; }
  ilike(column, pattern) {
    const needle = String(pattern).replace(/%/g, '').toLowerCase();
    this.filters.push(row => String(row[column] ?? '').toLowerCase().includes(needle));
    return this;
  }
  or(expression) {
    // Only the shapes the product actually builds: `col.ilike.%x%` joined by commas.
    const clauses = String(expression).split(',').map(clause => clause.trim()).filter(Boolean);
    this.filters.push(row => clauses.some(clause => {
      const [column, operator, ...rest] = clause.split('.');
      const value = rest.join('.');
      if (operator === 'ilike') return String(row[column] ?? '').toLowerCase().includes(value.replace(/%/g, '').toLowerCase());
      if (operator === 'cs') {
        const wanted = value.replace(/[{}"]/g, '').toLowerCase();
        return (row[column] || []).some(entry => String(entry).toLowerCase() === wanted);
      }
      return false;
    }));
    return this;
  }
  order(column, options = {}) { this.orderBy = { column, ascending: options.ascending !== false }; return this; }
  limit(count) { this.limitTo = count; return this; }
  insert(values) { this.operation = 'insert'; this.payload = values; return this; }
  update(values) { this.operation = 'update'; this.payload = values; return this; }
  upsert(values, options = {}) {
    this.operation = 'upsert'; this.payload = values;
    this.conflict = options.onConflict ? options.onConflict.split(',') : null;
    this.ignoreDuplicates = options.ignoreDuplicates === true;
    return this;
  }
  delete() { this.operation = 'delete'; return this; }

  rows() {
    const all = this.db.tables[this.table] || [];
    let matched = all.filter(row => this.filters.every(check => check(row)));
    if (this.orderBy) {
      matched = [...matched].sort((a, b) => (this.orderBy.ascending ? 1 : -1) * compare(a[this.orderBy.column], b[this.orderBy.column]));
    }
    return matched.slice(0, this.limitTo);
  }

  run() {
    const table = this.table;
    this.db.tables[table] = this.db.tables[table] || [];
    const store = this.db.tables[table];

    if (this.operation === 'insert' || this.operation === 'upsert') {
      const incoming = Array.isArray(this.payload) ? this.payload : [this.payload];
      const written = [];
      for (const value of incoming) {
        const keys = UNIQUE_KEYS[table] || [];
        const existing = keys.length
          ? store.find(row => keys.every(key => String(row[key]) === String(value[key])))
          : null;
        if (existing) {
          if (this.operation === 'insert') return { data: null, error: { code: '23505', message: 'duplicate key' } };
          if (this.ignoreDuplicates) { written.push(existing); continue; }
          Object.assign(existing, value, { updated_at: now() });
          written.push(existing);
          continue;
        }
        const row = { ...(DEFAULTS[table] ? DEFAULTS[table]() : { id: randomUUID() }), ...value };
        store.push(row);
        written.push(row);
      }
      return { data: written.map(row => ({ ...row })), error: null };
    }

    if (this.operation === 'update') {
      const matched = this.rows();
      for (const row of matched) Object.assign(row, this.payload);
      return { data: matched.map(row => ({ ...row })), error: null };
    }

    if (this.operation === 'delete') {
      const matched = this.rows();
      this.db.tables[table] = store.filter(row => !matched.includes(row));
      return { data: matched.map(row => ({ ...row })), error: null };
    }

    return { data: this.rows().map(row => ({ ...row })), error: null };
  }

  async single() {
    const result = this.run();
    if (result.error) return result;
    const rows = result.data || [];
    if (rows.length !== 1) return { data: rows[0] ?? null, error: rows.length ? null : { code: 'PGRST116', message: 'no rows' } };
    return { data: rows[0], error: null };
  }

  async maybeSingle() {
    const result = this.run();
    if (result.error) return result;
    return { data: (result.data || [])[0] ?? null, error: null };
  }

  then(resolve, reject) { return Promise.resolve(this.run()).then(resolve, reject); }
}

export function createFakeDb() {
  const db = {
    tables: {},
    updates: new Set(),
    rateHits: new Map(),
    from(table) { return new Query(db, table); },
    async rpc(name, args) {
      if (name === 'tavro_claim_update') {
        if (db.updates.has(args.p_update_id)) return { data: false, error: null };
        db.updates.add(args.p_update_id);
        return { data: true, error: null };
      }
      if (name === 'tavro_claim_ai_action') {
        const usage = db.tables.tavro_ai_usage = db.tables.tavro_ai_usage || [];
        if (usage.some(row => row.request_id === args.p_request_id)) return { data: null, error: { code: '23505' } };
        usage.push({ ...DEFAULTS.tavro_ai_usage(), request_id: args.p_request_id, account_id: args.p_account, kind: args.p_kind, usage_date: args.p_usage_date, provider: args.p_provider, model: args.p_model });
        if (args.p_limit < 0) return { data: true, error: null };
        const used = usage.filter(row => row.account_id === args.p_account && row.usage_date === args.p_usage_date && row.billable && row.success !== false).length;
        if (used > args.p_limit) {
          db.tables.tavro_ai_usage = usage.filter(row => row.request_id !== args.p_request_id);
          return { data: false, error: null };
        }
        return { data: true, error: null };
      }
      if (name === 'tavro_release_ai_action') {
        for (const row of db.tables.tavro_ai_usage || []) {
          if (row.request_id === args.p_request_id) Object.assign(row, { billable: false, success: false, error_code: args.p_error });
        }
        return { data: null, error: null };
      }
      if (name === 'tavro_rate_check') {
        const key = `${args.p_account}:${args.p_bucket}`;
        const hits = (db.rateHits.get(key) || 0) + 1;
        db.rateHits.set(key, hits);
        return { data: hits <= args.p_limit, error: null };
      }
      if (name === 'tavro_claim_reminders') {
        const due = (db.tables.tavro_reminders || [])
          .filter(row => row.status === 'scheduled' && Date.parse(row.remind_at) <= Date.now())
          .slice(0, args?.p_limit ?? 50);
        for (const row of due) Object.assign(row, { status: 'sent', attempts: row.attempts + 1, sent_at: now() });
        return { data: due.map(row => ({ ...row })), error: null };
      }
      return { data: null, error: { code: 'UNKNOWN_RPC', message: name } };
    },
  };
  return db;
}

export function createFakeTelegram(overrides = {}) {
  let messageId = 1000;
  const calls = [];
  const api = {
    calls,
    token: 'test-token',
    sent: () => calls.filter(call => call.method === 'sendMessage'),
    lastText: () => [...calls].reverse().find(call => call.method === 'sendMessage' || call.method === 'editMessageText')?.payload?.text || '',
    async call(method, payload) {
      calls.push({ method, payload });
      if (overrides[method]) return overrides[method](payload);
      if (method === 'sendMessage' || method === 'editMessageText') return { message_id: (messageId += 1), text: payload.text };
      if (method === 'createInvoiceLink') return 'https://t.me/invoice/test';
      if (method === 'getFile') return { file_path: 'voice/file_1.oga' };
      return true;
    },
    sendMessage(chatId, text, extra = {}) { return api.call('sendMessage', { chat_id: chatId, text, ...extra }); },
    editMessageText(chatId, id, text, extra = {}) { return api.call('editMessageText', { chat_id: chatId, message_id: id, text, ...extra }); },
    answerCallbackQuery(id, extra = {}) { return api.call('answerCallbackQuery', { callback_query_id: id, ...extra }); },
    answerPreCheckoutQuery(id, ok, errorMessage) { return api.call('answerPreCheckoutQuery', { pre_checkout_query_id: id, ok, error_message: errorMessage }); },
    sendChatAction(chatId, action) { return api.call('sendChatAction', { chat_id: chatId, action }); },
    createInvoiceLink(invoice) { return api.call('createInvoiceLink', invoice); },
    refundStarPayment(userId, chargeId) { return api.call('refundStarPayment', { user_id: userId, telegram_payment_charge_id: chargeId }); },
    editUserStarSubscription(userId, chargeId, isCanceled) { return api.call('editUserStarSubscription', { user_id: userId, telegram_payment_charge_id: chargeId, is_canceled: isCanceled }); },
    getFile(fileId) { return api.call('getFile', { file_id: fileId }); },
    downloadFile: overrides.downloadFile || (async () => new Uint8Array([1, 2, 3, 4])),
  };
  return api;
}

export function scriptedProvider(replies) {
  const queue = Array.isArray(replies) ? [...replies] : [replies];
  const seen = [];
  return {
    name: 'test-provider',
    model: 'test-model',
    seen,
    async complete(input) {
      seen.push(input);
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next instanceof Error) throw next;
      return { json: typeof next === 'function' ? next(input) : next, raw: JSON.stringify(next), usage: { inputTokens: 10, outputTokens: 20 } };
    },
  };
}

export function scriptedSpeech(text) {
  return {
    name: 'test-speech',
    async transcribe(input) {
      if (text instanceof Error) throw text;
      return { text, seconds: input.durationSeconds, provider: 'test-speech' };
    },
  };
}

export const BOT_TOKEN = '1234567890:TEST-token-not-a-real-bot-credential';
export const WEBHOOK_SECRET = 'webhook-secret-value-32-characters';

export function botEnv(extra = {}) {
  const values = {
    TAVRO_BOT_TOKEN: BOT_TOKEN,
    TAVRO_WEBHOOK_SECRET: WEBHOOK_SECRET,
    SUPABASE_URL: 'https://test.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
    TAVRO_MINIAPP_URL: 'https://golovalisaia-hub.github.io/sever-planner/tavro/',
    TAVRO_AI_PROVIDER: 'groq',
    TAVRO_AI_API_KEY: 'test-ai-key',
    TAVRO_AI_MODEL: 'test-model',
    TAVRO_SPEECH_PROVIDER: 'whisper',
    TAVRO_SPEECH_API_KEY: 'test-speech-key',
    TAVRO_SPEECH_BASE_URL: 'https://speech.test.invalid/v1/audio/transcriptions',
    ...extra,
  };
  return name => values[name];
}

export function webhookRequest(update, { secret = WEBHOOK_SECRET } = {}) {
  return new Request('https://test.invalid/functions/v1/tavro-bot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
    body: JSON.stringify(update),
  });
}

let updateCounter = 5000;
export const nextUpdateId = () => (updateCounter += 1);

export const telegramUser = { id: 777001, first_name: 'Лиса', username: 'tavro_owner', language_code: 'ru' };

export function textUpdate(text, { messageId = 1, from = telegramUser, chatId = from.id } = {}) {
  return { update_id: nextUpdateId(), message: { message_id: messageId, chat: { id: chatId, type: 'private' }, from, date: Math.floor(Date.now() / 1000), text } };
}

export function callbackUpdate(data, { messageId = 1000, from = telegramUser, chatId = from.id, id = 'cb-1' } = {}) {
  return { update_id: nextUpdateId(), callback_query: { id, from, data, message: { message_id: messageId, chat: { id: chatId, type: 'private' } } } };
}

export function voiceUpdate({ duration = 6, messageId = 2, from = telegramUser, fileSize = 12000 } = {}) {
  return { update_id: nextUpdateId(), message: { message_id: messageId, chat: { id: from.id, type: 'private' }, from, date: Math.floor(Date.now() / 1000), voice: { file_id: 'voice-file-1', duration, mime_type: 'audio/ogg', file_size: fileSize } } };
}
