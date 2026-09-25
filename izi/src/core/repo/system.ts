// System-level repositories: they act on behalf of the service, not of one
// account, and must only be used by server entrypoints (webhook, worker,
// scheduled jobs — later phases), never by request handlers.

import type { Db } from '../db.ts';
import { fail } from '../errors.ts';
import { errorCode, integer, oneOf, uuid } from '../validation.ts';
import { one, rows } from './sql.ts';

const WORKER = /^[A-Za-z0-9:_.-]{1,64}$/;
const worker = (value: unknown) => {
  if (typeof value !== 'string' || !WORKER.test(value)) fail('VALIDATION', 'worker');
  return value as string;
};

export type InboundUpdate = {
  id: string; provider: string; provider_update_id: string; chat_key: string | null; status: string;
  payload: unknown; attempt_count: number; max_attempts: number; account_id: string | null;
};

export class InboundQueue {
  readonly db: Db;
  constructor(db: Db) { this.db = db; }

  /** Durable accept. Returns false for a duplicate delivery (same provider update id). */
  async enqueue(provider: unknown, updateId: unknown, chatKey: unknown, payload: unknown): Promise<boolean> {
    const name = oneOf(provider, ['telegram'] as const, 'provider');
    const id = typeof updateId === 'number' && Number.isSafeInteger(updateId) && updateId >= 0 ? String(updateId) : updateId;
    if (typeof id !== 'string' || !/^[A-Za-z0-9:_.-]{1,64}$/.test(id)) fail('VALIDATION', 'update_id');
    const chat = chatKey === null || chatKey === undefined ? null : String(chatKey);
    if (chat !== null && !/^[A-Za-z0-9:_.-]{1,64}$/.test(chat)) fail('VALIDATION', 'chat_key');
    if (!payload || typeof payload !== 'object') fail('VALIDATION', 'payload');
    const row = await one<{ inserted: boolean }>(this.db, 'select izi.enqueue_inbound_update($1, $2, $3, $4::jsonb) as inserted',
      [name, id, chat, JSON.stringify(payload)]);
    return row.inserted;
  }

  async claim(workerId: unknown, limit: unknown = 10): Promise<InboundUpdate[]> {
    return rows<InboundUpdate>(this.db,
      'select id::text, provider, provider_update_id, chat_key, status, payload, attempt_count, max_attempts, account_id from izi.claim_inbound_updates($1, $2)',
      [worker(workerId), integer(limit, 1, 100, 'limit')]);
  }

  async complete(id: unknown, workerId: unknown, accountId: unknown = null): Promise<boolean> {
    const account = accountId === null ? null : uuid(accountId, 'account');
    const row = await one<{ done: boolean }>(this.db, 'select izi.complete_inbound_update($1::bigint, $2, $3) as done',
      [String(integer(Number(id), 1, Number.MAX_SAFE_INTEGER, 'id')), worker(workerId), account]);
    return row.done;
  }

  /** Error codes only — a message text or exception string is rejected. */
  async fail(id: unknown, workerId: unknown, code: unknown, retryAfterSeconds: unknown = 30): Promise<'retry' | 'dead'> {
    const row = await one<{ status: 'retry' | 'dead' }>(this.db, 'select izi.fail_inbound_update($1::bigint, $2, $3, $4) as status',
      [String(integer(Number(id), 1, Number.MAX_SAFE_INTEGER, 'id')), worker(workerId), errorCode(code), integer(retryAfterSeconds, 1, 86400, 'retry')]);
    return row.status;
  }
}

/** Retention and recovery jobs (to be scheduled with pg_cron in a later phase). */
export class Housekeeping {
  readonly db: Db;
  constructor(db: Db) { this.db = db; }

  private async count(sql: string, params: readonly unknown[] = []): Promise<number> {
    const row = await one<{ n: number }>(this.db, sql, params);
    return Number(row.n);
  }

  purgeExpiredRawText() { return this.count('select izi.purge_expired_raw_text() as n'); }
  purgeInboundUpdates() { return this.count('select izi.purge_inbound_updates() as n'); }
  redactActivityPayloads() { return this.count('select izi.redact_activity_payloads() as n'); }
  expirePendingActions() { return this.count('select izi.expire_pending_actions() as n'); }
  reapStaleCaptures() { return this.count('select izi.reap_stale_captures() as n'); }
  reapStaleInboundUpdates() { return this.count('select izi.reap_stale_inbound_updates() as n'); }
  cleanupRateLimits(before: Date) { return this.count('select izi.cleanup_rate_limits($1) as n', [before.toISOString()]); }
  purgePendingActions(before: Date) { return this.count('select izi.purge_pending_actions($1) as n', [before.toISOString()]); }

}
