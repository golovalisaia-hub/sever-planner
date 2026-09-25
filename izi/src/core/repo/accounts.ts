// Accounts and identities. The only module allowed to issue AccountContext.

import { issueAccountContext, requireContext, type AccountContext } from '../context.ts';
import type { Db } from '../db.ts';
import { fail } from '../errors.ts';
import { requireVerifiedIdentity, type VerifiedIdentity } from '../identity/trusted.ts';
import { integer, oneOf, timezone } from '../validation.ts';
import { maybeOne, one } from './sql.ts';

export type AccountSettings = {
  timezone: string | null;
  timezone_source: 'unknown' | 'client_hint' | 'user';
  version: number;
};

export class AccountRepo {
  readonly db: Db;
  constructor(db: Db) { this.db = db; }

  /** Finds the account behind a verified identity, creating it on first contact. */
  async resolveOrCreate(identity: VerifiedIdentity): Promise<{ context: AccountContext; created: boolean }> {
    const verified = requireVerifiedIdentity(identity);
    const row = await one<{ account_id: string; identity_id: string; created: boolean }>(this.db,
      'select account_id, identity_id, created from izi.resolve_or_create_account($1, $2)',
      [verified.provider, verified.subject]);
    return { context: issueAccountContext(row.account_id, row.identity_id), created: row.created };
  }

  /** Like resolveOrCreate, but never creates: for channels that must not sign users up. */
  async find(identity: VerifiedIdentity): Promise<AccountContext | null> {
    const verified = requireVerifiedIdentity(identity);
    const row = await maybeOne<{ account_id: string; id: string }>(this.db,
      'select account_id, id from izi.identities where provider = $1 and subject = $2',
      [verified.provider, verified.subject]);
    return row ? issueAccountContext(row.account_id, row.id) : null;
  }

  /** Attaches another verified identity. Fails with IDENTITY_TAKEN if it belongs to someone else. */
  async linkIdentity(context: AccountContext, identity: VerifiedIdentity): Promise<string> {
    const ctx = requireContext(context);
    const verified = requireVerifiedIdentity(identity);
    const row = await one<{ link_identity: string }>(this.db, 'select izi.link_identity($1, $2, $3)',
      [ctx.accountId, verified.provider, verified.subject]);
    return row.link_identity;
  }

  async settings(context: AccountContext): Promise<AccountSettings> {
    const ctx = requireContext(context);
    return one<AccountSettings>(this.db,
      'select timezone, timezone_source, version from izi.account_settings where account_id = $1', [ctx.accountId]);
  }

  /**
   * A client hint (e.g. the Mini App's Intl timezone) never overrides a
   * timezone the user confirmed themselves.
   */
  async setTimezone(context: AccountContext, value: unknown, source: 'client_hint' | 'user'): Promise<AccountSettings> {
    const ctx = requireContext(context);
    const zone = timezone(value);
    const kind = oneOf(source, ['client_hint', 'user'] as const, 'timezone_source');
    const row = await maybeOne<AccountSettings>(this.db,
      `update izi.account_settings set timezone = $2, timezone_source = $3
        where account_id = $1 and not (timezone_source = 'user' and $3 = 'client_hint')
        returning timezone, timezone_source, version`,
      [ctx.accountId, zone, kind]);
    return row ?? this.settings(ctx);
  }

  /** Registers the private chat of the account's own Telegram identity. */
  async registerTelegramChat(context: AccountContext, chatId: unknown): Promise<void> {
    const ctx = requireContext(context);
    const id = integer(chatId, 1, Number.MAX_SAFE_INTEGER, 'chat');
    const row = await maybeOne(this.db,
      `insert into izi.telegram_chats (account_id, chat_id) values ($1, $2)
       on conflict (chat_id) do update set updated_at = now() where izi.telegram_chats.account_id = excluded.account_id
       returning id`,
      [ctx.accountId, id]);
    if (!row) fail('IDENTITY_TAKEN');
  }

  /** Hard delete of the account and everything it owns (cascade). */
  async deleteAccount(context: AccountContext): Promise<void> {
    const ctx = requireContext(context);
    await one(this.db, 'delete from izi.accounts where id = $1 returning id', [ctx.accountId]);
  }
}
