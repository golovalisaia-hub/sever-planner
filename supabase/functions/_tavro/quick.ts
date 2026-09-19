// Scoped tokens for phone shortcuts (Apple Shortcuts, Android launcher intents).
//
// A quick token can do exactly one thing: create a capture for the account that
// issued it. It cannot read records, change settings or buy anything, it is
// stored only as a SHA-256 hash, it can be revoked, and it is rate limited. The
// bot token never appears in a user-facing shortcut.

import { checked, fail, text } from '../_shared/validation.ts';

const PREFIX = 'tvq_';

const toHex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');

export async function hashToken(token: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
}

/** Generates a token. The plaintext is returned once and never stored. */
export async function issueQuickToken(db: any, accountId: string, label?: string): Promise<{ token: string; id: string }> {
  const active = checked(await db.from('tavro_quick_tokens').select('id').eq('account_id', accountId).is('revoked_at', null).limit(10));
  if ((active?.length || 0) >= 5) fail('TOO_MANY_TOKENS', 'Уже выдано 5 токенов. Отзовите лишние.', 409);

  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = PREFIX + btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, character => ({ '+': '-', '/': '_', '=': '' }[character] as string));
  const row = checked(await db.from('tavro_quick_tokens').insert({
    account_id: accountId,
    token_hash: await hashToken(token),
    label: label ? text(label, 60, { field: 'название' }) : 'Быстрый ввод',
  }).select('id').single());
  return { token, id: row.id };
}

export async function revokeQuickToken(db: any, accountId: string, id: string): Promise<boolean> {
  const rows = checked(await db.from('tavro_quick_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id).eq('account_id', accountId).is('revoked_at', null).select('id'));
  return Boolean(rows?.length);
}

export async function listQuickTokens(db: any, accountId: string) {
  return checked(await db.from('tavro_quick_tokens')
    .select('id,label,uses,created_at,last_used_at')
    .eq('account_id', accountId).is('revoked_at', null).order('created_at', { ascending: false }).limit(10)) || [];
}

/** Resolves a presented token to its account, or fails. Never leaks which part was wrong. */
export async function accountForQuickToken(db: any, presented: unknown): Promise<string> {
  if (typeof presented !== 'string' || !presented.startsWith(PREFIX) || presented.length > 128)
    fail('AUTH_REQUIRED', 'Нужен токен быстрого ввода.', 401);
  const row = checked(await db.from('tavro_quick_tokens')
    .select('id,account_id,expires_at,revoked_at')
    .eq('token_hash', await hashToken(presented as string)).is('revoked_at', null).maybeSingle());
  if (!row) fail('AUTH_INVALID', 'Токен недействителен или отозван.', 401);
  if (row.expires_at && Date.parse(row.expires_at) < Date.now()) fail('AUTH_EXPIRED', 'Срок токена истёк.', 401);
  await db.from('tavro_quick_tokens').update({ uses: (row.uses || 0) + 1, last_used_at: new Date().toISOString() }).eq('id', row.id);
  return row.account_id;
}
