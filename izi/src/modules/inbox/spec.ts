import { COMMON_READ_COLUMNS, type EntityModule } from '../types.ts';

export const INBOX_STATUSES = ['unprocessed', 'converted', 'archived'] as const;

/**
 * Inbox is its own entity, not "a task without a date". Conversion to a
 * task/event/note is a dedicated operation (`convert`), so `converted` and the
 * converted_* links are never set through a plain update.
 */
export const inboxModule: EntityModule = {
  entity: 'inbox_item',
  table: 'inbox_items',
  writable: {
    text: { type: 'text', max: 4000, nullable: false, multiline: true },
    status: { type: 'enum', values: ['unprocessed', 'archived'], nullable: false },
  },
  requiredOnCreate: ['text'],
  readColumns: [
    ...COMMON_READ_COLUMNS, 'text', 'status', 'converted_entity', 'converted_task_id', 'converted_event_id',
    'converted_note_id', 'converted_at',
  ],
};
