import test from 'node:test';
import assert from 'node:assert/strict';

import { createBotHandler, isQuestion, uuidFromParts, WELCOME } from '../supabase/functions/_tavro/bot.ts';
import { invoicePayload } from '../supabase/functions/_tavro/billing.ts';
import {
  botEnv, callbackUpdate, createFakeDb, createFakeTelegram, nextUpdateId,
  scriptedProvider, scriptedSpeech, telegramUser, textUpdate, voiceUpdate, webhookRequest,
} from './tavro-fakes.mjs';

const FLAGSHIP_REPLY = {
  items: [
    { type: 'event', title: 'Встреча с Андреем', date: { relative: 'tomorrow' }, time: '15:00', participants: ['Андрей'] },
    { type: 'task', title: 'Изучить Python' },
    { type: 'task', title: 'Оплатить интернет' },
    { type: 'diary', title: 'Закончил проект', body: 'Сегодня закончил проект', date: { relative: 'today' } },
  ],
  clarification: null,
};

function harness({ reply = FLAGSHIP_REPLY, transcript = 'тест', env = {}, telegramOverrides = {} } = {}) {
  const db = createFakeDb();
  const telegram = createFakeTelegram(telegramOverrides);
  const provider = scriptedProvider(reply);
  const speech = scriptedSpeech(transcript);
  const handler = createBotHandler({
    createClient: () => db,
    env: botEnv(env),
    telegramFactory: () => telegram,
    providerFactory: () => provider,
    speechFactory: () => speech,
  });
  const send = update => handler(webhookRequest(update));
  const rows = table => db.tables[table] || [];
  return { db, telegram, provider, speech, handler, send, rows };
}

const captureId = db => (db.tables.tavro_captures || [])[0]?.id;

// ------------------------------------------------------------- onboarding ---

test('/start отвечает коротким приветствием с рабочими кнопками', async () => {
  const { send, telegram, rows } = harness();
  const response = await send(textUpdate('/start'));
  assert.equal(response.status, 200);

  const message = telegram.sent().at(-1);
  assert.equal(message.payload.text, WELCOME);
  assert.match(message.payload.text, /Твои мысли\. В твоём ритме\./);
  // Short: a greeting, not a manual.
  assert.ok(message.payload.text.length < 400, 'приветствие должно быть лаконичным');

  const buttons = message.payload.reply_markup.inline_keyboard.flat();
  assert.deepEqual(buttons.map(button => button.text), ['◆ Открыть TAVRO', '⚡ Быстрый запуск', '★ TAVRO Pro', '⚙ Настройки', '? Помощь']);
  // Every button has a real handler: a web_app url or callback data.
  for (const button of buttons) assert.ok(button.web_app?.url || button.callback_data, `кнопка «${button.text}» без обработчика`);
  assert.equal(rows('tavro_accounts').length, 1);
  assert.ok(rows('tavro_accounts')[0].onboarded_at);
});

test('чужой или отсутствующий webhook-секрет не пускает в бота', async () => {
  const { handler, db } = harness();
  const forged = await handler(webhookRequest(textUpdate('/start'), { secret: 'wrong-secret-value-000000000000' }));
  assert.equal(forged.status, 401);
  assert.equal((db.tables.tavro_accounts || []).length, 0);
});

// ------------------------------------------------------- the main scenario ---

test('одна фраза превращается в предпросмотр из четырёх записей и сохраняется одной кнопкой', async () => {
  const { send, telegram, db, rows } = harness();

  await send(textUpdate('завтра встреча с Андреем в 15:00, потом изучить Python, оплатить интернет и запиши в дневник, что сегодня закончил проект'));

  const preview = telegram.sent().at(-1);
  assert.match(preview.payload.text, /Нашёл 4 записи/);
  assert.match(preview.payload.text, /Встреча с Андреем/);
  assert.match(preview.payload.text, /завтра, 15:00/);
  assert.match(preview.payload.text, /Изучить Python/);
  assert.match(preview.payload.text, /Оплатить интернет/);
  assert.match(preview.payload.text, /Закончил проект/);
  // Nothing is saved before the user confirms.
  assert.equal(rows('tavro_tasks').length, 0);
  assert.equal(rows('tavro_events').length, 0);
  assert.equal(rows('tavro_captures')[0].status, 'pending');

  const save = preview.payload.reply_markup.inline_keyboard.flat().find(button => button.text.includes('Сохранить'));
  assert.ok(save, 'в предпросмотре должна быть кнопка сохранения');

  await send(callbackUpdate(save.callback_data));

  assert.equal(rows('tavro_events').length, 1);
  assert.equal(rows('tavro_tasks').length, 2);
  assert.equal(rows('tavro_notes').length, 1);
  assert.equal(rows('tavro_captures')[0].status, 'confirmed');

  const meeting = rows('tavro_events')[0];
  assert.equal(meeting.title, 'Встреча с Андреем');
  assert.equal(meeting.event_time, '15:00');
  assert.deepEqual(meeting.participants, ['Андрей']);
  assert.ok(meeting.starts_at, 'встреча со временем получает момент в UTC');

  // The two tasks the user never dated stay undated.
  for (const task of rows('tavro_tasks')) assert.equal(task.scheduled_for, null);
  assert.equal(rows('tavro_notes')[0].kind, 'diary');

  // A dated meeting schedules its reminders.
  const reminders = rows('tavro_reminders').filter(row => row.target_kind === 'event');
  assert.ok(reminders.length >= 1, 'встреча должна получить напоминание');
  assert.ok(reminders.every(row => row.account_id === db.tables.tavro_accounts[0].id));
});

test('двойное нажатие «Сохранить» не создаёт записи дважды', async () => {
  const { send, db, rows, telegram } = harness();
  await send(textUpdate('фраза'));
  const id = captureId(db);

  await send(callbackUpdate(`save:${id}`, { id: 'cb-a' }));
  await send(callbackUpdate(`save:${id}`, { id: 'cb-b' }));

  assert.equal(rows('tavro_tasks').length, 2);
  assert.equal(rows('tavro_events').length, 1);
  assert.equal(rows('tavro_notes').length, 1);
  const answers = telegram.calls.filter(call => call.method === 'answerCallbackQuery');
  assert.match(answers.at(-1).payload.text, /Уже сохранено/);
});

test('повторная доставка одного update_id не обрабатывается заново', async () => {
  const { handler, db, rows } = harness();
  const update = textUpdate('фраза');
  await handler(webhookRequest(update));
  await handler(webhookRequest(update));
  assert.equal(rows('tavro_captures').length, 1);
  assert.equal((db.tables.tavro_ai_usage || []).length, 1);
});

test('«Отменить» закрывает черновик и ничего не сохраняет', async () => {
  const { send, db, rows } = harness();
  await send(textUpdate('фраза'));
  await send(callbackUpdate(`drop:${captureId(db)}`));
  assert.equal(rows('tavro_captures')[0].status, 'discarded');
  assert.equal(rows('tavro_tasks').length, 0);
});

test('черновик чужого аккаунта не сохраняется', async () => {
  const { send, db, rows } = harness();
  await send(textUpdate('фраза'));
  const stranger = { id: 999002, first_name: 'Чужой' };
  await send(callbackUpdate(`save:${captureId(db)}`, { from: stranger, id: 'cb-x' }));
  assert.equal(rows('tavro_tasks').length, 0);
  assert.equal(rows('tavro_captures')[0].status, 'pending');
});

// ------------------------------------------------------------------ voice ---

test('голосовое обрабатывается прямо в чате и тратит одно AI-действие', async () => {
  const { send, telegram, db, rows } = harness({ transcript: 'завтра встреча с Андреем в 15:00' });
  await send(voiceUpdate({ duration: 8 }));

  const edits = telegram.calls.filter(call => call.method === 'editMessageText');
  assert.ok(edits.length >= 1, 'бот редактирует сообщение ожидания, а не шлёт новые');
  const final = edits.at(-1).payload;
  assert.match(final.text, /Нашёл 4 записи/);
  assert.match(final.text, /завтра встреча с Андреем в 15:00/, 'пользователь видит распознанный текст');
  assert.ok(final.reply_markup.inline_keyboard.flat().some(button => button.text.includes('Сохранить')));

  // Transcription + parsing are one user action, so only one is billable.
  const usage = db.tables.tavro_ai_usage;
  assert.equal(usage.length, 2);
  assert.equal(usage.filter(row => row.billable).length, 1);
  assert.equal(usage.find(row => row.kind === 'transcribe').audio_seconds, 8);
  assert.equal(rows('tavro_captures')[0].transcript, 'завтра встреча с Андреем в 15:00');
});

test('слишком длинное голосовое отклоняется до обращения к провайдеру', async () => {
  const { send, telegram, db } = harness();
  await send(voiceUpdate({ duration: 600 }));
  assert.match(telegram.lastText(), /длиннее 120 секунд/);
  assert.equal((db.tables.tavro_ai_usage || []).length, 0);
});

test('ошибка распознавания возвращает лимит и предлагает повтор', async () => {
  const { send, telegram, db } = harness({ transcript: new Error('stt down') });
  await send(voiceUpdate({ duration: 5 }));
  const usage = db.tables.tavro_ai_usage;
  assert.equal(usage.length, 1);
  assert.equal(usage[0].billable, false, 'сбой провайдера не должен списывать дневной лимит');
  const edit = telegram.calls.filter(call => call.method === 'editMessageText').at(-1);
  assert.ok(edit.payload.reply_markup.inline_keyboard.flat().some(button => button.text.includes('снова')));
});

// ------------------------------------------------------------------ quota ---

test('FREE ограничен тремя AI-действиями в сутки, планер остаётся доступен', async () => {
  const { send, telegram, rows } = harness();
  for (let index = 0; index < 3; index += 1) await send(textUpdate(`фраза ${index}`, { messageId: 10 + index }));
  assert.equal(rows('tavro_captures').length, 3);

  await send(textUpdate('четвёртая фраза', { messageId: 20 }));
  assert.equal(rows('tavro_captures').length, 3, 'четвёртое действие не должно выполниться');
  assert.match(telegram.lastText(), /лимит ИИ исчерпан/i);
  assert.match(telegram.lastText(), /планер не ограничен/i);
});

// --------------------------------------------------------------- questions ---

test('вопрос отвечает по реальным записям, а не выдумывает их', async () => {
  const { send, telegram, db, rows } = harness();
  await send(textUpdate('фраза'));
  await send(callbackUpdate(`save:${captureId(db)}`));

  // Now ask, with the model only planning the query.
  const asking = harnessWithPlan(db, { intent: 'agenda', from: { relative: 'tomorrow' } });
  await asking.send(textUpdate('что у меня завтра?', { messageId: 30 }));
  assert.match(asking.telegram.lastText(), /Встреча с Андреем/);

  const empty = harnessWithPlan(db, { intent: 'agenda', from: { relative: 'in_60_days' } });
  await empty.send(textUpdate('что у меня через два месяца?', { messageId: 31 }));
  assert.match(empty.telegram.lastText(), /записей нет/);
  assert.equal(rows('tavro_tasks').length, 2, 'вопрос не создаёт записи');
});

function harnessWithPlan(db, plan) {
  const telegram = createFakeTelegram();
  const handler = createBotHandler({
    createClient: () => db,
    env: botEnv(),
    telegramFactory: () => telegram,
    providerFactory: () => scriptedProvider(plan),
    speechFactory: () => scriptedSpeech('x'),
  });
  return { telegram, send: update => handler(webhookRequest(update)) };
}

test('вопросы распознаются по форме, а не по ключевым словам внутри дел', () => {
  assert.equal(isQuestion('что у меня завтра?'), true);
  assert.equal(isQuestion('Сколько встреч с Андреем было в этом месяце'), true);
  assert.equal(isQuestion('какие задачи я не выполнил вчера'), true);
  assert.equal(isQuestion('оплатить интернет'), false);
  assert.equal(isQuestion('купить хлеб и что-нибудь к чаю'), false);
});

// ------------------------------------------------------------------ tasks ---

test('задача завершается из Telegram и её напоминания отменяются', async () => {
  const { send, db, rows, telegram } = harness({
    reply: { items: [{ type: 'task', title: 'Оплатить интернет', date: { relative: 'tomorrow' }, time: '18:00' }] },
  });
  await send(textUpdate('оплатить интернет завтра в 18:00'));
  await send(callbackUpdate(`save:${captureId(db)}`));

  const task = rows('tavro_tasks')[0];
  assert.equal(rows('tavro_reminders').filter(row => row.status === 'scheduled').length, 1);

  await send(callbackUpdate(`done:${task.id}`, { id: 'cb-done' }));
  assert.equal(rows('tavro_tasks')[0].completed, true);
  assert.equal(rows('tavro_reminders').filter(row => row.status === 'scheduled').length, 0,
    'после выполнения задачи напоминание о ней не должно отправляться');
  assert.match(telegram.calls.filter(call => call.method === 'editMessageText').at(-1).payload.text, /выполнена/);
});

test('чужую задачу нельзя завершить по callback', async () => {
  const { send, db, rows } = harness({ reply: { items: [{ type: 'task', title: 'Моя задача' }] } });
  await send(textUpdate('моя задача'));
  await send(callbackUpdate(`save:${captureId(db)}`));
  const task = rows('tavro_tasks')[0];

  await send(callbackUpdate(`done:${task.id}`, { from: { id: 999003, first_name: 'Чужой' }, id: 'cb-y' }));
  assert.equal(rows('tavro_tasks')[0].completed, false);
});

// --------------------------------------------------------------- payments ---

test('pre_checkout отклоняется, если счёт выписан другому аккаунту', async () => {
  const { send, telegram, db } = harness({ env: { TAVRO_STARS_PRO_MONTH: '500' } });
  await send(textUpdate('/start'));
  const account = db.tables.tavro_accounts[0];

  await send({
    update_id: nextUpdateId(),
    pre_checkout_query: { id: 'pcq-1', from: telegramUser, currency: 'XTR', total_amount: 500, invoice_payload: invoicePayload('pro_month', account.id, 'n1') },
  });
  assert.equal(telegram.calls.filter(call => call.method === 'answerPreCheckoutQuery').at(-1).payload.ok, true);

  await send({
    update_id: nextUpdateId(),
    pre_checkout_query: { id: 'pcq-2', from: telegramUser, currency: 'XTR', total_amount: 500, invoice_payload: invoicePayload('pro_month', '11111111-1111-4111-8111-111111111111', 'n2') },
  });
  const denied = telegram.calls.filter(call => call.method === 'answerPreCheckoutQuery').at(-1).payload;
  assert.equal(denied.ok, false);
  assert.match(denied.error_message, /другому аккаунту/);

  // A tampered price is refused too.
  await send({
    update_id: nextUpdateId(),
    pre_checkout_query: { id: 'pcq-3', from: telegramUser, currency: 'XTR', total_amount: 1, invoice_payload: invoicePayload('pro_month', account.id, 'n3') },
  });
  assert.equal(telegram.calls.filter(call => call.method === 'answerPreCheckoutQuery').at(-1).payload.ok, false);
});

test('доступ выдаётся только по подтверждённому Telegram платежу и ровно один раз', async () => {
  const { send, telegram, db, rows } = harness({ env: { TAVRO_STARS_PRO_MONTH: '500' } });
  await send(textUpdate('/start'));
  const account = db.tables.tavro_accounts[0];
  const payment = {
    currency: 'XTR', total_amount: 500,
    invoice_payload: invoicePayload('pro_month', account.id, 'n1'),
    telegram_payment_charge_id: 'charge-abc',
    is_recurring: true, is_first_recurring: true,
  };

  await send({ update_id: nextUpdateId(), message: { message_id: 40, chat: { id: telegramUser.id }, from: telegramUser, successful_payment: payment } });
  const subscription = rows('tavro_subscriptions')[0];
  assert.equal(subscription.plan, 'pro_month');
  assert.equal(subscription.status, 'active');
  assert.equal(subscription.auto_renew, true);
  assert.ok(subscription.current_period_end);
  assert.match(telegram.lastText(), /активирован/);
  const firstEnd = subscription.current_period_end;

  // A redelivered webhook must not extend the period a second time.
  await send({ update_id: nextUpdateId(), message: { message_id: 41, chat: { id: telegramUser.id }, from: telegramUser, successful_payment: payment } });
  assert.equal(rows('tavro_payments').length, 1);
  assert.equal(rows('tavro_subscriptions')[0].current_period_end, firstEnd);
});

test('PRO поднимает дневной лимит ИИ', async () => {
  const { send, rows, db } = harness({ env: { TAVRO_STARS_PRO_MONTH: '500' } });
  await send(textUpdate('/start'));
  const account = db.tables.tavro_accounts[0];
  await send({
    update_id: nextUpdateId(),
    message: { message_id: 50, chat: { id: telegramUser.id }, from: telegramUser, successful_payment: { currency: 'XTR', total_amount: 500, invoice_payload: invoicePayload('pro_month', account.id, 'n1'), telegram_payment_charge_id: 'charge-pro' } },
  });
  for (let index = 0; index < 5; index += 1) await send(textUpdate(`фраза ${index}`, { messageId: 60 + index }));
  assert.equal(rows('tavro_captures').length, 5, 'на PRO пять фраз подряд должны пройти');
});

test('тарифы показывают рублёвые цены и не продают то, у чего нет цены в Stars', async () => {
  const configured = harness({ env: { TAVRO_STARS_PRO_MONTH: '500' } });
  await configured.send(textUpdate('/plans'));
  const text = configured.telegram.lastText();
  assert.match(text, /250 ₽/);
  assert.match(text, /1800 ₽/);
  assert.match(text, /5000 ₽/);
  assert.match(text, /автопродление каждые 30 дней/);
  assert.match(text, /разовая покупка/);
  const buttons = configured.telegram.sent().at(-1).payload.reply_markup.inline_keyboard.flat();
  assert.deepEqual(buttons.map(button => button.callback_data), ['buy:pro_month']);
  assert.match(text, /Цена в Stars пока не настроена: PRO — год, PRO — навсегда/);
});

// ------------------------------------------------------------------ photo ---

test('фото сохраняется, но калорийность по снимку не обещается', async () => {
  const { send, telegram, rows } = harness();
  await send({
    update_id: nextUpdateId(),
    message: { message_id: 70, chat: { id: telegramUser.id }, from: telegramUser, caption: 'мой обед', photo: [{ file_id: 'small' }, { file_id: 'large' }] },
  });
  const note = rows('tavro_notes')[0];
  assert.equal(note.kind, 'meal');
  assert.equal(note.photo_file_id, 'large');
  assert.equal(note.photo_summary_is_estimate, true);
  assert.match(telegram.lastText(), /не считаю/);
});

// ----------------------------------------------------------------- misc -----

test('идентификатор запроса детерминирован по сообщению', () => {
  const first = uuidFromParts('chat:1');
  assert.equal(first, uuidFromParts('chat:1'));
  assert.notEqual(first, uuidFromParts('chat:2'));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('настройки показывают реальное состояние и переключают напоминания', async () => {
  const { send, telegram, rows } = harness();
  await send(textUpdate('/settings'));
  assert.match(telegram.lastText(), /Europe\/Moscow/);
  assert.match(telegram.lastText(), /включены/);

  await send(callbackUpdate('reminders:off'));
  assert.equal(rows('tavro_accounts')[0].reminders_enabled, false);
});

test('кириллическое слово-вопрос распознаётся, но не как префикс другого слова', () => {
  assert.equal(isQuestion('как дела с проектом'), true);
  assert.equal(isQuestion('какао купить'), false, '«какао» не вопрос');
  assert.equal(isQuestion('когда встреча'), true);
  assert.equal(isQuestion('которую неделю болею'), false);
});
