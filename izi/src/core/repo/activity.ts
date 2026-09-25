import { requireContext, type AccountContext } from '../context.ts';
import type { Db, Row } from '../db.ts';
import { oneOf, pagination, uuid } from '../validation.ts';
import { ENTITY_TYPES } from '../../modules/types.ts';
import { rows } from './sql.ts';

const COLUMNS = 'id, occurred_at, local_date::text as local_date, local_hour, actor, channel, entity_type, entity_id, action, changed_fields, before_state, after_state, pending_action_id, correlation_id, undo_of, payload_redacted_at';

/** Read-only view of the append-only activity log. */
export class ActivityRepo {
  readonly db: Db;
  constructor(db: Db) { this.db = db; }

  async forEntity(context: AccountContext, entity: unknown, id: unknown, page?: unknown): Promise<Row[]> {
    const ctx = requireContext(context);
    const { limit } = pagination(page);
    return rows(this.db, `select ${COLUMNS} from izi.activity_log
      where account_id = $1 and entity_type = $2 and entity_id = $3 order by id desc limit $4`,
      [ctx.accountId, oneOf(entity, ENTITY_TYPES, 'entity'), uuid(id), limit]);
  }

  async forAction(context: AccountContext, actionId: unknown): Promise<Row[]> {
    const ctx = requireContext(context);
    return rows(this.db, `select ${COLUMNS} from izi.activity_log
      where account_id = $1 and pending_action_id = $2 order by id`, [ctx.accountId, uuid(actionId)]);
  }

  async recent(context: AccountContext, page?: unknown): Promise<Row[]> {
    const ctx = requireContext(context);
    const { limit } = pagination(page);
    return rows(this.db, `select ${COLUMNS} from izi.activity_log where account_id = $1 order by occurred_at desc, id desc limit $2`,
      [ctx.accountId, limit]);
  }
}
