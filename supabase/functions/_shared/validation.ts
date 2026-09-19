// Shared validation primitives for SEVER and TAVRO server code.
// Every value that crosses a trust boundary (Telegram, an AI provider, a Mini App
// client) is narrowed here before it reaches a database write.

export class AppError extends Error {
  code: string; status: number;
  constructor(code: string, message: string, status = 422) { super(message); this.code = code; this.status = status; }
}

export const fail = (code: string, message: string, status = 422): never => { throw new AppError(code, message, status); };

const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype', 'user_id', 'userId', 'account_id', 'accountId', 'role', 'telegram_id', 'telegramId', 'plan', 'entitlement'];

export function object(value: any, message = 'Ожидался объект.'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('VALIDATION', message);
  // Identity and entitlement fields are server-owned: a provider or a client may
  // never supply them, even as an unused extra key.
  if (Object.keys(value).some(key => FORBIDDEN_KEYS.includes(key))) fail('VALIDATION', 'Недопустимое поле.');
  return value;
}

export function text(value: any, max = 160, { empty = false, field = 'текст' }: { empty?: boolean; field?: string } = {}): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) fail('VALIDATION', `Проверьте ${field}.`);
  return (value as string).trim();
}

export function optionalText(value: any, max = 160, field = 'текст'): string | null {
  if (value === null || value === undefined || value === '') return null;
  return text(value, max, { field });
}

export function uuid(value: any): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    fail('VALIDATION', 'Нужен корректный ID.');
  return value as string;
}

export function day(value: any): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
    fail('VALIDATION', 'Нужна корректная дата.');
  return value as string;
}

export function clock(value: any): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail('VALIDATION', 'Нужно время ЧЧ:ММ.');
  return value as string;
}

export function number(value: any, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value)))
    fail('VALIDATION', 'Число вне допустимого диапазона.');
  return value as number;
}

export function integer(value: any, min: number, max: number): number {
  return number(value, min, max, true);
}

export function boolean(value: any, fallback: boolean | null = null): boolean {
  if (typeof value === 'boolean') return value;
  if (fallback !== null && (value === undefined || value === null)) return fallback;
  return fail('VALIDATION', 'Нужен переключатель.');
}

export function oneOf<T extends string>(value: any, allowed: readonly T[], field = 'значение'): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail('VALIDATION', `Недопустимое ${field}.`);
  return value as T;
}

export function list(value: any, max: number, field = 'список'): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail('VALIDATION', `Проверьте ${field}.`);
  return value as unknown[];
}

export function timezone(value: any, fallback = 'Europe/Moscow'): string {
  const name = value === undefined || value === null || value === '' ? fallback : text(value, 64, { field: 'часовой пояс' });
  try { new Intl.DateTimeFormat('sv-SE', { timeZone: name }).format(new Date()); }
  catch { fail('VALIDATION', 'Некорректный часовой пояс.'); }
  return name;
}

/** Narrows a PostgREST result, hiding driver detail from the user-facing message. */
export function checked<T>(result: { data: T; error: unknown }): T {
  if (result.error) fail('DATABASE_ERROR', 'Не удалось сохранить или загрузить данные.', 503);
  return result.data;
}

/** Constant-time comparison for hex/opaque credential strings. */
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}
