// Read access to records. Writes happen only through pending actions
// (ActionRepo.confirm -> izi.apply_pending_action), so every change is logged.

import { requireContext, type AccountContext } from '../context.ts';
import type { Db, Row } from '../db.ts';
import { day, pagination, text, uuid } from '../validation.ts';
import { MODULES } from '../../modules/registry.ts';
import type { EntityModule, EntityType } from '../../modules/types.ts';
import { maybeOne, readList, rows, tableName } from './sql.ts';

class RecordReader {
  readonly db: Db;
  readonly module: EntityModule;
  constructor(db: Db, module: EntityModule) { this.db = db; this.module = module; }

  protected select(): string {
    return `select ${readList(this.module.readColumns)} from ${tableName(this.module.table)}`;
  }

  /** A live record of this account, or null (another account's id reads as null). */
  async get(context: AccountContext, id: unknown): Promise<Row | null> {
    const ctx = requireContext(context);
    return maybeOne(this.db, `${this.select()} where account_id = $1 and id = $2 and deleted_at is null`, [ctx.accountId, uuid(id)]);
  }
}

export class TaskRepo extends RecordReader {
  constructor(db: Db) { super(db, MODULES.task); }

  async listPlannedFor(context: AccountContext, date: unknown): Promise<Row[]> {
    const ctx = requireContext(context);
    return rows(this.db, `${this.select()} where account_id = $1 and deleted_at is null and plan_date = $2
      order by plan_time nulls last, created_at, id`, [ctx.accountId, day(date)]);
  }

  async listDueBy(context: AccountContext, date: unknown, page?: unknown): Promise<Row[]> {
    const ctx = requireContext(context);
    const { limit } = pagination(page);
    return rows(this.db, `${this.select()} where account_id = $1 and deleted_at is null and status = 'open'
      and due_date <= $2 order by due_date, due_time nulls last, id limit $3`, [ctx.accountId, day(date), limit]);
  }

  async listOpen(context: AccountContext, page?: unknown): Promise<Row[]> {
    const ctx = requireContext(context);
    const { limit } = pagination(page);
    return rows(this.db, `${this.select()} where account_id = $1 and deleted_at is null and status = 'open'
      order by updated_at desc, id limit $2`, [ctx.accountId, limit]);
  }
}

export class EventRepo extends RecordReader {
  constructor(db: Db) { super(db, MODULES.event); }

  async listOn(context: AccountContext, date: unknown): Promise<Row[]> {
    const ctx = requireContext(context);
    return rows(this.db, `${this.select()} where account_id = $1 and deleted_at is null and start_date = $2
      order by start_time nulls last, created_at, id`, [ctx.accountId, day(date)]);
  }
}

export class NoteRepo extends RecordReader {
  constructor(db: Db) { super(db, MODULES.note); }

  async recent(context: AccountContext, page?: unknown): Promise<Row[]> {
    const ctx = requireContext(context);
    const { limit } = pagination(page);
    return rows(this.db, `${this.select()} where account_id = $1 and deleted_at is null
      order by updated_at desc, id limit $2`, [ctx.accountId, limit]);
  }

  /** Full-text search (PostgreSQL `russian` configuration), always account-scoped. */
  async search(context: AccountContext, query: unknown, page?: unknown): Promise<Row[]> {
    const ctx = requireContext(context);
    const { limit } = pagination(page);
    const terms = text(query, { max: 200, field: 'query' });
    return rows(this.db, `${this.select()} where account_id = $1 and deleted_at is null
      and search_vector @@ websearch_to_tsquery('russian', $2)
      order by ts_rank(search_vector, websearch_to_tsquery('russian', $2)) desc, updated_at desc limit $3`,
      [ctx.accountId, terms, limit]);
  }
}

export class InboxRepo extends RecordReader {
  constructor(db: Db) { super(db, MODULES.inbox_item); }

  async listUnprocessed(context: AccountContext, page?: unknown): Promise<Row[]> {
    const ctx = requireContext(context);
    const { limit } = pagination(page);
    return rows(this.db, `${this.select()} where account_id = $1 and deleted_at is null and status = 'unprocessed'
      order by created_at desc, id limit $2`, [ctx.accountId, limit]);
  }
}

export const readersFor = (db: Db): Record<EntityType, RecordReader> => ({
  task: new TaskRepo(db), event: new EventRepo(db), note: new NoteRepo(db), inbox_item: new InboxRepo(db),
});
