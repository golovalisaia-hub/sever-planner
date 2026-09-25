import { PARTS_OF_DAY, DATE_PRECISIONS } from '../../core/datetime/semantics.ts';
import { COMMON_READ_COLUMNS, type EntityModule } from '../types.ts';

export const TASK_STATUSES = ['open', 'done', 'cancelled'] as const;
export const TASK_PRIORITIES = ['normal', 'high'] as const;

/**
 * A task distinguishes *when it is planned* (plan_date + precision, optional
 * exact time or a part of day) from *when it is due* (due_date/due_time).
 */
export const taskModule: EntityModule = {
  entity: 'task',
  table: 'tasks',
  writable: {
    title: { type: 'text', max: 500, nullable: false },
    notes: { type: 'text', max: 10000, nullable: true, multiline: true },
    status: { type: 'enum', values: TASK_STATUSES, nullable: false },
    priority: { type: 'enum', values: TASK_PRIORITIES, nullable: false },
    plan_date: { type: 'date', nullable: true },
    plan_precision: { type: 'enum', values: DATE_PRECISIONS, nullable: true },
    plan_time: { type: 'time', nullable: true },
    part_of_day: { type: 'enum', values: PARTS_OF_DAY, nullable: true },
    due_date: { type: 'date', nullable: true },
    due_time: { type: 'time', nullable: true },
    duration_minutes: { type: 'int', min: 1, max: 1440, nullable: true },
    timezone: { type: 'timezone', nullable: true },
  },
  requiredOnCreate: ['title'],
  readColumns: [
    ...COMMON_READ_COLUMNS, 'title', 'notes', 'status', 'priority', 'plan_date', 'plan_precision', 'plan_time',
    'part_of_day', 'due_date', 'due_time', 'duration_minutes', 'timezone', 'completed_at', 'reschedule_count',
  ],
};
