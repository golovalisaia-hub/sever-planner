import { COMMON_READ_COLUMNS, type EntityModule } from '../types.ts';

/** Plain notes. No client-side encryption in V1 (SEVER protected notes are not carried over). */
export const noteModule: EntityModule = {
  entity: 'note',
  table: 'notes',
  writable: {
    title: { type: 'text', max: 300, nullable: true },
    body: { type: 'text', max: 20000, nullable: false, multiline: true },
    tags: { type: 'textArray', maxItems: 20, maxLength: 50 },
  },
  requiredOnCreate: ['body'],
  readColumns: [...COMMON_READ_COLUMNS, 'title', 'body', 'tags'],
};
