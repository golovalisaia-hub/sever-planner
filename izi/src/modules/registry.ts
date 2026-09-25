import { fail } from '../core/errors.ts';
import { eventModule } from './events/spec.ts';
import { inboxModule } from './inbox/spec.ts';
import { noteModule } from './notes/spec.ts';
import { taskModule } from './tasks/spec.ts';
import { ENTITY_TYPES, type EntityModule, type EntityType } from './types.ts';

export const MODULES: Readonly<Record<EntityType, EntityModule>> = {
  task: taskModule,
  event: eventModule,
  note: noteModule,
  inbox_item: inboxModule,
};

export function moduleFor(entity: unknown): EntityModule {
  if (typeof entity !== 'string' || !(ENTITY_TYPES as readonly string[]).includes(entity)) fail('VALIDATION', 'entity');
  return MODULES[entity as EntityType];
}

/** Entities an inbox item can become. */
export const CONVERSION_TARGETS = ['task', 'event', 'note'] as const;
