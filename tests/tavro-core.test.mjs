import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { addDays, formatWhen, offsetAt, resolveRelative, todayIn, weekdayOf, zonedToUtc } from '../supabase/functions/_shared/datetime.ts';
import { safeEqual } from '../supabase/functions/_shared/validation.ts';
import { dedupeItems, parseCaptureResult, resolveDateField } from '../supabase/functions/_tavro/ai/schema.ts';
import { escapeHtml, verifyInitData, verifyWebhookSecret } from '../supabase/functions/_tavro/telegram.ts';
import { PLANS, entitlementOf, fairUseNotice, invoicePayload, parseInvoicePayload, periodEndAfterPayment, starsFor } from '../supabase/functions/_tavro/billing.ts';
import { previewMessage, plural, savedMessage } from '../supabase/functions/_tavro/capture.ts';
import { parseQueryPlan } from '../supabase/functions/_tavro/search.ts';

const BOT_TOKEN = '1234567890:TEST-token-not-a-real-bot-credential';

// --------------------------------------------------------------- datetime ---

test('relative dates resolve against the user day, not the server day', () => {
  // 2026-09-19 is a Saturday.
  assert.equal(weekdayOf('2026-09-19'), 6);
  assert.equal(resolveRelative('today', '2026-09-19'), '2026-09-19');
  assert.equal(resolveRelative('tomorrow', '2026-09-19'), '2026-09-20');
  assert.equal(resolveRelative('day_after_tomorrow', '2026-09-19'), '2026-09-21');
  assert.equal(resolveRelative('yesterday', '2026-09-19'), '2026-09-18');
  // From a Saturday both forms mean the same Monday: this week's Monday has
  // passed, and the next calendar week starts on it. A capture never resolves
  // into the past.
  assert.equal(resolveRelative('this_monday', '2026-09-19'), '2026-09-21');
  assert.equal(resolveRelative('next_monday', '2026-09-19'), '2026-09-21');
  assert.equal(resolveRelative('this_saturday', '2026-09-19'), '2026-09-19');
  assert.equal(resolveRelative('next_saturday', '2026-09-19'), '2026-09-26');
  // From a Monday the two forms genuinely differ.
  assert.equal(resolveRelative('this_monday', '2026-09-14'), '2026-09-14');
  assert.equal(resolveRelative('next_monday', '2026-09-14'), '2026-09-21');
  // And from mid-week, "next Friday" skips the Friday of this week.
  assert.equal(resolveRelative('this_friday', '2026-09-15'), '2026-09-18');
  assert.equal(resolveRelative('next_friday', '2026-09-15'), '2026-09-25');
  assert.equal(resolveRelative('in_10_days', '2026-09-19'), '2026-09-29');
  assert.throws(() => resolveRelative('sometime', '2026-09-19'), /Неизвестная относительная дата/);
});

test('month rollover keeps a valid calendar day', () => {
  assert.equal(resolveRelative('next_month', '2026-01-31'), '2026-02-28');
  assert.equal(resolveRelative('next_month', '2026-12-15'), '2027-01-15');
});

test('wall clock converts to UTC across a DST boundary', () => {
  // Moscow has no DST: a fixed +03:00 offset all year.
  assert.equal(zonedToUtc('2026-09-19', '15:00', 'Europe/Moscow'), '2026-09-19T12:00:00.000Z');
  assert.equal(zonedToUtc('2026-01-19', '15:00', 'Europe/Moscow'), '2026-01-19T12:00:00.000Z');
  // Berlin does: the same wall clock is a different instant in summer and winter.
  assert.equal(zonedToUtc('2026-07-01', '12:00', 'Europe/Berlin'), '2026-07-01T10:00:00.000Z');
  assert.equal(zonedToUtc('2026-12-01', '12:00', 'Europe/Berlin'), '2026-12-01T11:00:00.000Z');
  assert.equal(offsetAt('Europe/Moscow', Date.parse('2026-09-19T12:00:00Z')), 3 * 3600000);
});

test('the user day can differ from the UTC day', () => {
  const instant = Date.parse('2026-09-19T22:30:00Z');
  assert.equal(todayIn('Europe/Moscow', instant), '2026-09-20');
  assert.equal(todayIn('UTC', instant), '2026-09-19');
  assert.equal(todayIn('America/Los_Angeles', instant), '2026-09-19');
});

test('дата без даты читается как "без даты", а не как сегодня', () => {
  assert.equal(formatWhen(null, null, '2026-09-19'), 'без даты');
  assert.equal(formatWhen('2026-09-19', '15:00', '2026-09-19'), 'сегодня, 15:00');
  assert.equal(formatWhen('2026-09-20', '15:00', '2026-09-19'), 'завтра, 15:00');
  assert.equal(formatWhen('2026-10-03', null, '2026-09-19'), '3 окт');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
});

// ----------------------------------------------------------- capture schema --

const FLAGSHIP = {
  items: [
    { type: 'event', title: 'Встреча с Андреем', date: { relative: 'tomorrow' }, time: '15:00', participants: ['Андрей'] },
    { type: 'task', title: 'Изучить Python' },
    { type: 'task', title: 'Оплатить интернет' },
    { type: 'diary', title: 'Закончил проект', body: 'Сегодня закончил проект', date: { relative: 'today' } },
  ],
  clarification: null,
};

test('одна фраза разбирается в четыре разные записи', () => {
  const draft = parseCaptureResult(FLAGSHIP, '2026-09-19');
  assert.equal(draft.items.length, 4);
  assert.deepEqual(draft.items.map(item => item.type), ['event', 'task', 'task', 'diary']);

  const meeting = draft.items[0];
  assert.equal(meeting.title, 'Встреча с Андреем');
  assert.equal(meeting.date, '2026-09-20');
  assert.equal(meeting.time, '15:00');
  assert.deepEqual(meeting.participants, ['Андрей']);

  // The two tasks had no day in the phrase, so they keep none.
  assert.equal(draft.items[1].date, null);
  assert.equal(draft.items[1].time, null);
  assert.equal(draft.items[2].date, null);

  assert.equal(draft.items[3].date, '2026-09-19');
  assert.equal(draft.items[3].body, 'Сегодня закончил проект');
});

test('модель не может подсунуть выдуманную дату или чужое поле', () => {
  assert.throws(() => parseCaptureResult({ items: [{ type: 'task', title: 'Х', date: 'завтра' }] }, '2026-09-19'), /неизвестном формате/);
  assert.throws(() => parseCaptureResult({ items: [{ type: 'task', title: 'Х', date: { relative: 'someday' } }] }, '2026-09-19'), /неизвестную относительную дату/);
  assert.throws(() => parseCaptureResult({ items: [{ type: 'task', title: 'Х', user_id: 'abc' }] }, '2026-09-19'), /Недопустимое поле/);
  assert.throws(() => parseCaptureResult({ items: [{ type: 'task', title: 'Х', account_id: 'abc' }] }, '2026-09-19'), /Недопустимое поле/);
  assert.throws(() => parseCaptureResult({ items: [{ type: 'transfer', title: 'Х' }] }, '2026-09-19'), /тип записи/);
  assert.throws(() => parseCaptureResult({ items: [{ type: 'task', title: 'Х', time: '25:00' }] }, '2026-09-19'), /некорректное время/);
  assert.throws(() => parseCaptureResult({ items: [{ type: 'task', title: 'Х', date: { absolute: '2099-01-01' } }] }, '2026-09-19'), /слишком далеко/);
  assert.throws(() => parseCaptureResult({ items: [] }, '2026-09-19'), /не удалось распознать|Не удалось распознать/i);
});

test('уточнение не мешает сохранить то, что уже понято', () => {
  const draft = parseCaptureResult({
    items: [{ type: 'task', title: 'Позвонить врачу' }],
    clarification: { question: 'В какой день позвонить?', item_index: 0 },
  }, '2026-09-19');
  assert.equal(draft.items.length, 1);
  assert.equal(draft.clarification.question, 'В какой день позвонить?');
  assert.equal(draft.clarification.itemIndex, 0);
  assert.throws(() => parseCaptureResult({
    items: [{ type: 'task', title: 'Х' }],
    clarification: { question: 'Что?', item_index: 5 },
  }, '2026-09-19'), /несуществующую запись/);
});

test('повторы из одной фразы схлопываются', () => {
  const draft = parseCaptureResult({
    items: [
      { type: 'task', title: 'Оплатить интернет' },
      { type: 'task', title: 'оплатить интернет' },
      { type: 'task', title: 'Оплатить интернет', date: { relative: 'tomorrow' } },
    ],
  }, '2026-09-19');
  const unique = dedupeItems(draft.items);
  assert.equal(unique.length, 2);
});

test('resolveDateField принимает только закрытый словарь', () => {
  assert.deepEqual(resolveDateField(null, '2026-09-19'), { date: null, source: 'none', token: null });
  assert.equal(resolveDateField({ absolute: '2026-09-25' }, '2026-09-19').date, '2026-09-25');
  assert.equal(resolveDateField({ relative: 'tomorrow' }, '2026-09-19').source, 'relative');
  assert.throws(() => resolveDateField({ relative: 'tomorrow', absolute: '2026-09-20' }, '2026-09-19'), /неизвестном формате/);
});

// -------------------------------------------------------------- telegram ----

function buildInitData(fields, token = BOT_TOKEN) {
  const pairs = Object.entries(fields).map(([key, value]) => `${key}=${value}`).sort();
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(pairs.join('\n')).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

test('initData принимается только с подлинной подписью Telegram', async () => {
  const user = { id: 42, first_name: 'Лиса', username: 'tavro_user' };
  const initData = buildInitData({ auth_date: String(nowSeconds()), query_id: 'AAE', user: JSON.stringify(user) });
  const verified = await verifyInitData(initData, BOT_TOKEN);
  assert.equal(verified.user.id, 42);
  assert.equal(verified.user.first_name, 'Лиса');
  assert.equal(verified.queryId, 'AAE');
});

test('подделанный user или чужой токен отклоняются', async () => {
  const honest = buildInitData({ auth_date: String(nowSeconds()), user: JSON.stringify({ id: 42, first_name: 'Лиса' }) });
  // Swapping the user id while keeping the signature must not pass.
  const tampered = honest.replace('%3A42%2C', '%3A99%2C');
  assert.notEqual(tampered, honest, 'подмена должна действительно изменить initData');
  await assert.rejects(() => verifyInitData(tampered, BOT_TOKEN), /не подтверждена/);
  await assert.rejects(() => verifyInitData(honest, '999:another-bot-token'), /не подтверждена/);
  await assert.rejects(() => verifyInitData('user=%7B%22id%22%3A1%7D', BOT_TOKEN), /отсутствует/);
  await assert.rejects(() => verifyInitData('', BOT_TOKEN), /Откройте TAVRO/);
});

test('устаревший initData не переиспользуется', async () => {
  const stale = buildInitData({ auth_date: String(nowSeconds() - 90000), user: JSON.stringify({ id: 42, first_name: 'Лиса' }) });
  await assert.rejects(() => verifyInitData(stale, BOT_TOKEN), /устарела/);
  // A far-future auth_date is a forged clock, not skew.
  const future = buildInitData({ auth_date: String(nowSeconds() + 3600), user: JSON.stringify({ id: 42, first_name: 'Лиса' }) });
  await assert.rejects(() => verifyInitData(future, BOT_TOKEN), /Некорректная отметка/);
});

test('webhook принимается только с секретом, зарегистрированным в setWebhook', () => {
  const secret = 'webhook-secret-value-32-characters';
  const good = new Request('https://x.invalid/', { headers: { 'x-telegram-bot-api-secret-token': secret } });
  assert.doesNotThrow(() => verifyWebhookSecret(good, secret));
  const bad = new Request('https://x.invalid/', { headers: { 'x-telegram-bot-api-secret-token': 'nope' } });
  assert.throws(() => verifyWebhookSecret(bad, secret), /не подтверждён/);
  const missing = new Request('https://x.invalid/');
  assert.throws(() => verifyWebhookSecret(missing, secret), /не подтверждён/);
});

test('пользовательский текст не может внедрить HTML в сообщение бота', () => {
  assert.equal(escapeHtml('<b>hack</b> & "x"'), '&lt;b&gt;hack&lt;/b&gt; &amp; "x"');
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
});

// --------------------------------------------------------------- billing ----

test('доступ определяется сервером, а не клиентом', () => {
  const now = Date.parse('2026-09-19T12:00:00Z');
  assert.equal(entitlementOf(null, now).plan, 'free');
  assert.equal(entitlementOf(null, now).dailyAiActions, 3);

  const active = { account_id: 'a', plan: 'pro_month', status: 'active', current_period_end: '2026-10-19T12:00:00Z', auto_renew: true, telegram_charge_id: 'c', terms_version: 'v1' };
  assert.equal(entitlementOf(active, now).pro, true);
  assert.equal(entitlementOf(active, now).dailyAiActions, 100);
  assert.equal(entitlementOf(active, now).autoRenew, true);

  const expired = { ...active, current_period_end: '2026-09-18T12:00:00Z' };
  assert.equal(entitlementOf(expired, now).pro, false);
  assert.equal(entitlementOf(expired, now).lapsed, true);
  assert.equal(entitlementOf(expired, now).dailyAiActions, 3);

  const refunded = { ...active, status: 'refunded' };
  assert.equal(entitlementOf(refunded, now).pro, false);

  const lifetime = { ...active, plan: 'pro_lifetime', current_period_end: null, auto_renew: false };
  assert.equal(entitlementOf(lifetime, now).pro, true);
  assert.equal(entitlementOf(lifetime, now).expiresAt, null);
  assert.equal(entitlementOf(lifetime, now).dailyAiActions, 50);

  // A time-limited plan with no recorded end is not a valid grant.
  assert.equal(entitlementOf({ ...active, current_period_end: null }, now).pro, false);
});

test('оплата продлевает срок, а не укорачивает его', () => {
  const now = Date.parse('2026-09-19T12:00:00Z');
  assert.equal(periodEndAfterPayment('pro_month', { now }), '2026-10-19T12:00:00.000Z');
  // Renewing early extends from the existing end.
  assert.equal(periodEndAfterPayment('pro_month', { now, currentEnd: '2026-10-01T12:00:00Z' }), '2026-10-31T12:00:00.000Z');
  // An already-expired end does not drag the new period backwards.
  assert.equal(periodEndAfterPayment('pro_month', { now, currentEnd: '2026-01-01T12:00:00Z' }), '2026-10-19T12:00:00.000Z');
  // Telegram owns the renewal clock when it reports one.
  assert.equal(periodEndAfterPayment('pro_month', { now, telegramExpiration: Date.parse('2026-11-01T00:00:00Z') / 1000 }), '2026-11-01T00:00:00.000Z');
  assert.equal(periodEndAfterPayment('pro_year', { now }), '2027-09-19T12:00:00.000Z');
  assert.equal(periodEndAfterPayment('pro_lifetime', { now }), null);
});

test('рублёвые цены зафиксированы владельцем, цены в Stars настраиваются на сервере', () => {
  assert.equal(PLANS.free.rub, 0);
  assert.equal(PLANS.pro_month.rub, 250);
  assert.equal(PLANS.pro_year.rub, 1800);
  assert.equal(PLANS.pro_lifetime.rub, 5000);
  // A year purchase is never described as auto-renewing.
  assert.equal(PLANS.pro_year.billing, 'one_time');
  assert.equal(PLANS.pro_lifetime.billing, 'one_time');
  assert.equal(PLANS.pro_month.billing, 'subscription');

  // Unconfigured means unsellable, not "guess a rate".
  assert.equal(starsFor('pro_month', () => undefined), null);
  assert.equal(starsFor('pro_month', () => '0'), null);
  assert.equal(starsFor('pro_month', () => '9999'), null);
  assert.equal(starsFor('pro_month', () => '500'), 500);
  assert.equal(starsFor('free', () => '500'), null);
});

test('платёжный payload нельзя переиграть на чужой аккаунт', () => {
  const payload = invoicePayload('pro_year', '11111111-1111-4111-8111-111111111111', 'nonce1');
  const parsed = parseInvoicePayload(payload);
  assert.equal(parsed.plan, 'pro_year');
  assert.equal(parsed.accountId, '11111111-1111-4111-8111-111111111111');
  assert.throws(() => parseInvoicePayload('other:v1:pro_year:x:y'), /Некорректные данные платежа/);
  assert.throws(() => parseInvoicePayload('tavro:v1:pro_free:x:y'), /тариф/);
  assert.throws(() => parseInvoicePayload(42), /Некорректные данные платежа/);
});

test('условия честного использования показываются до покупки', () => {
  const notice = fairUseNotice('pro_lifetime');
  assert.match(notice, /50/);
  assert.match(notice, /без срока/);
  assert.match(notice, /не снижаем/);
});

// ------------------------------------------------------------- preview ------

test('предпросмотр показывает, что именно будет сохранено', () => {
  const draft = parseCaptureResult(FLAGSHIP, '2026-09-19');
  const message = previewMessage(draft, { transcript: 'завтра встреча с Андреем в 15:00' });
  assert.match(message, /Нашёл 4 записи/);
  assert.match(message, /Встреча с Андреем/);
  assert.match(message, /завтра, 15:00/);
  assert.match(message, /Изучить Python/);
  // Undated tasks say so instead of pretending to be today.
  assert.match(message, /без даты/);
  assert.doesNotMatch(message, /<script>/);

  const saved = savedMessage([{ kind: 'task', title: 'Оплатить интернет', date: null, time: null }], '2026-09-19');
  assert.match(saved, /Сохранено: 1 запись/);
});

test('русские числительные согласуются', () => {
  assert.equal(plural(1, 'запись', 'записи', 'записей'), 'запись');
  assert.equal(plural(2, 'запись', 'записи', 'записей'), 'записи');
  assert.equal(plural(5, 'запись', 'записи', 'записей'), 'записей');
  assert.equal(plural(11, 'запись', 'записи', 'записей'), 'записей');
  assert.equal(plural(21, 'запись', 'записи', 'записей'), 'запись');
});

// -------------------------------------------------------------- search ------

test('план поиска ограничен закрытым словарём', () => {
  const plan = parseQueryPlan({ intent: 'count_events', from: { relative: 'next_month' }, person: 'Андрей' }, '2026-09-19');
  assert.equal(plan.intent, 'count_events');
  assert.equal(plan.person, 'Андрей');
  assert.equal(plan.from, '2026-10-19');
  assert.throws(() => parseQueryPlan({ intent: 'drop_table' }, '2026-09-19'), /тип запроса/);
  assert.throws(() => parseQueryPlan({ intent: 'agenda', from: 'вчера' }, '2026-09-19'), /неизвестном формате/);
});
