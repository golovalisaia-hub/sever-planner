// Validation primitives for every value that crosses a trust boundary
// (a channel adapter, a Mini App request, an AI provider reply).
//
// Adapted from TAVRO `_shared/validation.ts`. Differences:
//  - errors carry codes only (no Russian text in core, see D6);
//  - objects are validated against an explicit allow-list, not only a deny-list;
//  - identity and privilege fields are rejected at any nesting depth.

import { fail } from './errors.ts';

/**
 * Server-owned identity and privilege fields. A client or a model may never
 * supply them, not even as an ignored extra key.
 */
export const FORBIDDEN_KEYS: readonly string[] = [
  '__proto__', 'constructor', 'prototype',
  'account_id', 'accountId', 'user_id', 'userId', 'owner_id', 'ownerId',
  'identity_id', 'identityId', 'provider_subject', 'providerSubject',
  'telegram_id', 'telegramId', 'telegram_user_id', 'telegramUserId', 'chat_id', 'chatId',
  'role', 'roles', 'is_admin', 'isAdmin', 'is_owner', 'isOwner',
  'entitlement', 'entitlements', 'plan_id', 'planId', 'subscription', 'daily_ai_actions', 'dailyAiActions',
];

const MAX_DEPTH = 8;

export type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Rejects forbidden keys anywhere inside a JSON-like value. */
export function assertNoForbiddenKeys(value: unknown, depth = 0): void {
  if (depth > MAX_DEPTH) fail('VALIDATION');
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenKeys(item, depth + 1);
    return;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.includes(key)) fail('FORBIDDEN_FIELD', key);
      assertNoForbiddenKeys((value as PlainObject)[key], depth + 1);
    }
  }
}

/**
 * A plain object whose keys are all in `allowed`. Forbidden identity keys are
 * reported as FORBIDDEN_FIELD even when they are not in the allow-list.
 */
export function strictObject(value: unknown, allowed: readonly string[], field = 'object'): PlainObject {
  if (!isPlainObject(value)) fail('VALIDATION', field);
  const object = value as PlainObject;
  for (const key of Object.keys(object)) {
    if (FORBIDDEN_KEYS.includes(key)) fail('FORBIDDEN_FIELD', key);
    if (!allowed.includes(key)) fail('UNKNOWN_FIELD', key);
  }
  return object;
}

// Control characters other than tab/newline/carriage return; NUL is not storable in Postgres text.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export function text(value: unknown, options: { max: number; min?: number; field: string; multiline?: boolean }): string {
  if (typeof value !== 'string') fail('VALIDATION', options.field);
  const normalized = (value as string).normalize('NFC').trim();
  const min = options.min ?? 1;
  if (normalized.length < min || normalized.length > options.max) fail('VALIDATION', options.field);
  if (CONTROL.test(normalized)) fail('VALIDATION', options.field);
  if (!options.multiline && /[\r\n]/.test(normalized)) fail('VALIDATION', options.field);
  return normalized;
}

export function optionalText(value: unknown, options: { max: number; field: string; multiline?: boolean }): string | null {
  if (value === null || value === undefined) return null;
  return text(value, { ...options, min: 1 });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function uuid(value: unknown, field = 'id'): string {
  if (typeof value !== 'string' || !UUID.test(value)) fail('VALIDATION', field);
  return value as string;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** Real calendar date YYYY-MM-DD (rejects 2026-02-30). */
export function day(value: unknown, field = 'date'): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('VALIDATION', field);
  const parsed = new Date(`${value as string}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail('VALIDATION', field);
  return value as string;
}

/** Wall-clock time HH:MM, 24-hour. */
export function clock(value: unknown, field = 'time'): string {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail('VALIDATION', field);
  return value as string;
}

export function integer(value: unknown, min: number, max: number, field = 'number'): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) fail('VALIDATION', field);
  return value as number;
}

export function number(value: unknown, min: number, max: number, field = 'number'): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail('VALIDATION', field);
  return value as number;
}

export function boolean(value: unknown, field = 'flag'): boolean {
  if (typeof value !== 'boolean') fail('VALIDATION', field);
  return value as boolean;
}

export function oneOf<const T extends readonly string[]>(value: unknown, allowed: T, field = 'value'): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) fail('VALIDATION', field);
  return value as T[number];
}

export function arrayOf<T>(value: unknown, max: number, item: (entry: unknown, index: number) => T, field = 'list'): T[] {
  if (!Array.isArray(value) || value.length > max) fail('VALIDATION', field);
  return (value as unknown[]).map((entry, index) => item(entry, index));
}

/**
 * IANA timezone name, e.g. "Europe/Moscow". Rejects abbreviations and POSIX
 * offsets ("MSK", "UTC+3"), which PostgreSQL would interpret with an inverted sign.
 */
export function timezone(value: unknown, field = 'timezone'): string {
  if (typeof value !== 'string' || value.length > 64 || !/^(UTC|[A-Z][A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2})$/.test(value)) {
    fail('INVALID_TIMEZONE', field);
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value as string }).format(0);
  } catch {
    fail('INVALID_TIMEZONE', field);
  }
  return value as string;
}

export type Page = { limit: number };

export function pagination(value: unknown, { max = 100, fallback = 20 } = {}): Page {
  if (value === undefined || value === null) return { limit: fallback };
  const page = strictObject(value, ['limit'], 'page');
  return { limit: page.limit === undefined ? fallback : integer(page.limit, 1, max, 'limit') };
}

/** Machine error code safe for storage and logs: never user text. */
export function errorCode(value: unknown, field = 'error_code'): string {
  if (typeof value !== 'string' || !/^[A-Z0-9_]{1,64}$/.test(value)) fail('VALIDATION', field);
  return value as string;
}
