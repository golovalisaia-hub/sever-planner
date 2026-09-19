// TAVRO Telegram bot.
//
// A plain Telegram chat, not a mobile app pretending to be one: short messages,
// inline buttons, edited messages instead of walls of new ones. Every update is
// claimed by `update_id` before any work happens, so Telegram's retries can
// never create a record twice.

import { AppError, checked, fail, integer, text as textField } from '../_shared/validation.ts';
import { formatWhen, todayIn } from '../_shared/datetime.ts';
import { TavroStore, type Account } from './store.ts';
import { claimAiAction, previewMessage, releaseAiAction, runCapture, savedMessage, plural, MAX_PHRASE_CHARS } from './capture.ts';
import { answerQuestion } from './search.ts';
import { parseStoredItems } from './ai/schema.ts';
import { aiConfigured, providerFromEnv } from './ai/provider.ts';
import { MAX_VOICE_BYTES, MAX_VOICE_SECONDS, speechConfigured, speechFromEnv } from './ai/speech.ts';
import { PAID_PLAN_IDS, PLANS, fairUseNotice, planOf, starsFor, type PlanId } from './billing.ts';
import { applyRefund, cancelSubscription, createInvoice, grantFromPayment, validatePreCheckout } from './payments.ts';
import { TelegramApi, escapeHtml, keyboard, verifyWebhookSecret, type InlineButton } from './telegram.ts';

const MAX_UPDATE_BYTES = 200000;

// A Cyrillic word has no \b boundary in JavaScript regex (\w is ASCII-only), so
// the negative lookahead is what keeps "как" from matching "какао".
const QUESTION_WORDS = /^(что|чего|когда|сколько|какие|какой|какая|каких|где|кто|кому|почему|зачем|как|есть ли|покажи|перечисли)(?![а-яё])/i;

export const WELCOME = [
  '<b>TAVRO</b>',
  '<i>Твои мысли. В твоём ритме.</i>',
  '',
  'Скажи или напиши одной фразой — я разберу её на встречи, задачи, заметки и дневник.',
  '',
  'Например: «завтра встреча с Андреем в 15:00, потом изучить Python и оплатить интернет».',
].join('\n');

const HELP = [
  '<b>Как пользоваться</b>',
  '',
  '<b>Голосом</b> — просто запиши голосовое прямо в этот чат. Разберу и покажу, что получилось, до сохранения.',
  '<b>Текстом</b> — напиши фразу, можно сразу несколько дел через запятую.',
  '<b>Вопросом</b> — «что у меня завтра?», «сколько встреч с Андреем в этом месяце?», «что я записывал про проект?».',
  '<b>Фото</b> — пришли снимок с подписью, сохраню в заметки или в дневник питания.',
  '',
  'Я не придумываю дату и время. Если ты их не назвал — запись сохранится без них, и ты выставишь их в приложении.',
  '',
  'Команды: /start · /today · /plans · /settings · /help',
].join('\n');

const mainKeyboard = (appUrl: string | null): { inline_keyboard: InlineButton[][] } => keyboard([
  appUrl ? [{ text: '◆ Открыть TAVRO', web_app: { url: appUrl } }] : [{ text: '◆ Сегодня', callback_data: 'today' }],
  [{ text: '⚡ Быстрый запуск', callback_data: 'quick' }, { text: '★ TAVRO Pro', callback_data: 'plans' }],
  [{ text: '⚙ Настройки', callback_data: 'settings' }, { text: '? Помощь', callback_data: 'help' }],
]);

const previewKeyboard = (captureId: string) => keyboard([
  [{ text: '✓ Сохранить', callback_data: `save:${captureId}` }, { text: '✕ Отменить', callback_data: `drop:${captureId}` }],
]);

export type BotDeps = {
  createClient: (url: string, key: string, options?: unknown) => any;
  env: (name: string) => string | undefined;
  telegramFactory?: (token: string) => TelegramApi;
  providerFactory?: typeof providerFromEnv;
  speechFactory?: typeof speechFromEnv;
};

export function createBotHandler(deps: BotDeps) {
  const env = deps.env;
  const providerFactory = deps.providerFactory || providerFromEnv;
  const speechFactory = deps.speechFactory || speechFromEnv;

  return async function handle(request: Request): Promise<Response> {
    const ok = (body: unknown = { ok: true }) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

    try {
      if (request.method !== 'POST') fail('METHOD_NOT_ALLOWED', 'Метод не поддерживается.', 405);
      verifyWebhookSecret(request, env('TAVRO_WEBHOOK_SECRET') || '');

      const raw = await readBody(request);
      let update: any;
      try { update = JSON.parse(raw); } catch { fail('VALIDATION', 'Некорректный JSON.'); }
      if (!update || typeof update !== 'object' || !Number.isSafeInteger(update.update_id))
        fail('VALIDATION', 'Некорректное обновление.');

      const db = deps.createClient(env('SUPABASE_URL') || '', env('SUPABASE_SERVICE_ROLE_KEY') || '', {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      // Telegram redelivers an update it believes failed. One claim, one run.
      const claim = await db.rpc('tavro_claim_update', { p_update_id: update.update_id });
      if (claim.error) fail('DATABASE_ERROR', 'Служба временно недоступна.', 503);
      if (claim.data !== true) return ok({ ok: true, duplicate: true });

      const telegram = (deps.telegramFactory || ((token: string) => new TelegramApi(token)))(env('TAVRO_BOT_TOKEN') || '');
      const store = new TavroStore(db);
      await route({ db, store, telegram, env, providerFactory, speechFactory }, update);
      return ok();
    } catch (error) {
      // A webhook must not retry forever on a permanent problem; the user-facing
      // reply is sent inside `route`, so failures here are infrastructural.
      const status = error instanceof AppError ? error.status : 500;
      if (status === 401 || status === 405) {
        return new Response(JSON.stringify({ error: error instanceof AppError ? error.code : 'ERROR' }), { status, headers: { 'Content-Type': 'application/json' } });
      }
      return ok({ ok: true, handled: false });
    }
  };
}

async function readBody(request: Request): Promise<string> {
  if (Number(request.headers.get('content-length') || 0) > MAX_UPDATE_BYTES) fail('TOO_LARGE', 'Слишком большое обновление.', 413);
  const reader = request.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let size = 0, raw = '';
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > MAX_UPDATE_BYTES) fail('TOO_LARGE', 'Слишком большое обновление.', 413);
      raw += decoder.decode(part.value, { stream: true });
    }
    raw += decoder.decode();
  } finally { await reader.cancel().catch(() => {}); }
  return raw;
}

type Context = {
  db: any; store: TavroStore; telegram: TelegramApi;
  env: (name: string) => string | undefined;
  providerFactory: typeof providerFromEnv;
  speechFactory: typeof speechFromEnv;
};

const appUrlOf = (env: Context['env']) => {
  const url = env('TAVRO_MINIAPP_URL');
  return url && /^https:\/\//i.test(url) ? url : null;
};

async function route(context: Context, update: any): Promise<void> {
  if (update.pre_checkout_query) return handlePreCheckout(context, update.pre_checkout_query);
  if (update.callback_query) return handleCallback(context, update.callback_query);
  const message = update.message || update.edited_message;
  if (!message || !message.from || message.from.is_bot) return;
  return handleMessage(context, message);
}

// --------------------------------------------------------------- messages ----

async function handleMessage(context: Context, message: any): Promise<void> {
  const chatId = message.chat?.id;
  if (!chatId) return;
  const account = await context.store.account(message.from);

  try {
    if (message.successful_payment) return await handleSuccessfulPayment(context, account, chatId, message.successful_payment);
    if (message.refunded_payment) {
      await applyRefund(context.db, account.id, message.refunded_payment.telegram_payment_charge_id);
      await context.telegram.sendMessage(chatId, 'Платёж возвращён. PRO отключён, все записи сохранены.');
      return;
    }
    if (message.voice || message.audio) return await handleVoice(context, account, chatId, message);
    if (message.photo) return await handlePhoto(context, account, chatId, message);

    const body = typeof message.text === 'string' ? message.text.trim() : '';
    if (!body) {
      await context.telegram.sendMessage(chatId, 'Пока понимаю текст, голосовые и фото. Пришлите что-то из этого.');
      return;
    }
    if (body.startsWith('/')) return await handleCommand(context, account, chatId, body);
    if (body.length > MAX_PHRASE_CHARS) {
      await context.telegram.sendMessage(chatId, `Слишком длинная фраза. До ${MAX_PHRASE_CHARS} символов за раз.`);
      return;
    }
    if (isQuestion(body)) return await handleQuestion(context, account, chatId, body, message.message_id);
    return await handleCapture(context, account, chatId, { phrase: body, source: 'text', requestId: requestIdFor(message) });
  } catch (error) {
    await replyError(context, chatId, error);
  }
}

export function isQuestion(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed.endsWith('?')) return true;
  return QUESTION_WORDS.test(trimmed);
}

/** A stable per-update id, so a Telegram retry reuses the same AI claim. */
function requestIdFor(message: any): string {
  return uuidFromParts(`${message.chat.id}:${message.message_id}`);
}

/** Deterministic UUIDv4-shaped id derived from a Telegram message identity. */
export function uuidFromParts(seed: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193, h3 = 0x9e3779b9, h4 = 0x85ebca6b;
  for (let index = 0; index < seed.length; index += 1) {
    const code = seed.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 16777619) >>> 0;
    h2 = Math.imul(h2 + code, 2246822519) >>> 0;
    h3 = Math.imul(h3 ^ (code + index), 3266489917) >>> 0;
    h4 = Math.imul(h4 + (code * (index + 1)), 668265263) >>> 0;
  }
  const hex = [h1, h2, h3, h4].map(value => value.toString(16).padStart(8, '0')).join('');
  return [
    hex.slice(0, 8), hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

async function handleCommand(context: Context, account: Account, chatId: number, body: string): Promise<void> {
  const command = body.split(/[\s@]/)[0].toLowerCase();
  const appUrl = appUrlOf(context.env);

  if (command === '/start') {
    await context.store.markOnboarded(account.id);
    await context.telegram.sendMessage(chatId, WELCOME, { reply_markup: mainKeyboard(appUrl) });
    return;
  }
  if (command === '/help') { await context.telegram.sendMessage(chatId, HELP, { reply_markup: mainKeyboard(appUrl) }); return; }
  if (command === '/today') return sendToday(context, account, chatId);
  if (command === '/plans' || command === '/pro') return sendPlans(context, account, chatId);
  if (command === '/settings') return sendSettings(context, account, chatId);
  if (command === '/cancel') {
    const result = await cancelSubscription(context.db, context.telegram, account);
    await context.telegram.sendMessage(chatId, result.message);
    return;
  }
  await context.telegram.sendMessage(chatId, 'Не знаю такую команду. /help покажет, что я умею.');
}

async function handleCapture(
  context: Context, account: Account, chatId: number,
  input: { phrase: string; source: 'text' | 'voice' | 'photo' | 'quick'; requestId: string; transcript?: string | null },
): Promise<void> {
  if (!aiConfigured(context.env)) {
    await context.telegram.sendMessage(chatId, 'ИИ ещё не подключён на сервере. Планер в приложении работает как обычно.');
    return;
  }
  const entitlement = await context.store.entitlement(account.id);
  const provider = context.providerFactory(context.env);
  await context.telegram.sendChatAction(chatId, 'typing').catch(() => {});

  const outcome = await runCapture({ db: context.db, store: context.store, provider }, {
    account, entitlement, phrase: input.phrase, source: input.source,
    requestId: input.requestId, transcript: input.transcript ?? null, chatId,
  });

  const sent = await context.telegram.sendMessage(chatId, previewMessage(outcome.draft, { transcript: input.transcript }), {
    reply_markup: previewKeyboard(outcome.captureId),
  });
  if (sent?.message_id) await context.store.attachCaptureMessage(outcome.captureId, sent.message_id);
}

async function handleQuestion(context: Context, account: Account, chatId: number, question: string, messageId: number): Promise<void> {
  if (!aiConfigured(context.env)) {
    await context.telegram.sendMessage(chatId, 'ИИ ещё не подключён на сервере.');
    return;
  }
  const entitlement = await context.store.entitlement(account.id);
  const requestId = uuidFromParts(`ask:${chatId}:${messageId}`);
  const quota = await claimAiAction(context.db, account, entitlement, requestId, 'ask');
  if (!quota.allowed) {
    await context.telegram.sendMessage(chatId, quotaMessage(quota.limit, quota.plan));
    return;
  }
  await context.telegram.sendChatAction(chatId, 'typing').catch(() => {});
  try {
    const provider = context.providerFactory(context.env);
    const answer = await answerQuestion({ store: context.store, provider }, { account, question });
    await context.telegram.sendMessage(chatId, answer.text);
  } catch (error) {
    await releaseAiAction(context.db, requestId, error instanceof AppError ? error.code : 'ASK_ERROR');
    throw error;
  }
}

async function handleVoice(context: Context, account: Account, chatId: number, message: any): Promise<void> {
  const voice = message.voice || message.audio;
  const duration = Number(voice.duration) || 0;

  if (!speechConfigured(context.env)) {
    await context.telegram.sendMessage(chatId, 'Распознавание речи ещё не подключено на сервере. Напишите фразу текстом — разберу так же.');
    return;
  }
  if (duration > MAX_VOICE_SECONDS) {
    await context.telegram.sendMessage(chatId, `Голосовое длиннее ${MAX_VOICE_SECONDS} секунд. Отправьте покороче или напишите текстом.`);
    return;
  }
  if (Number(voice.file_size) > MAX_VOICE_BYTES) {
    await context.telegram.sendMessage(chatId, 'Голосовое слишком большое.');
    return;
  }

  const entitlement = await context.store.entitlement(account.id);
  const requestId = uuidFromParts(`voice:${chatId}:${message.message_id}`);
  const quota = await claimAiAction(context.db, account, entitlement, requestId, 'transcribe');
  if (!quota.allowed) {
    await context.telegram.sendMessage(chatId, quotaMessage(quota.limit, quota.plan));
    return;
  }

  const waiting = await context.telegram.sendMessage(chatId, '◌ Слушаю…');
  let transcript = '';
  try {
    const file = await context.telegram.getFile(voice.file_id);
    // Audio lives in memory for this request only and is never persisted.
    const audio = await context.telegram.downloadFile(file.file_path, MAX_VOICE_BYTES);
    const speech = context.speechFactory(context.env);
    const recognised = await speech.transcribe({
      audio, mimeType: voice.mime_type || 'audio/ogg', durationSeconds: duration || 1, language: 'ru-RU',
    });
    transcript = recognised.text;
    await context.db.from('tavro_ai_usage').update({ audio_seconds: recognised.seconds, success: true }).eq('request_id', requestId);
  } catch (error) {
    await releaseAiAction(context.db, requestId, error instanceof AppError ? error.code : 'SPEECH_ERROR');
    await context.telegram.editMessageText(chatId, waiting.message_id,
      error instanceof AppError ? escapeHtml(error.message) : 'Не удалось распознать голосовое. Попробуйте ещё раз или напишите текстом.',
      { reply_markup: keyboard([[{ text: '↻ Попробовать снова', callback_data: 'retryvoice' }]]) }).catch(() => {});
    return;
  }

  await context.telegram.editMessageText(chatId, waiting.message_id, '◌ Разбираю…').catch(() => {});
  try {
    const captureRequestId = uuidFromParts(`voicecapture:${chatId}:${message.message_id}`);
    if (!aiConfigured(context.env)) {
      await context.telegram.editMessageText(chatId, waiting.message_id, `Распознал: «${escapeHtml(transcript)}»\n\nИИ-разбор ещё не подключён на сервере.`);
      return;
    }
    const provider = context.providerFactory(context.env);
    const outcome = await runCapture({ db: context.db, store: context.store, provider }, {
      account, entitlement, phrase: transcript, source: 'voice',
      // The transcription already consumed this phrase's AI action, so the
      // parse runs without a numeric cap: one phrase stays one action.
      requestId: captureRequestId, transcript, chatId, billable: false,
    });
    await context.telegram.editMessageText(chatId, waiting.message_id, previewMessage(outcome.draft, { transcript }), {
      reply_markup: previewKeyboard(outcome.captureId),
    });
    await context.store.attachCaptureMessage(outcome.captureId, waiting.message_id);
  } catch (error) {
    await context.telegram.editMessageText(chatId, waiting.message_id,
      `Распознал: «${escapeHtml(transcript)}»\n\n${error instanceof AppError ? escapeHtml(error.message) : 'Не удалось разобрать фразу.'}`).catch(() => {});
  }
}

async function handlePhoto(context: Context, account: Account, chatId: number, message: any): Promise<void> {
  const photo = message.photo[message.photo.length - 1];
  const caption = typeof message.caption === 'string' ? message.caption.trim().slice(0, 200) : '';
  const isMeal = /ед|обед|завтрак|ужин|перекус|поел|съел|питани/i.test(caption);
  const note = await context.store.addPhotoNote(account, {
    kind: isMeal ? 'meal' : 'note',
    fileId: photo.file_id,
    caption: caption || null,
    summary: null,
  });
  const where = isMeal ? 'дневник питания' : 'заметки';
  await context.telegram.sendMessage(chatId,
    `Фото сохранено в ${where}.${isMeal ? '\n\n<i>Состав и калорийность по фото я не считаю — это была бы догадка, а не данные. Допишите словами, если нужно.</i>' : ''}`,
    { reply_markup: keyboard([[{ text: '✕ Удалить', callback_data: `dropnote:${note.id}` }]]) });
}

async function handleSuccessfulPayment(context: Context, account: Account, chatId: number, payment: any): Promise<void> {
  const result = await grantFromPayment(context.db, account, payment);
  if (result.duplicate) return;
  const definition = PLANS[result.plan];
  const until = result.expiresAt ? ` до ${new Date(result.expiresAt).toLocaleDateString('ru-RU')}` : ' без срока';
  await context.telegram.sendMessage(chatId,
    `<b>${escapeHtml(definition.title)} активирован</b>${escapeHtml(until)}.\n\n${escapeHtml(fairUseNotice(result.plan))}`,
    { reply_markup: mainKeyboard(appUrlOf(context.env)) });
}

async function handlePreCheckout(context: Context, query: any): Promise<void> {
  try {
    const account = await context.store.account(query.from);
    const verdict = validatePreCheckout(query, account, context.env);
    if (verdict.ok) await context.telegram.answerPreCheckoutQuery(query.id, true);
    else await context.telegram.answerPreCheckoutQuery(query.id, false, verdict.reason);
  } catch {
    await context.telegram.answerPreCheckoutQuery(query.id, false, 'Платёж сейчас недоступен. Попробуйте позже.').catch(() => {});
  }
}

// -------------------------------------------------------------- callbacks ----

async function handleCallback(context: Context, query: any): Promise<void> {
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  const data = typeof query.data === 'string' ? query.data.slice(0, 64) : '';
  const [action, ...args] = data.split(':');

  let account: Account;
  try { account = await context.store.account(query.from); }
  catch { await context.telegram.answerCallbackQuery(query.id, { text: 'Аккаунт недоступен.', show_alert: true }).catch(() => {}); return; }

  try {
    if (action === 'save') return await confirmCapture(context, account, chatId, messageId, query.id, args[0]);
    if (action === 'drop') {
      const dropped = await context.store.discardCapture(account.id, args[0]);
      await context.telegram.answerCallbackQuery(query.id, { text: dropped ? 'Отменено' : 'Уже обработано' });
      if (dropped && messageId) await context.telegram.editMessageText(chatId, messageId, 'Черновик отменён. Ничего не сохранено.', { reply_markup: keyboard([]) }).catch(() => {});
      return;
    }
    if (action === 'done') {
      const task = await context.store.completeTask(account, args[0], true);
      await context.telegram.answerCallbackQuery(query.id, { text: 'Готово' });
      if (messageId) await context.telegram.editMessageText(chatId, messageId, `✓ <s>${escapeHtml(task.title)}</s>\n<i>Задача выполнена.</i>`, {
        reply_markup: keyboard([[{ text: '↺ Вернуть', callback_data: `undone:${task.id}` }]]),
      }).catch(() => {});
      return;
    }
    if (action === 'undone') {
      const task = await context.store.completeTask(account, args[0], false);
      await context.telegram.answerCallbackQuery(query.id, { text: 'Возвращено' });
      if (messageId) await context.telegram.editMessageText(chatId, messageId, `◆ ${escapeHtml(task.title)}\n<i>Задача снова активна.</i>`, {
        reply_markup: keyboard([[{ text: '✓ Выполнено', callback_data: `done:${task.id}` }]]),
      }).catch(() => {});
      return;
    }
    if (action === 'snooze') {
      const task = await context.store.snoozeTask(account, args[0], integer(Number(args[1] || 1), 1, 365));
      await context.telegram.answerCallbackQuery(query.id, { text: 'Перенесено' });
      if (messageId) await context.telegram.editMessageText(chatId, messageId,
        `◆ ${escapeHtml(task.title)}\n<i>Перенесено на ${formatWhen(task.scheduled_for, task.scheduled_time, todayIn(account.timezone))}.</i>`,
        { reply_markup: keyboard([[{ text: '✓ Выполнено', callback_data: `done:${task.id}` }]]) }).catch(() => {});
      return;
    }
    if (action === 'eventdone') {
      const event = await context.store.updateEventStatus(account, args[0], 'done');
      await context.telegram.answerCallbackQuery(query.id, { text: 'Отмечено' });
      if (messageId) await context.telegram.editMessageText(chatId, messageId, `✓ <s>${escapeHtml(event.title)}</s>\n<i>Встреча прошла.</i>`, { reply_markup: keyboard([]) }).catch(() => {});
      return;
    }
    if (action === 'dropnote') {
      await context.db.from('tavro_notes').update({ deleted_at: new Date().toISOString() }).eq('id', args[0]).eq('account_id', account.id);
      await context.telegram.answerCallbackQuery(query.id, { text: 'Удалено' });
      if (messageId) await context.telegram.editMessageText(chatId, messageId, 'Запись удалена.', { reply_markup: keyboard([]) }).catch(() => {});
      return;
    }
    if (action === 'today') { await context.telegram.answerCallbackQuery(query.id); return await sendToday(context, account, chatId); }
    if (action === 'plans') { await context.telegram.answerCallbackQuery(query.id); return await sendPlans(context, account, chatId); }
    if (action === 'settings') { await context.telegram.answerCallbackQuery(query.id); return await sendSettings(context, account, chatId); }
    if (action === 'help') { await context.telegram.answerCallbackQuery(query.id); await context.telegram.sendMessage(chatId, HELP); return; }
    if (action === 'quick') { await context.telegram.answerCallbackQuery(query.id); return await sendQuickStart(context, account, chatId); }
    if (action === 'retryvoice') { await context.telegram.answerCallbackQuery(query.id, { text: 'Запишите голосовое ещё раз' }); return; }
    if (action === 'reminders') {
      const enabled = args[0] === 'on';
      await context.store.setRemindersEnabled(account.id, enabled);
      await context.telegram.answerCallbackQuery(query.id, { text: enabled ? 'Напоминания включены' : 'Напоминания выключены' });
      return await sendSettings(context, { ...account, reminders_enabled: enabled }, chatId, messageId);
    }
    if (action === 'buy') return await sendInvoice(context, account, chatId, query.id, planOf(args[0]));
    if (action === 'cancelsub') {
      const result = await cancelSubscription(context.db, context.telegram, account);
      await context.telegram.answerCallbackQuery(query.id, { text: result.ok ? 'Автопродление отключено' : 'Нечего отменять' });
      await context.telegram.sendMessage(chatId, escapeHtml(result.message));
      return;
    }
    await context.telegram.answerCallbackQuery(query.id);
  } catch (error) {
    await context.telegram.answerCallbackQuery(query.id, {
      text: error instanceof AppError ? error.message.slice(0, 190) : 'Не получилось. Попробуйте ещё раз.',
      show_alert: true,
    }).catch(() => {});
  }
}

/** Saves a reviewed draft. The claim makes a double tap a no-op, not a duplicate. */
async function confirmCapture(context: Context, account: Account, chatId: number, messageId: number | undefined, queryId: string, captureId: string): Promise<void> {
  const capture = await context.store.captureById(account.id, captureId);
  if (capture.status !== 'pending') {
    await context.telegram.answerCallbackQuery(queryId, { text: 'Уже сохранено' });
    return;
  }
  const claimed = await context.store.claimCapture(account.id, captureId);
  if (!claimed) {
    await context.telegram.answerCallbackQuery(queryId, { text: 'Уже сохранено' });
    return;
  }

  const today = capture.draft?.today || todayIn(account.timezone);
  const items = parseStoredItems(capture.draft?.items, today);
  const saved = await context.store.saveItems(account, items, { source: capture.source, captureId });
  await context.telegram.answerCallbackQuery(queryId, { text: `Сохранено: ${saved.length}` });

  const followUp: InlineButton[][] = [];
  const firstTask = saved.find(record => record.kind === 'task');
  if (firstTask) followUp.push([{ text: `✓ ${firstTask.title.slice(0, 24)}`, callback_data: `done:${firstTask.id}` }]);
  const appUrl = appUrlOf(context.env);
  if (appUrl) followUp.push([{ text: '◆ Открыть TAVRO', web_app: { url: appUrl } }]);

  if (messageId) {
    await context.telegram.editMessageText(chatId, messageId, savedMessage(saved, today), { reply_markup: keyboard(followUp) }).catch(() => {});
  } else {
    await context.telegram.sendMessage(chatId, savedMessage(saved, today), { reply_markup: keyboard(followUp) });
  }
}

// ----------------------------------------------------------------- screens ---

async function sendToday(context: Context, account: Account, chatId: number): Promise<void> {
  const today = todayIn(account.timezone);
  const [{ tasks, events }, overdue] = await Promise.all([
    context.store.agenda(account, today),
    context.store.overdue(account, today, 5),
  ]);

  const lines: string[] = [`<b>Сегодня · ${formatWhen(today, null, today)}</b>`];
  if (!tasks.length && !events.length) lines.push('', 'На сегодня записей нет. Скажите фразу — я разберу её.');
  for (const event of events) lines.push(`● ${event.event_time ? event.event_time.slice(0, 5) + ' · ' : ''}${escapeHtml(event.title)}`);
  for (const task of tasks) lines.push(`${task.completed ? '✓' : '◆'} ${task.scheduled_time ? task.scheduled_time.slice(0, 5) + ' · ' : ''}${escapeHtml(task.title)}`);
  if (overdue.length) {
    lines.push('', `<b>Просрочено: ${overdue.length}</b>`);
    for (const task of overdue) lines.push(`◆ ${escapeHtml(task.title)} <i>· ${formatWhen(task.scheduled_for, task.scheduled_time, today)}</i>`);
  }

  const rows: InlineButton[][] = [];
  const open = tasks.filter((task: any) => !task.completed).slice(0, 3);
  for (const task of open) rows.push([{ text: `✓ ${task.title.slice(0, 28)}`, callback_data: `done:${task.id}` }]);
  const appUrl = appUrlOf(context.env);
  if (appUrl) rows.push([{ text: '◆ Открыть TAVRO', web_app: { url: appUrl } }]);
  await context.telegram.sendMessage(chatId, lines.join('\n'), { reply_markup: keyboard(rows) });
}

async function sendPlans(context: Context, account: Account, chatId: number): Promise<void> {
  const entitlement = await context.store.entitlement(account.id);
  const lines = ['<b>TAVRO Pro</b>', ''];

  if (entitlement.pro) {
    const definition = PLANS[entitlement.plan];
    lines.push(`Активен: <b>${escapeHtml(definition.title)}</b>`);
    if (entitlement.expiresAt) lines.push(`Действует до ${new Date(entitlement.expiresAt).toLocaleDateString('ru-RU')}${entitlement.autoRenew ? ' · продлевается автоматически' : ' · без автопродления'}`);
    else lines.push('Доступ без срока.');
    lines.push('', escapeHtml(fairUseNotice(entitlement.plan)));
  } else {
    if (entitlement.lapsed) lines.push('<i>Подписка закончилась. Все записи на месте, планер работает.</i>', '');
    lines.push(`Сейчас: <b>FREE</b> — ${PLANS.free.dailyAiActions} AI-действия в день. Планер, напоминания и записи без ограничений.`, '');
  }

  const rows: InlineButton[][] = [];
  const unavailable: string[] = [];
  for (const id of PAID_PLAN_IDS) {
    const definition = PLANS[id];
    const stars = starsFor(id, context.env);
    const renewal = definition.billing === 'subscription' ? 'автопродление каждые 30 дней' : 'разовая покупка';
    lines.push(`<b>${escapeHtml(definition.title)}</b> — ${definition.rub} ₽ · ${renewal}`);
    lines.push(`<i>${escapeHtml(definition.summary)}</i>`, '');
    if (stars === null) unavailable.push(definition.title);
    else if (!entitlement.pro || entitlement.plan !== id) rows.push([{ text: `${definition.title} · ${stars} ★`, callback_data: `buy:${id}` }]);
  }
  if (unavailable.length) lines.push(`<i>Цена в Stars пока не настроена: ${escapeHtml(unavailable.join(', '))}.</i>`);
  if (entitlement.autoRenew) rows.push([{ text: '✕ Отключить автопродление', callback_data: 'cancelsub' }]);

  await context.telegram.sendMessage(chatId, lines.join('\n').trim(), { reply_markup: keyboard(rows) });
}

async function sendInvoice(context: Context, account: Account, chatId: number, queryId: string, plan: PlanId): Promise<void> {
  try {
    const invoice = await createInvoice(context.telegram, context.env, account, plan);
    await context.telegram.answerCallbackQuery(queryId);
    await context.telegram.sendMessage(chatId,
      `<b>${escapeHtml(PLANS[plan].title)}</b> — ${invoice.stars} ★\n\n${escapeHtml(fairUseNotice(plan))}`,
      { reply_markup: keyboard([[{ text: `Оплатить ${invoice.stars} ★`, url: invoice.url }]]) });
  } catch (error) {
    await context.telegram.answerCallbackQuery(queryId, {
      text: error instanceof AppError ? error.message.slice(0, 190) : 'Покупка сейчас недоступна.',
      show_alert: true,
    });
  }
}

async function sendSettings(context: Context, account: Account, chatId: number, editMessageId?: number): Promise<void> {
  const entitlement = await context.store.entitlement(account.id);
  const lines = [
    '<b>Настройки</b>',
    '',
    `Часовой пояс: <b>${escapeHtml(account.timezone)}</b>`,
    `Напоминания: <b>${account.reminders_enabled ? 'включены' : 'выключены'}</b>`,
    `Тариф: <b>${escapeHtml(PLANS[entitlement.plan].title)}</b> · ${entitlement.dailyAiActions} AI-${plural(entitlement.dailyAiActions, 'действие', 'действия', 'действий')} в день`,
    '',
    '<i>Часовой пояс берётся из приложения при открытии Mini App — там же его можно поменять вручную.</i>',
  ];
  const rows: InlineButton[][] = [[
    account.reminders_enabled
      ? { text: '🔕 Выключить напоминания', callback_data: 'reminders:off' }
      : { text: '🔔 Включить напоминания', callback_data: 'reminders:on' },
  ], [{ text: '★ Тарифы', callback_data: 'plans' }]];
  const appUrl = appUrlOf(context.env);
  if (appUrl) rows.push([{ text: '◆ Открыть TAVRO', web_app: { url: appUrl } }]);

  if (editMessageId) {
    await context.telegram.editMessageText(chatId, editMessageId, lines.join('\n'), { reply_markup: keyboard(rows) }).catch(() => {});
    return;
  }
  await context.telegram.sendMessage(chatId, lines.join('\n'), { reply_markup: keyboard(rows) });
}

async function sendQuickStart(context: Context, account: Account, chatId: number): Promise<void> {
  const appUrl = appUrlOf(context.env);
  const lines = [
    '<b>Быстрый запуск с телефона</b>',
    '',
    '<b>Самый быстрый способ</b> — закрепить этот чат сверху в Telegram и записывать голосовое прямо здесь.',
    '',
    '<b>iPhone</b>',
    '· Кнопка «Действие» (iPhone 15 Pro и новее): Настройки → Кнопка «Действие» → Быстрая команда.',
    '· Касание задней панели: Настройки → Универсальный доступ → Касание → Касание задней панели.',
    '· Команды: создайте команду «Записать в TAVRO» с действием «Открыть URL».',
    '',
    '<b>Android</b>',
    '· Долгое нажатие на иконку Telegram → перетащите ярлык этого чата на экран.',
    '· В Chrome: «Добавить на главный экран» для Mini App.',
    '',
    '<i>Набор жестов зависит от модели и версии системы — одинаковой поддержки на всех устройствах нет.</i>',
  ];
  if (appUrl) lines.push('', `Ссылка приложения: ${escapeHtml(appUrl)}`);
  lines.push('', '<i>Токен для Shortcuts выдаётся в приложении: Настройки → Быстрый ввод. Токен ограничен только созданием записей, его можно отозвать.</i>');
  await context.telegram.sendMessage(chatId, lines.join('\n'), { reply_markup: mainKeyboard(appUrl) });
}

function quotaMessage(limit: number, plan: string): string {
  return `Дневной лимит ИИ исчерпан: ${limit} ${plural(limit, 'действие', 'действия', 'действий')} в сутки на тарифе ${plan === 'free' ? 'FREE' : 'PRO'}.\n\nПланер не ограничен — записи можно создавать вручную в приложении. Лимит обновится завтра.`;
}

async function replyError(context: Context, chatId: number, error: unknown): Promise<void> {
  const message = error instanceof AppError ? error.message : 'Что-то пошло не так. Попробуйте ещё раз.';
  await context.telegram.sendMessage(chatId, escapeHtml(message)).catch(() => {});
}
