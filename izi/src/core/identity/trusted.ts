// Verified identities.
//
// An identity is "verified" only when a channel verifier (Telegram webhook
// secret, Telegram initData signature, Supabase Auth session, SEVER import
// session — implemented in later phases) has checked it. Only verifier modules
// may import this file (enforced by tests/security/static.test.mjs); request
// handlers receive a VerifiedIdentity, never a raw provider id.

import { fail } from '../errors.ts';

export const IDENTITY_PROVIDERS = ['telegram', 'email', 'web', 'imported_sever'] as const;
export type IdentityProvider = typeof IDENTITY_PROVIDERS[number];

declare const brand: unique symbol;
export type VerifiedIdentity = Readonly<{ provider: IdentityProvider; subject: string; verifiedBy: string }> & { readonly [brand]: 'VerifiedIdentity' };

const verified = new WeakSet<object>();

const SUBJECT_FORMAT: Record<IdentityProvider, RegExp> = {
  telegram: /^[1-9]\d{0,19}$/,
  email: /^[^@\s]{1,64}@[^@\s]{1,189}$/,
  web: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  imported_sever: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
};

/** Normalised subject: Telegram ids as decimal strings, emails lower-cased. */
export function normalizeSubject(provider: IdentityProvider, subject: unknown): string {
  if (!(IDENTITY_PROVIDERS as readonly string[]).includes(provider)) fail('IDENTITY_UNVERIFIED');
  const value = typeof subject === 'number' && Number.isSafeInteger(subject) ? String(subject)
    : typeof subject === 'string' ? subject.trim() : '';
  const normalized = provider === 'email' ? value.toLowerCase() : value;
  if (!SUBJECT_FORMAT[provider].test(normalized)) fail('IDENTITY_UNVERIFIED');
  return normalized;
}

/** Called by a verifier after it has checked a signature or session. */
export function trustVerifiedIdentity(provider: IdentityProvider, subject: unknown, verifiedBy: string): VerifiedIdentity {
  if (!/^[a-z][a-z0-9_.-]{1,40}$/.test(verifiedBy)) fail('IDENTITY_UNVERIFIED');
  const identity = Object.freeze({ provider, subject: normalizeSubject(provider, subject), verifiedBy }) as VerifiedIdentity;
  verified.add(identity);
  return identity;
}

export function requireVerifiedIdentity(value: unknown): VerifiedIdentity {
  if (!value || typeof value !== 'object' || !verified.has(value)) fail('IDENTITY_UNVERIFIED');
  return value as VerifiedIdentity;
}
