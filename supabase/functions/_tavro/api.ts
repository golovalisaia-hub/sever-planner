// Mini App API.
//
// Identity comes from a verified Telegram initData signature on every request —
// never from a user id in the body, a query parameter or a custom header. The
// quick-capture route is the one exception, and it authenticates with its own
// scoped token that can do nothing but create a capture.

import { AppError, boolean, checked, fail, day, integer, object, oneOf, text, timezone as timezoneField, uuid } from '../_shared/validation.ts';
import { addDays, todayIn } from '../_shared/datetime.ts';
import { TavroStore, type Account } from './store.ts';
import { previewPayload, runCapture, MAX_PHRASE_CHARS } from './capture.ts';
import { parseStoredItems } from './ai/schema.ts';
import { aiConfigured, providerFromEnv } from './ai/provider.ts';
import { answerQuestion } from './search.ts';
import { PLANS, fairUseNotice, planOf, sellablePlans, starsFor } from './billing.ts';
import { createInvoice } from './payments.ts';
import { accountForQuickToken, issueQuickToken, listQuickTokens, revokeQuickToken } from './quick.ts';
import { TelegramApi, verifyInitData } from './telegram.ts';

const MAX_BODY_BYTES = 32000;

export type ApiDeps = {
  createClient: (url: string, key: string, options?: unknown) => any;
  env: (name: string) => string | undefined;
  telegramFactory?: (token: string) => TelegramApi;
  providerFactory?: typeof providerFromEnv;
};

export function createApiHandler(deps: ApiDeps) {
  const env = deps.env;
  const providerFactory = deps.providerFactory || providerFromEnv;

  const allowedOrigins = (env('TAVRO_APP_ORIGINS') || 'https://golovalisaia-hub.github.io')
    .split(',').map(origin => origin.trim()).filter(Boolean);

  return async function handle(request: Request): Promise<Response> {
    const origin = request.headers.get('origin');
    const headers: Record<string, string> = {
      Vary: 'Origin',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Headers': 'authorization, content-type, x-tavro-init-data',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    };
    if (origin && allowedOrigins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;

    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    try {
      if (origin && !allowedOrigins.includes(origin)) fail('ORIGIN_DENIED', 'Источник запроса не разрешён.', 403);

      const url = new URL(request.url);
      // The function name is the path prefix on Supabase; everything after it is our route.
      const route = url.pathname.replace(/^.*\/tavro-api/, '').replace(/\/+$/, '') || '/';
      const db = deps.createClient(env('SUPABASE_URL') || '', env('SUPABASE_SERVICE_ROLE_KEY') || '', {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const store = new TavroStore(db);

      const body = request.method === 'POST' ? await readJson(request) : {};

      // ---- quick capture: its own scoped credential, nothing else allowed ----
      if (route === '/quick/capture') {
        if (request.method !== 'POST') fail('METHOD_NOT_ALLOWED', 'Метод не поддерживается.', 405);
        const presented = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
        const accountId = await accountForQuickToken(db, presented);
        const account = checked(await db.from('tavro_accounts').select('*').eq('id', accountId).maybeSingle()) as Account | null;
        if (!account) fail('AUTH_INVALID', 'Аккаунт не найден.', 401);
        await enforceRate(db, account.id, 'quick', 20, 3600);
        const outcome = await captureFor({ db, store, env, providerFactory }, account, {
          phrase: text(body.phrase ?? body.text, MAX_PHRASE_CHARS, { field: 'фразу' }),
          source: 'quick',
          requestId: crypto.randomUUID(),
        });
        // A shortcut has no screen to confirm on, so it saves straight away and
        // reports exactly what it created.
        const items = parseStoredItems(outcome.draft.items, outcome.draft.today);
        await store.claimCapture(account.id, outcome.captureId);
        const saved = await store.saveItems(account, items, { source: 'quick', captureId: outcome.captureId });
        return json({ saved, today: outcome.draft.today });
      }

      // ------------------------- Mini App: verified Telegram identity --------
      const initData = request.headers.get('x-tavro-init-data')
        || (request.headers.get('authorization') || '').replace(/^tma\s+/i, '');
      const verified = await verifyInitData(initData, env('TAVRO_BOT_TOKEN') || '');
      const account = await store.account(verified.user, body.timezone ? timezoneField(body.timezone) : undefined);
      const today = todayIn(account.timezone);

      if (request.method === 'GET') {
        if (route === '/' || route === '/today') {
          const [agenda, overdue, upcoming, entitlement, inbox] = await Promise.all([
            store.agenda(account, today), store.overdue(account, today, 10),
            store.upcoming(account, 5), store.entitlement(account.id), store.inbox(account, 20),
          ]);
          return json({ today, timezone: account.timezone, profile: profileOf(account, entitlement), agenda, overdue, upcoming, inbox, aiConfigured: aiConfigured(env) });
        }
        if (route === '/agenda') {
          const date = day(url.searchParams.get('date') || today);
          return json({ today, ...(await store.agenda(account, date)) });
        }
        if (route === '/calendar') {
          const from = day(url.searchParams.get('from') || today);
          const to = day(url.searchParams.get('to') || addDays(from, 41));
          return json({ today, ...(await calendarRange(store, account, from, to)) });
        }
        if (route === '/tasks') return json({ today, inbox: await store.inbox(account, 100), overdue: await store.overdue(account, today, 50) });
        if (route === '/notes') {
          const kind = oneOf(url.searchParams.get('kind') || 'note', ['note', 'diary', 'meal'], 'раздел');
          return json({ today, kind, notes: await store.notes(account, kind, 100) });
        }
        if (route === '/habits') return json({ today, ...(await store.habitsWithToday(account, today)) });
        if (route === '/progress') {
          const from = day(url.searchParams.get('from') || addDays(today, -29));
          return json({ today, ...(await store.progress(account, from, day(url.searchParams.get('to') || today))) });
        }
        if (route === '/me') {
          const entitlement = await store.entitlement(account.id);
          return json({
            today, timezone: account.timezone, profile: profileOf(account, entitlement),
            plans: planCatalogue(env), quickTokens: await listQuickTokens(db, account.id),
            aiConfigured: aiConfigured(env),
          });
        }
        fail('NOT_FOUND', 'Маршрут не найден.', 404);
      }

      if (request.method === 'DELETE') {
        if (route.startsWith('/quick-token/')) {
          const removed = await revokeQuickToken(db, account.id, uuid(route.split('/')[2]));
          return json({ ok: removed });
        }
        fail('NOT_FOUND', 'Маршрут не найден.', 404);
      }

      if (request.method !== 'POST') fail('METHOD_NOT_ALLOWED', 'Метод не поддерживается.', 405);

      if (route === '/capture') {
        await enforceRate(db, account.id, 'capture', 30, 3600);
        const outcome = await captureFor({ db, store, env, providerFactory }, account, {
          phrase: text(body.phrase, MAX_PHRASE_CHARS, { field: 'фразу' }),
          source: 'miniapp',
          requestId: body.requestId ? uuid(body.requestId) : crypto.randomUUID(),
          transcript: body.transcript ? text(body.transcript, MAX_PHRASE_CHARS, { field: 'расшифровку' }) : null,
        });
        return json({ captureId: outcome.captureId, preview: previewPayload(outcome.draft) });
      }

      if (route === '/capture/confirm') {
        const id = uuid(body.captureId);
        const capture = await store.captureById(account.id, id);
        if (capture.status !== 'pending') return json({ ok: true, alreadySaved: true, saved: capture.created_record_ids || [] });
        if (!await store.claimCapture(account.id, id)) return json({ ok: true, alreadySaved: true, saved: capture.created_record_ids || [] });
        const capturedToday = capture.draft?.today || today;
        // The client may drop items it did not want, but may not invent new ones.
        const stored = parseStoredItems(capture.draft?.items, capturedToday);
        const keep = body.keep === undefined ? stored.map((_, index) => index) : indexList(body.keep, stored.length);
        const saved = await store.saveItems(account, keep.map(index => stored[index]), { source: capture.source, captureId: id });
        return json({ ok: true, saved, today: capturedToday });
      }

      if (route === '/capture/discard') return json({ ok: await store.discardCapture(account.id, uuid(body.captureId)) });

      if (route === '/ask') {
        await enforceRate(db, account.id, 'ask', 30, 3600);
        if (!aiConfigured(env)) fail('AI_NOT_CONFIGURED', 'ИИ ещё не подключён на сервере.', 503);
        const entitlement = await store.entitlement(account.id);
        const requestId = crypto.randomUUID();
        const { claimAiAction, releaseAiAction } = await import('./capture.ts');
        const quota = await claimAiAction(db, account, entitlement, requestId, 'ask');
        if (!quota.allowed) fail('QUOTA_EXCEEDED', `Дневной лимит ИИ исчерпан: ${quota.limit} в сутки.`, 429);
        try {
          const answer = await answerQuestion({ store, provider: providerFactory(env) }, { account, question: text(body.question, 500, { field: 'вопрос' }) });
          return json({ answer: answer.text, count: answer.count, intent: answer.plan.intent });
        } catch (error) {
          await releaseAiAction(db, requestId, error instanceof AppError ? error.code : 'ASK_ERROR');
          throw error;
        }
      }

      if (route === '/task/complete') {
        const task = await store.completeTask(account, uuid(body.taskId), boolean(body.completed, true));
        return json({ task });
      }
      if (route === '/task/snooze') return json({ task: await store.snoozeTask(account, uuid(body.taskId), integer(body.days ?? 1, 1, 365)) });
      if (route === '/task/delete') return json({ task: await store.deleteTask(account, uuid(body.taskId)) });
      if (route === '/task/restore') return json({ task: await store.restoreTask(account, uuid(body.taskId)) });
      if (route === '/event/status') return json({ event: await store.updateEventStatus(account, uuid(body.eventId), oneOf(body.status, ['planned', 'done', 'cancelled'], 'статус')) });
      if (route === '/habit/toggle') return json({ entry: await store.toggleHabit(account, uuid(body.habitId), day(body.date || today)) });

      if (route === '/settings') {
        if (body.timezone !== undefined) await store.setTimezone(account.id, timezoneField(body.timezone));
        if (body.remindersEnabled !== undefined) await store.setRemindersEnabled(account.id, boolean(body.remindersEnabled));
        const fresh = checked(await db.from('tavro_accounts').select('*').eq('id', account.id).single()) as Account;
        return json({ profile: profileOf(fresh, await store.entitlement(account.id)) });
      }

      if (route === '/quick-token') return json(await issueQuickToken(db, account.id, body.label ? text(body.label, 60, { field: 'название' }) : undefined));

      if (route === '/invoice') {
        const telegram = (deps.telegramFactory || ((token: string) => new TelegramApi(token)))(env('TAVRO_BOT_TOKEN') || '');
        const invoice = await createInvoice(telegram, env, account, planOf(body.plan));
        return json(invoice);
      }

      return fail('NOT_FOUND', 'Маршрут не найден.', 404);
    } catch (error) {
      const status = error instanceof AppError ? error.status : 500;
      return json({
        error: error instanceof AppError ? error.code : 'ERROR',
        message: error instanceof AppError ? error.message : 'Не удалось выполнить запрос.',
      }, status);
    }
  };
}

async function readJson(request: Request): Promise<any> {
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) fail('TOO_LARGE', 'Слишком большой запрос.', 413);
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) fail('TOO_LARGE', 'Слишком большой запрос.', 413);
  if (!raw) return {};
  try { return object(JSON.parse(raw)); } catch (error) { if (error instanceof AppError) throw error; return fail('VALIDATION', 'Некорректный JSON.'); }
}

function indexList(raw: unknown, length: number): number[] {
  if (!Array.isArray(raw) || raw.length > length) fail('VALIDATION', 'Некорректный выбор записей.');
  const unique = new Set<number>();
  for (const entry of raw) unique.add(integer(entry, 0, Math.max(0, length - 1)));
  return [...unique].sort((a, b) => a - b);
}

function profileOf(account: Account, entitlement: any) {
  return {
    firstName: account.first_name,
    timezone: account.timezone,
    remindersEnabled: account.reminders_enabled,
    plan: entitlement.plan,
    planTitle: PLANS[entitlement.plan as keyof typeof PLANS].title,
    pro: entitlement.pro,
    dailyAiActions: entitlement.dailyAiActions,
    expiresAt: entitlement.expiresAt,
    autoRenew: entitlement.autoRenew,
    lapsed: entitlement.lapsed,
  };
}

function planCatalogue(env: (name: string) => string | undefined) {
  const sellable = new Map(sellablePlans(env).map(offer => [offer.plan.id, offer.stars]));
  return Object.values(PLANS).map(plan => ({
    id: plan.id, title: plan.title, rub: plan.rub, billing: plan.billing,
    summary: plan.summary, dailyAiActions: plan.dailyAiActions,
    fairUse: fairUseNotice(plan.id),
    stars: plan.id === 'free' ? null : starsFor(plan.id, env),
    available: plan.id === 'free' || sellable.has(plan.id),
  }));
}

async function calendarRange(store: TavroStore, account: Account, from: string, to: string) {
  const db = store.db;
  const [tasks, events] = await Promise.all([
    db.from('tavro_tasks').select('id,title,scheduled_for,scheduled_time,completed,priority')
      .eq('account_id', account.id).is('deleted_at', null).gte('scheduled_for', from).lte('scheduled_for', to).limit(1000),
    db.from('tavro_events').select('id,title,event_date,event_time,location,status')
      .eq('account_id', account.id).is('deleted_at', null).gte('event_date', from).lte('event_date', to).limit(1000),
  ]);
  return { from, to, tasks: checked(tasks) || [], events: checked(events) || [] };
}

async function captureFor(
  { db, store, env, providerFactory }: { db: any; store: TavroStore; env: (name: string) => string | undefined; providerFactory: typeof providerFromEnv },
  account: Account,
  input: { phrase: string; source: 'miniapp' | 'quick'; requestId: string; transcript?: string | null },
) {
  if (!aiConfigured(env)) fail('AI_NOT_CONFIGURED', 'ИИ ещё не подключён на сервере.', 503);
  const entitlement = await store.entitlement(account.id);
  return runCapture({ db, store, provider: providerFactory(env) }, {
    account, entitlement, phrase: input.phrase, source: input.source,
    requestId: input.requestId, transcript: input.transcript ?? null,
  });
}

async function enforceRate(db: any, accountId: string, bucket: string, limit: number, windowSeconds: number): Promise<void> {
  const result = await db.rpc('tavro_rate_check', { p_account: accountId, p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds });
  if (result.error) return; // Rate accounting must not take the product down.
  if (result.data !== true) fail('RATE_LIMIT', 'Слишком много запросов. Попробуйте через несколько минут.', 429);
}
