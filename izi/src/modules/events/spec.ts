import { PARTS_OF_DAY } from '../../core/datetime/semantics.ts';
import { COMMON_READ_COLUMNS, type EntityModule } from '../types.ts';

export const EVENT_STATUSES = ['planned', 'done', 'cancelled'] as const;

/**
 * An event never receives an invented duration, date or time: each is null
 * until the user states it (fixes TAVRO audit finding T4).
 */
export const eventModule: EntityModule = {
  entity: 'event',
  table: 'events',
  writable: {
    title: { type: 'text', max: 500, nullable: false },
    notes: { type: 'text', max: 10000, nullable: true, multiline: true },
    start_date: { type: 'date', nullable: true },
    start_time: { type: 'time', nullable: true },
    part_of_day: { type: 'enum', values: PARTS_OF_DAY, nullable: true },
    duration_minutes: { type: 'int', min: 1, max: 10080, nullable: true },
    timezone: { type: 'timezone', nullable: true },
    location: { type: 'text', max: 300, nullable: true },
    participants: { type: 'textArray', maxItems: 50, maxLength: 120 },
    status: { type: 'enum', values: EVENT_STATUSES, nullable: false },
  },
  requiredOnCreate: ['title'],
  readColumns: [
    ...COMMON_READ_COLUMNS, 'title', 'notes', 'start_date', 'start_time', 'part_of_day', 'duration_minutes',
    'timezone', 'starts_at', 'location', 'participants', 'status',
  ],
};
