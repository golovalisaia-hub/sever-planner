// Telegram trust boundary for TAVRO.
//
// Nothing in this file trusts a client-supplied identity. A Mini App request is
// accepted only after its initData signature verifies against the bot token, and
// a webhook update is accepted only when Telegram presents the secret token that
// was registered with setWebhook. The bot token itself never leaves the server.

import { AppError, fail, safeEqual, text } from '../_shared/validation.ts';

const encoder = new TextEncoder();

const hmacKey = (secret: ArrayBuffer | Uint8Array) =>
  crypto.subtle.importKey('raw', secret as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

const hmac = async (secret: ArrayBuffer | Uint8Array, message: string) =>
  new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(message)));

const toHex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

export type TelegramUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  allows_write_to_pm?: boolean;
};

export type VerifiedInitData = {
  user: TelegramUser;
  authDate: number;
  queryId: string | null;
  startParam: string | null;
  chatType: string | null;
};

/**
 * Validates Mini App initData using Telegram's documented algorithm:
 *   secret_key      = HMAC_SHA256(key = "WebAppData", data = bot_token)
 *   data_check_hash = HMAC_SHA256(key = secret_key, data = data_check_string)
 * where data_check_string is every field except `hash`, as `key=value`, sorted
 * by key and joined with "\n".
 *
 * `hash` is compared in constant time, and stale initData is rejected so a
 * leaked launch URL cannot be replayed indefinitely.
 */
export async function verifyInitData(
  initData: unknown,
  botToken: string,
  { maxAgeSeconds = 86400, now = Date.now() }: { maxAgeSeconds?: number; now?: number } = {},
): Promise<VerifiedInitData> {
  if (!botToken) fail('BOT_NOT_CONFIGURED', 'Бот не настроен на сервере.', 503);
  if (typeof initData !== 'string' || !initData || initData.length > 8192) fail('AUTH_REQUIRED', 'Откройте TAVRO из Telegram.', 401);

  const params = new URLSearchParams(initData as string);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) fail('AUTH_REQUIRED', 'Подпись Telegram отсутствует.', 401);

  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash' || key === 'signature') continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();

  const secretKey = await hmac(encoder.encode('WebAppData'), botToken);
  const expected = toHex(await hmac(secretKey, pairs.join('\n')));
  if (!safeEqual(expected, hash.toLowerCase())) fail('AUTH_INVALID', 'Подпись Telegram не подтверждена.', 401);

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || authDate <= 0) fail('AUTH_INVALID', 'Некорректная отметка времени Telegram.', 401);
  const ageSeconds = Math.floor(now / 1000) - authDate;
  if (ageSeconds > maxAgeSeconds) fail('AUTH_EXPIRED', 'Сессия устарела. Откройте TAVRO заново.', 401);
  // A small clock skew is normal; a far-future auth_date is not.
  if (ageSeconds < -300) fail('AUTH_INVALID', 'Некорректная отметка времени Telegram.', 401);

  let user: TelegramUser;
  try { user = JSON.parse(params.get('user') || ''); }
  catch { return fail('AUTH_INVALID', 'Telegram не передал пользователя.', 401); }
  if (!user || typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || user.id <= 0)
    fail('AUTH_INVALID', 'Telegram не передал пользователя.', 401);

  return {
    user,
    authDate,
    queryId: params.get('query_id'),
    startParam: params.get('start_param'),
    chatType: params.get('chat_type'),
  };
}

/** Telegram sends this header on every webhook delivery when a secret is registered. */
export function verifyWebhookSecret(request: Request, secret: string): void {
  if (!secret || secret.length < 16) fail('BOT_NOT_CONFIGURED', 'Webhook secret не настроен.', 503);
  const presented = request.headers.get('x-telegram-bot-api-secret-token') || '';
  if (!safeEqual(presented, secret)) fail('WEBHOOK_DENIED', 'Источник обновления не подтверждён.', 401);
}

/** HTML escaping for `parse_mode: 'HTML'`; user text is never interpolated raw. */
export function escapeHtml(value: string): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export type InlineButton = { text: string; callback_data?: string; url?: string; web_app?: { url: string }; pay?: boolean };

export class TelegramApi {
  token: string;
  base: string;
  fileBase: string;
  fetchImpl: typeof fetch;

  constructor(token: string, options: { fetchImpl?: typeof fetch; base?: string } = {}) {
    if (!token) fail('BOT_NOT_CONFIGURED', 'Бот не настроен на сервере.', 503);
    this.token = token;
    this.base = `${options.base || 'https://api.telegram.org'}/bot${token}`;
    this.fileBase = `${options.base || 'https://api.telegram.org'}/file/bot${token}`;
    this.fetchImpl = options.fetchImpl || fetch;
  }

  async call(method: string, payload: Record<string, unknown> = {}, { timeoutMs = 15000 }: { timeoutMs?: number } = {}): Promise<any> {
    const response = await this.fetchImpl(`${this.base}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let body: any = null;
    try { body = await response.json(); } catch { /* handled below */ }
    if (!body || body.ok !== true) {
      const description = body?.description || `HTTP ${response.status}`;
      throw new AppError('TELEGRAM_ERROR', `Telegram отклонил запрос: ${description}`, response.status === 429 ? 429 : 502);
    }
    return body.result;
  }

  sendMessage(chatId: number | string, message: string, extra: Record<string, unknown> = {}) {
    return this.call('sendMessage', { chat_id: chatId, text: message, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });
  }

  editMessageText(chatId: number | string, messageId: number, message: string, extra: Record<string, unknown> = {}) {
    return this.call('editMessageText', { chat_id: chatId, message_id: messageId, text: message, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });
  }

  answerCallbackQuery(id: string, extra: Record<string, unknown> = {}) {
    return this.call('answerCallbackQuery', { callback_query_id: id, ...extra });
  }

  answerPreCheckoutQuery(id: string, ok: boolean, errorMessage?: string) {
    return this.call('answerPreCheckoutQuery', { pre_checkout_query_id: id, ok, ...(ok ? {} : { error_message: errorMessage || 'Платёж недоступен.' }) });
  }

  sendChatAction(chatId: number | string, action = 'typing') {
    return this.call('sendChatAction', { chat_id: chatId, action });
  }

  /**
   * Stars invoice. `currency: 'XTR'` with an empty provider token is the
   * documented digital-goods path; `subscription_period` (30 days) turns it into
   * an auto-renewing Star subscription.
   */
  createInvoiceLink(invoice: {
    title: string; description: string; payload: string; amount: number;
    subscriptionPeriod?: number; photoUrl?: string;
  }) {
    return this.call('createInvoiceLink', {
      title: invoice.title,
      description: invoice.description,
      payload: invoice.payload,
      provider_token: '',
      currency: 'XTR',
      prices: [{ label: invoice.title, amount: invoice.amount }],
      ...(invoice.subscriptionPeriod ? { subscription_period: invoice.subscriptionPeriod } : {}),
      ...(invoice.photoUrl ? { photo_url: invoice.photoUrl } : {}),
    });
  }

  refundStarPayment(userId: number, chargeId: string) {
    return this.call('refundStarPayment', { user_id: userId, telegram_payment_charge_id: chargeId });
  }

  editUserStarSubscription(userId: number, chargeId: string, isCanceled: boolean) {
    return this.call('editUserStarSubscription', { user_id: userId, telegram_payment_charge_id: chargeId, is_canceled: isCanceled });
  }

  async getFile(fileId: string) {
    return this.call('getFile', { file_id: text(fileId, 256, { field: 'файл' }) });
  }

  /** Downloads a Telegram-hosted file, refusing anything above `maxBytes`. */
  async downloadFile(filePath: string, maxBytes: number): Promise<Uint8Array> {
    if (typeof filePath !== 'string' || !filePath || filePath.includes('..') || filePath.length > 512)
      fail('VALIDATION', 'Некорректный путь файла.');
    const response = await this.fetchImpl(`${this.fileBase}/${filePath}`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) fail('TELEGRAM_ERROR', 'Не удалось загрузить файл из Telegram.', 502);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > maxBytes) fail('FILE_TOO_LARGE', 'Файл слишком большой.', 413);
    const reader = response.body?.getReader();
    if (!reader) fail('TELEGRAM_ERROR', 'Пустой файл.', 502);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > maxBytes) fail('FILE_TOO_LARGE', 'Файл слишком большой.', 413);
        chunks.push(part.value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const buffer = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
    return buffer;
  }
}

export const keyboard = (rows: InlineButton[][]) => ({ inline_keyboard: rows });
