// Account context: proof that the caller's account was resolved from a
// verified identity, not taken from client input.
//
// Contexts are issued only by the account repository (enforced by a static
// test) and recorded in a module-private WeakSet, so an object that merely
// looks like `{ accountId }` is rejected at runtime.

import { fail } from './errors.ts';
import { isUuid } from './validation.ts';

declare const brand: unique symbol;

export type AccountContext = Readonly<{ accountId: string; identityId: string | null }> & { readonly [brand]: 'AccountContext' };

const issued = new WeakSet<object>();

/** Internal: only src/core/repo/accounts.ts may call this. */
export function issueAccountContext(accountId: string, identityId: string | null): AccountContext {
  if (!isUuid(accountId) || (identityId !== null && !isUuid(identityId))) fail('CONTEXT_REQUIRED');
  const context = Object.freeze({ accountId, identityId }) as AccountContext;
  issued.add(context);
  return context;
}

/** Every user-data repository method starts with this. */
export function requireContext(context: unknown): AccountContext {
  if (!context || typeof context !== 'object' || !issued.has(context)) fail('CONTEXT_REQUIRED');
  return context as AccountContext;
}
