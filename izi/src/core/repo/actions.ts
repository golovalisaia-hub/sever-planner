// Preview -> Confirm -> Apply.
//
// propose() stores exactly what the user will see; confirm() applies the
// selected operations in one database transaction (izi.apply_pending_action);
// undo() reverts them if nothing changed since. Records are never written any
// other way, so every change has an activity-log entry.

import { requireContext, type AccountContext } from '../context.ts';
import type { Db, Row } from '../db.ts';
import { fail } from '../errors.ts';
import { integer, oneOf, strictObject, text, uuid } from '../validation.ts';
import { validateOperations, validateSelection, type Operation } from '../actions/operations.ts';
import { RECORD_CHANNELS } from '../../modules/types.ts';
import { maybeOne, one } from './sql.ts';

export const ACTION_KINDS = ['capture', 'mutation', 'conversion'] as const;

/** Default preview lifetime: a capture draft may wait a day, a bulk change only half an hour. */
const DEFAULT_TTL_SECONDS = { capture: 24 * 3600, mutation: 30 * 60, conversion: 30 * 60 } as const;
const MAX_TTL_SECONDS = 7 * 24 * 3600;

const COLUMNS = 'id, kind, channel, capture_id, status, short_token, operations, selected, result, expires_at, undo_window, applied_at, undo_until, discarded_at, undone_at, version, created_at, updated_at';

/** Key-order-independent JSON, because jsonb does not preserve key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export type ProposedAction = { id: string; shortToken: string; status: string; expiresAt: string; operations: Operation[] };

export class ActionRepo {
  readonly db: Db;
  constructor(db: Db) { this.db = db; }

  async propose(context: AccountContext, raw: unknown): Promise<ProposedAction> {
    const ctx = requireContext(context);
    const input = strictObject(raw, ['kind', 'channel', 'captureId', 'operations', 'idempotencyKey', 'ttlSeconds', 'undoWindowMinutes'], 'action');
    const kind = oneOf(input.kind, ACTION_KINDS, 'kind');
    const channel = oneOf(input.channel, RECORD_CHANNELS, 'channel');
    const captureId = input.captureId === undefined || input.captureId === null ? null : uuid(input.captureId, 'captureId');
    if (kind === 'capture' && !captureId) fail('VALIDATION', 'captureId');
    const operations = validateOperations(input.operations);
    const idempotencyKey = input.idempotencyKey === undefined ? null : text(input.idempotencyKey, { max: 128, field: 'idempotencyKey' });
    if (idempotencyKey !== null && !/^[A-Za-z0-9:_.-]{1,128}$/.test(idempotencyKey)) fail('VALIDATION', 'idempotencyKey');
    const ttl = input.ttlSeconds === undefined ? DEFAULT_TTL_SECONDS[kind] : integer(input.ttlSeconds, 60, MAX_TTL_SECONDS, 'ttlSeconds');
    const undoMinutes = input.undoWindowMinutes === undefined ? 10 : integer(input.undoWindowMinutes, 10, 1440, 'undoWindowMinutes');
    const serialized = JSON.stringify(operations);

    const row = await maybeOne<Row>(this.db,
      `insert into izi.pending_actions (account_id, kind, channel, capture_id, operations, idempotency_key, expires_at, undo_window)
       values ($1, $2, $3, $4, $5::jsonb, $6, now() + make_interval(secs => $7), make_interval(mins => $8))
       on conflict (account_id, idempotency_key) do nothing
       returning ${COLUMNS}`,
      [ctx.accountId, kind, channel, captureId, serialized, idempotencyKey, ttl, undoMinutes]);
    const stored = row ?? await one<Row>(this.db,
      `select ${COLUMNS} from izi.pending_actions where account_id = $1 and idempotency_key = $2`, [ctx.accountId, idempotencyKey]);
    // Same key, different content: a client bug or a replay attempt, never a silent merge.
    if (!row && canonical(stored.operations) !== canonical(operations)) fail('DUPLICATE', 'idempotencyKey');
    return {
      id: String(stored.id), shortToken: String(stored.short_token), status: String(stored.status),
      expiresAt: new Date(stored.expires_at as string).toISOString(), operations: stored.operations as Operation[],
    };
  }

  async get(context: AccountContext, id: unknown): Promise<Row | null> {
    const ctx = requireContext(context);
    return maybeOne(this.db, `select ${COLUMNS} from izi.pending_actions where account_id = $1 and id = $2`, [ctx.accountId, uuid(id)]);
  }

  /** Resolves a chat-button token, scoped to the caller's account. */
  async getByShortToken(context: AccountContext, token: unknown): Promise<Row | null> {
    const ctx = requireContext(context);
    if (typeof token !== 'string' || !/^[0-9a-f]{32}$/.test(token)) fail('VALIDATION', 'token');
    return maybeOne(this.db, `select ${COLUMNS} from izi.pending_actions where account_id = $1 and short_token = $2`, [ctx.accountId, token]);
  }

  /** Applies all (or the selected) operations atomically. Repeating returns the first result. */
  async confirm(context: AccountContext, id: unknown, selection?: unknown): Promise<Row> {
    const ctx = requireContext(context);
    const actionId = uuid(id);
    const current = await this.get(ctx, actionId);
    if (!current) fail('NOT_FOUND');
    const selected = validateSelection(selection, (current!.operations as unknown[]).length);
    const row = await one<{ result: Row }>(this.db, 'select izi.apply_pending_action($1, $2, $3::integer[]) as result',
      [ctx.accountId, actionId, selected]);
    return row.result;
  }

  async discard(context: AccountContext, id: unknown): Promise<string> {
    const ctx = requireContext(context);
    const row = await one<{ status: string }>(this.db, 'select izi.discard_pending_action($1, $2) as status', [ctx.accountId, uuid(id)]);
    return row.status;
  }

  async undo(context: AccountContext, id: unknown): Promise<Row> {
    const ctx = requireContext(context);
    const row = await one<{ result: Row }>(this.db, 'select izi.undo_pending_action($1, $2) as result', [ctx.accountId, uuid(id)]);
    return row.result;
  }
}
