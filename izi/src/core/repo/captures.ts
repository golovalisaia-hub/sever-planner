// User input. Raw text is kept at most 30 days (D4); the database enforces the
// bound and izi.purge_expired_raw_text removes it without breaking anything.

import { requireContext, type AccountContext } from '../context.ts';
import type { Db, Row } from '../db.ts';
import { fail } from '../errors.ts';
import { errorCode, oneOf, strictObject, text, uuid } from '../validation.ts';
import { maybeOne, one } from './sql.ts';

export const CAPTURE_SOURCES = ['telegram_text', 'telegram_voice', 'miniapp_text', 'quick_capture', 'image'] as const;
export const CAPTURE_STATUSES = ['pending', 'processing', 'needs_clarification', 'preview', 'confirmed', 'discarded', 'failed', 'expired'] as const;
export const RAW_TEXT_KINDS = ['typed', 'transcript', 'caption'] as const;
export type CaptureStatus = typeof CAPTURE_STATUSES[number];

const COLUMNS = 'id, source, external_ref, status, raw_text, raw_text_kind, raw_text_length, raw_text_expires_at, raw_text_purged_at, attempt_count, error_code, version, created_at, updated_at';

export class CaptureRepo {
  readonly db: Db;
  constructor(db: Db) { this.db = db; }

  /** Idempotent per (source, external_ref): a redelivered input returns the existing capture. */
  async create(context: AccountContext, raw: unknown): Promise<Row> {
    const ctx = requireContext(context);
    const input = strictObject(raw, ['source', 'externalRef', 'rawText', 'rawTextKind'], 'capture');
    const source = oneOf(input.source, CAPTURE_SOURCES, 'source');
    const externalRef = input.externalRef === undefined || input.externalRef === null ? null
      : text(input.externalRef, { max: 128, field: 'externalRef' });
    if (externalRef !== null && !/^[A-Za-z0-9:_.-]{1,128}$/.test(externalRef)) fail('VALIDATION', 'externalRef');
    const rawText = input.rawText === undefined || input.rawText === null ? null
      : text(input.rawText, { max: 8000, field: 'rawText', multiline: true });
    const rawTextKind = rawText === null ? null : oneOf(input.rawTextKind ?? 'typed', RAW_TEXT_KINDS, 'rawTextKind');

    const created = await maybeOne(this.db,
      `insert into izi.captures (account_id, source, external_ref, raw_text, raw_text_kind) values ($1, $2, $3, $4, $5)
       on conflict (account_id, source, external_ref) do nothing returning ${COLUMNS}`,
      [ctx.accountId, source, externalRef, rawText, rawTextKind]);
    if (created) return created;
    return one(this.db, `select ${COLUMNS} from izi.captures where account_id = $1 and source = $2 and external_ref = $3`,
      [ctx.accountId, source, externalRef]);
  }

  async get(context: AccountContext, id: unknown): Promise<Row | null> {
    const ctx = requireContext(context);
    return maybeOne(this.db, `select ${COLUMNS} from izi.captures where account_id = $1 and id = $2`, [ctx.accountId, uuid(id)]);
  }

  /**
   * Compare-and-set state change. The database enforces the allowed
   * transitions; a stale `from` yields INVALID_STATE instead of a silent overwrite.
   */
  async transition(context: AccountContext, id: unknown, from: unknown, to: unknown, code?: unknown): Promise<Row> {
    const ctx = requireContext(context);
    const captureId = uuid(id);
    const fromStatus = oneOf(from, CAPTURE_STATUSES, 'from');
    const toStatus = oneOf(to, CAPTURE_STATUSES, 'to');
    const error = code === undefined || code === null ? null : errorCode(code);
    const row = await maybeOne(this.db,
      `update izi.captures set status = $4, error_code = $5 where account_id = $1 and id = $2 and status = $3 returning ${COLUMNS}`,
      [ctx.accountId, captureId, fromStatus, toStatus, error]);
    if (row) return row;
    if (!(await this.get(ctx, captureId))) fail('NOT_FOUND');
    return fail('INVALID_STATE');
  }
}
