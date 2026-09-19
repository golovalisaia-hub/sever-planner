import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { createApiHandler } from '../supabase/functions/_tavro/api.ts';
import { createBotHandler } from '../supabase/functions/_tavro/bot.ts';
import { dispatchReminders } from '../supabase/functions/_tavro/reminders.ts';
import { issueQuickToken, revokeQuickToken } from '../supabase/functions/_tavro/quick.ts';
import { TavroStore } from '../supabase/functions/_tavro/store.ts';
import { zonedToUtc } from '../supabase/functions/_shared/datetime.ts';
import {
  BOT_TOKEN, botEnv, createFakeDb, createFakeTelegram, scriptedProvider, scriptedSpeech,
  telegramUser, textUpdate, webhookRequest,
} from './tavro-fakes.mjs';

const APP_ORIGIN = 'https://golovalisaia-hub.github.io';

const FLAGSHIP_REPLY = {
  items: [
    { type: 'event', title: 'Встреча с Андреем', date: { relative: 'tomorrow' }, time: '15:00', participants: ['Андрей'] },
    { type: 'task', title: 'Изучить Python' },
    { type: 'task', title: 'Оплатить интернет' },
    { type: 'diary', title: 'Закончил проект', body: 'Сегодня закончил проект', date: { relative: 'today' } },
  ],
};

function initDataFor(user = telegramUser, { token = BOT_TOKEN, authDate = Math.floor(Date.now() / 1000) } = {}) {
  const fields = { auth_date: String(authDate), user: JSON.stringify(user) };
  const pairs = Object.entries(fields).map(([key, value]) => `${key}=${value}`).sort();
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const params = new URLSearchParams(fields);
  params.set('hash', createHmac('sha256', secret).update(pairs.join('\n')).digest('hex'));
  return params.toString();
}

function apiHarness({ reply = FLAGSHIP_REPLY, env = {}, db = createFakeDb() } = {}) {
  const telegram = createFakeTelegram();
  const handler = createApiHandler({
    createClient: () => db,
    env: botEnv(env),
    telegramFactory: () => telegram,
    providerFactory: () => scriptedProvider(reply),
  });
  const call = (route, { method = 'GET', body, initData = initDataFor(), origin = APP_ORIGIN, headers = {} } = {}) =>
    handler(new Request(`https://test.invalid/functions/v1/tavro-api${route}`, {
      method,
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(initData === null ? {} : { 'x-tavro-init-data': initData }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }));
  return { db, telegram, handler, call, rows: table => db.tables[table] || [] };
}

const json = async response => ({ status: response.status, body: await response.json() });

// ------------------------------------------------------------------ auth ----

test('Mini App API не принимает запрос без подписи Telegram', async () => {
  const { call } = apiHarness();
  assert.equal((await json(await call('/today', { initData: null }))).status, 401);
  assert.equal((await json(await call('/today', { initData: 'user=%7B%22id%22%3A1%7D&hash=deadbeef' }))).status, 401);
  // A signature made with another bot's token is not our user.
  const foreign = initDataFor(telegramUser, { token: '999:other-bot-token' });
  assert.equal((await json(await call('/today', { initData: foreign }))).status, 401);
});

test('клиент не может назначить себе чужой аккаунт или тариф', async () => {
  const { call, rows } = apiHarness();
  await call('/today');
  const account = rows('tavro_accounts')[0];

  // Identity fields are refused outright by the shared object validator.
  for (const spoof of [{ account_id: account.id }, { telegram_id: 1 }, { entitlement: { pro: true } }, { dailyAiActions: 9999 }]) {
    const response = await json(await call('/capture', { method: 'POST', body: { phrase: 'тест', ...spoof } }));
    assert.equal(response.status, 422, `поле ${Object.keys(spoof)[0]} должно быть отклонено`);
  }
  // A plan name is an ordinary request field, but claiming one grants nothing:
  // access comes only from a Telegram-confirmed payment.
  const claimed = await json(await call('/capture', { method: 'POST', body: { phrase: 'тест', plan: 'pro_lifetime' } }));
  assert.equal(claimed.status, 200);
  assert.equal(rows('tavro_subscriptions').length, 0);
  assert.equal((await json(await call('/me'))).body.profile.plan, 'free');
});

test('чужой origin отклоняется', async () => {
  const { call } = apiHarness();
  const response = await json(await call('/today', { origin: 'https://evil.example' }));
  assert.equal(response.status, 403);
});

// --------------------------------------------------------------- capture ----

test('Mini App показывает предпросмотр и сохраняет выбранные записи', async () => {
  const { call, rows } = apiHarness();
  const created = await json(await call('/capture', { method: 'POST', body: { phrase: 'завтра встреча с Андреем в 15:00 и оплатить интернет' } }));
  assert.equal(created.status, 200);
  assert.equal(created.body.preview.items.length, 4);
  assert.equal(created.body.preview.items[0].when, 'завтра, 15:00');
  assert.equal(created.body.preview.items[1].when, 'без даты');
  assert.equal(rows('tavro_tasks').length, 0, 'до подтверждения ничего не сохраняется');

  // Keep only the meeting and one task.
  const confirmed = await json(await call('/capture/confirm', { method: 'POST', body: { captureId: created.body.captureId, keep: [0, 2] } }));
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.saved.length, 2);
  assert.equal(rows('tavro_events').length, 1);
  assert.equal(rows('tavro_tasks').length, 1);
  assert.equal(rows('tavro_notes').length, 0);

  // Confirming again is a no-op, not a duplicate.
  const again = await json(await call('/capture/confirm', { method: 'POST', body: { captureId: created.body.captureId } }));
  assert.equal(again.body.alreadySaved, true);
  assert.equal(rows('tavro_events').length, 1);
});

test('клиент не может дописать запись в чужой черновик', async () => {
  const { call, rows } = apiHarness();
  const created = await json(await call('/capture', { method: 'POST', body: { phrase: 'фраза' } }));
  const stranger = initDataFor({ id: 999009, first_name: 'Чужой' });
  const stolen = await json(await call('/capture/confirm', { method: 'POST', body: { captureId: created.body.captureId }, initData: stranger }));
  assert.equal(stolen.status, 404);
  assert.equal(rows('tavro_tasks').length, 0);

  // An out-of-range index is refused rather than silently clamped.
  const bad = await json(await call('/capture/confirm', { method: 'POST', body: { captureId: created.body.captureId, keep: [0, 99] } }));
  assert.equal(bad.status, 422);
});

test('экран «Сегодня» отдаёт реальные ближайшие дела', async () => {
  const { call, rows } = apiHarness();
  const created = await json(await call('/capture', { method: 'POST', body: { phrase: 'фраза' } }));
  await call('/capture/confirm', { method: 'POST', body: { captureId: created.body.captureId } });

  const today = await json(await call('/today'));
  assert.equal(today.status, 200);
  assert.equal(today.body.profile.plan, 'free');
  assert.equal(today.body.profile.dailyAiActions, 3);
  assert.equal(today.body.agenda.events.length, 0, 'встреча завтра не попадает в сегодня');
  assert.equal(today.body.upcoming[0].title, 'Встреча с Андреем');
  assert.equal(today.body.inbox.length, 2, 'задачи без даты собираются во входящих');
  assert.equal(rows('tavro_captures')[0].status, 'confirmed');
});

test('задача закрывается и возвращается из приложения', async () => {
  const { call, rows } = apiHarness({ reply: { items: [{ type: 'task', title: 'Оплатить интернет', date: { relative: 'today' }, time: '18:00' }] } });
  const created = await json(await call('/capture', { method: 'POST', body: { phrase: 'оплатить интернет' } }));
  await call('/capture/confirm', { method: 'POST', body: { captureId: created.body.captureId } });
  const task = rows('tavro_tasks')[0];

  const done = await json(await call('/task/complete', { method: 'POST', body: { taskId: task.id, completed: true } }));
  assert.equal(done.body.task.completed, true);
  const undone = await json(await call('/task/complete', { method: 'POST', body: { taskId: task.id, completed: false } }));
  assert.equal(undone.body.task.completed, false);

  const foreign = await json(await call('/task/complete', { method: 'POST', body: { taskId: task.id } , initData: initDataFor({ id: 999010, first_name: 'Чужой' }) }));
  assert.equal(foreign.status, 404, 'чужую задачу нельзя закрыть');
});

test('настройки сохраняют часовой пояс пользователя и он побеждает подсказку клиента', async () => {
  const { call, rows } = apiHarness();
  await call('/today');
  const saved = await json(await call('/settings', { method: 'POST', body: { timezone: 'Asia/Novosibirsk' } }));
  assert.equal(saved.body.profile.timezone, 'Asia/Novosibirsk');
  assert.equal(rows('tavro_accounts')[0].timezone_source, 'user');

  // A later client hint must not overwrite the explicit choice.
  await call('/capture', { method: 'POST', body: { phrase: 'фраза', timezone: 'Europe/Lisbon' } });
  assert.equal(rows('tavro_accounts')[0].timezone, 'Asia/Novosibirsk');

  const invalid = await json(await call('/settings', { method: 'POST', body: { timezone: 'Not/AZone' } }));
  assert.equal(invalid.status, 422);
});

// ---------------------------------------------------------- quick capture ---

test('токен быстрого ввода создаёт записи и ничего больше', async () => {
  const { call, db, rows } = apiHarness();
  await call('/today');
  const account = rows('tavro_accounts')[0];
  const issued = await json(await call('/quick-token', { method: 'POST', body: { label: 'iPhone' } }));
  const token = issued.body.token;
  assert.match(token, /^tvq_/);
  // Only a hash is stored, so a database read cannot replay the token.
  assert.equal(rows('tavro_quick_tokens')[0].token_hash.length, 64);
  assert.ok(!JSON.stringify(rows('tavro_quick_tokens')).includes(token));

  const captured = await json(await call('/quick/capture', {
    method: 'POST', initData: null, body: { phrase: 'оплатить интернет' },
    headers: { Authorization: `Bearer ${token}` },
  }));
  assert.equal(captured.status, 200);
  assert.equal(captured.body.saved.length, 4);
  assert.equal(rows('tavro_tasks').length, 2);

  // The token opens nothing else.
  const reading = await json(await call('/today', { initData: null, headers: { Authorization: `Bearer ${token}` } }));
  assert.equal(reading.status, 401, 'токен быстрого ввода не даёт читать данные');

  // And it can be revoked.
  assert.equal(await revokeQuickToken(db, account.id, rows('tavro_quick_tokens')[0].id), true);
  const afterRevoke = await json(await call('/quick/capture', {
    method: 'POST', initData: null, body: { phrase: 'ещё раз' }, headers: { Authorization: `Bearer ${token}` },
  }));
  assert.equal(afterRevoke.status, 401);
});

test('неизвестный токен быстрого ввода отклоняется', async () => {
  const { call } = apiHarness();
  const response = await json(await call('/quick/capture', {
    method: 'POST', initData: null, body: { phrase: 'х' }, headers: { Authorization: 'Bearer tvq_totally-made-up' },
  }));
  assert.equal(response.status, 401);
});

test('нельзя выпустить неограниченное число токенов', async () => {
  const db = createFakeDb();
  const { call, rows } = apiHarness({ db });
  await call('/today');
  const account = rows('tavro_accounts')[0];
  for (let index = 0; index < 5; index += 1) await issueQuickToken(db, account.id, `t${index}`);
  await assert.rejects(() => issueQuickToken(db, account.id, 't6'), /Отзовите лишние/);
});

// -------------------------------------------------------------- reminders ---

test('напоминание приходит один раз, и не приходит по закрытой задаче', async () => {
  const db = createFakeDb();
  const telegram = createFakeTelegram();
  const { call, rows } = apiHarness({ db, reply: { items: [{ type: 'task', title: 'Позвонить врачу', date: { relative: 'today' }, time: '23:59' }] } });
  const created = await json(await call('/capture', { method: 'POST', body: { phrase: 'позвонить врачу' } }));
  await call('/capture/confirm', { method: 'POST', body: { captureId: created.body.captureId } });

  const reminder = rows('tavro_reminders')[0];
  assert.ok(reminder, 'задача со временем получает напоминание');
  // Pull it into the past so the dispatcher claims it.
  reminder.remind_at = new Date(Date.now() - 60000).toISOString();

  const first = await dispatchReminders({ db, telegram, env: botEnv() });
  assert.equal(first.sent, 1);
  const message = telegram.sent().at(-1);
  assert.match(message.payload.text, /Позвонить врачу/);
  const buttons = message.payload.reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some(button => button.callback_data?.startsWith('done:')));
  assert.ok(buttons.some(button => button.callback_data?.startsWith('snooze:')));

  // A second run must not resend the same reminder.
  const second = await dispatchReminders({ db, telegram, env: botEnv() });
  assert.equal(second.sent, 0);
  assert.equal(telegram.sent().length, 1);
});

test('выполненная задача не будит пользователя напоминанием', async () => {
  const db = createFakeDb();
  const telegram = createFakeTelegram();
  const store = new TavroStore(db);
  const account = await store.account(telegramUser);
  const task = (await db.from('tavro_tasks').insert({ account_id: account.id, title: 'Уже сделано', scheduled_for: '2026-09-19', scheduled_time: '10:00' }).select('id').single()).data;
  await db.from('tavro_reminders').insert({
    account_id: account.id, target_kind: 'task', target_id: task.id, kind: 'before',
    remind_at: new Date(Date.now() - 60000).toISOString(),
  });
  await db.from('tavro_tasks').update({ completed: true }).eq('id', task.id);

  const summary = await dispatchReminders({ db, telegram, env: botEnv() });
  assert.equal(summary.sent, 0);
  assert.equal(summary.skipped, 1);
  assert.equal(telegram.sent().length, 0);
});

test('выключенные напоминания не отправляются', async () => {
  const db = createFakeDb();
  const telegram = createFakeTelegram();
  const store = new TavroStore(db);
  const account = await store.account(telegramUser);
  await store.setRemindersEnabled(account.id, false);
  const event = (await db.from('tavro_events').insert({ account_id: account.id, title: 'Встреча', event_date: '2026-09-19', event_time: '10:00' }).select('id').single()).data;
  await db.from('tavro_reminders').insert({
    account_id: account.id, target_kind: 'event', target_id: event.id, kind: 'before',
    remind_at: new Date(Date.now() - 60000).toISOString(),
  });

  const summary = await dispatchReminders({ db, telegram, env: botEnv() });
  assert.equal(summary.sent, 0);
  assert.equal(summary.skipped, 1);
});

test('напоминание ставится по часовому поясу пользователя', async () => {
  const db = createFakeDb();
  const store = new TavroStore(db);
  const account = await store.account(telegramUser);
  await store.setTimezone(account.id, 'Asia/Novosibirsk');
  const fresh = { ...account, timezone: 'Asia/Novosibirsk' };

  await store.scheduleEventReminders(fresh, '11111111-1111-4111-8111-111111111111', '2099-06-01', '15:00');
  const reminder = (db.tables.tavro_reminders || []).find(row => row.kind === 'before');
  // 15:00 in Novosibirsk (UTC+7) is 08:00 UTC; the reminder is 30 minutes before.
  assert.equal(zonedToUtc('2099-06-01', '15:00', 'Asia/Novosibirsk'), '2099-06-01T08:00:00.000Z');
  assert.equal(reminder.remind_at, '2099-06-01T07:30:00.000Z');
});

// ------------------------------------------------- bot and app share state ---

test('запись из бота сразу видна в Mini App того же пользователя', async () => {
  const db = createFakeDb();
  const telegram = createFakeTelegram();
  const botHandler = createBotHandler({
    createClient: () => db,
    env: botEnv(),
    telegramFactory: () => telegram,
    providerFactory: () => scriptedProvider(FLAGSHIP_REPLY),
    speechFactory: () => scriptedSpeech('x'),
  });
  await botHandler(webhookRequest(textUpdate('фраза из бота')));
  const capture = db.tables.tavro_captures[0];
  await botHandler(webhookRequest({
    update_id: 91001,
    callback_query: { id: 'cb-sync', from: telegramUser, data: `save:${capture.id}`, message: { message_id: 1, chat: { id: telegramUser.id } } },
  }));

  const { call } = apiHarness({ db });
  const today = await json(await call('/today'));
  assert.equal(today.body.upcoming[0].title, 'Встреча с Андреем');
  assert.equal(today.body.inbox.length, 2);
  assert.equal(db.tables.tavro_accounts.length, 1, 'бот и приложение — один аккаунт');
});

test('тарифы в приложении не предлагают купить то, у чего нет цены в Stars', async () => {
  const configured = apiHarness({ env: { TAVRO_STARS_PRO_MONTH: '500' } });
  const me = await json(await configured.call('/me'));
  const plans = Object.fromEntries(me.body.plans.map(plan => [plan.id, plan]));
  assert.equal(plans.pro_month.available, true);
  assert.equal(plans.pro_month.stars, 500);
  assert.equal(plans.pro_year.available, false);
  assert.equal(plans.pro_year.stars, null);
  assert.equal(plans.pro_lifetime.rub, 5000);
  assert.match(plans.pro_lifetime.fairUse, /50/);

  const refused = await json(await configured.call('/invoice', { method: 'POST', body: { plan: 'pro_year' } }));
  assert.equal(refused.status, 503);
  assert.match(refused.body.message, /не настроена/);

  const offered = await json(await configured.call('/invoice', { method: 'POST', body: { plan: 'pro_month' } }));
  assert.equal(offered.status, 200);
  assert.equal(offered.body.stars, 500);
});
