// Accounting for AI calls (used from Phase 6). Stores costs and outcomes only:
// there is intentionally no parameter for prompts, phrases or model output.

import { requireContext, type AccountContext } from '../context.ts';
import type { Db, Row } from '../db.ts';
import { fail } from '../errors.ts';
import { day, errorCode, integer, number, oneOf, strictObject, uuid } from '../validation.ts';
import { one } from './sql.ts';

const NAME = /^[a-z0-9_.-]{1,40}$/;
const MODEL = /^[A-Za-z0-9_.:/-]{1,100}$/;
const KEY = /^[A-Za-z0-9:_.-]{1,128}$/;

function pattern(value: unknown, re: RegExp, field: string): string {
  if (typeof value !== 'string' || !re.test(value)) fail('VALIDATION', field);
  return value as string;
}

export class AiRunRepo {
  readonly db: Db;
  constructor(db: Db) { this.db = db; }

  /** Idempotent on requestKey: a retried request reuses its run instead of double-counting. */
  async start(context: AccountContext, raw: unknown): Promise<Row> {
    const ctx = requireContext(context);
    const input = strictObject(raw, ['requestKey', 'purpose', 'provider', 'model', 'promptVersion', 'schemaVersion', 'captureId', 'usageDate', 'billable'], 'ai_run');
    const params = [
      ctx.accountId,
      pattern(input.requestKey, KEY, 'requestKey'),
      oneOf(input.purpose, ['interpret', 'transcribe', 'answer', 'vision'] as const, 'purpose'),
      pattern(input.provider, NAME, 'provider'),
      pattern(input.model, MODEL, 'model'),
      input.promptVersion === undefined ? null : pattern(input.promptVersion, NAME, 'promptVersion'),
      input.schemaVersion === undefined ? null : pattern(input.schemaVersion, NAME, 'schemaVersion'),
      input.captureId === undefined ? null : uuid(input.captureId, 'captureId'),
      day(input.usageDate, 'usageDate'),
      input.billable === undefined ? true : input.billable === true,
    ];
    return one(this.db, `insert into izi.ai_runs (account_id, request_key, purpose, provider, model, prompt_version, schema_version, capture_id, usage_date, billable)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      on conflict (account_id, request_key) do update set request_key = excluded.request_key
      returning id, request_key, status, created_at`, params);
  }

  async finish(context: AccountContext, id: unknown, raw: unknown): Promise<Row> {
    const ctx = requireContext(context);
    const input = strictObject(raw, ['status', 'errorCode', 'inputTokens', 'outputTokens', 'audioSeconds', 'latencyMs', 'billable'], 'ai_run');
    return one(this.db, `update izi.ai_runs set status = $3, error_code = $4, input_tokens = $5, output_tokens = $6,
        audio_seconds = $7, latency_ms = $8, billable = coalesce($9, billable), finished_at = now()
      where account_id = $1 and id = $2 and status = 'started' returning id, status`, [
      ctx.accountId, uuid(id),
      oneOf(input.status, ['succeeded', 'failed'] as const, 'status'),
      input.errorCode === undefined ? null : errorCode(input.errorCode),
      input.inputTokens === undefined ? 0 : integer(input.inputTokens, 0, 10_000_000, 'inputTokens'),
      input.outputTokens === undefined ? 0 : integer(input.outputTokens, 0, 10_000_000, 'outputTokens'),
      input.audioSeconds === undefined ? 0 : number(input.audioSeconds, 0, 86400, 'audioSeconds'),
      input.latencyMs === undefined ? 0 : integer(input.latencyMs, 0, 3_600_000, 'latencyMs'),
      input.billable === undefined ? null : input.billable === true,
    ]);
  }
}
