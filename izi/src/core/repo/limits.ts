import { requireContext, type AccountContext } from '../context.ts';
import type { Db } from '../db.ts';
import { fail } from '../errors.ts';
import { integer } from '../validation.ts';
import { one } from './sql.ts';

/** Fixed-window limits, always per account and bucket. */
export class RateLimitRepo {
  readonly db: Db;
  constructor(db: Db) { this.db = db; }

  async hit(context: AccountContext, bucket: unknown, limit: unknown, windowSeconds: unknown): Promise<boolean> {
    const ctx = requireContext(context);
    if (typeof bucket !== 'string' || !/^[a-z][a-z0-9_.:-]{0,47}$/.test(bucket)) fail('VALIDATION', 'bucket');
    const row = await one<{ allowed: boolean }>(this.db, 'select izi.rate_limit_hit($1, $2, $3, $4) as allowed',
      [ctx.accountId, bucket, integer(limit, 1, 100000, 'limit'), integer(windowSeconds, 1, 86400, 'window')]);
    return row.allowed;
  }
}
