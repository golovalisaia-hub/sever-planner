// Operations inside a pending action: the typed, validated unit of change that
// a user previews and confirms. Whatever proposed them (a button, a Mini App
// form, later an AI interpretation), they are re-validated here before being
// stored, and re-checked by the database when applied.

import { fail } from '../errors.ts';
import {
  arrayOf, assertNoForbiddenKeys, clock, day, integer, oneOf, strictObject, text, timezone, uuid,
  type PlainObject,
} from '../validation.ts';
import { CONVERSION_TARGETS, moduleFor } from '../../modules/registry.ts';
import type { EntityModule, EntityType, FieldSpec } from '../../modules/types.ts';

export const OPERATION_KINDS = ['create', 'update', 'delete', 'restore', 'convert'] as const;
export type OperationKind = typeof OPERATION_KINDS[number];

export const MAX_OPERATIONS = 50;

export type FieldValues = Record<string, unknown>;

export type Operation =
  | { op: 'create'; entity: EntityType; data: FieldValues }
  | { op: 'update'; entity: EntityType; id: string; expected_version: number; patch: FieldValues }
  | { op: 'delete' | 'restore'; entity: EntityType; id: string; expected_version: number }
  | { op: 'convert'; entity: 'inbox_item'; id: string; expected_version: number; into: { entity: 'task' | 'event' | 'note'; data: FieldValues } };

function fieldValue(name: string, spec: FieldSpec, value: unknown): unknown {
  if (value === null) {
    if (spec.type === 'textArray' || !spec.nullable) fail('VALIDATION', name);
    return null;
  }
  switch (spec.type) {
    case 'text': return text(value, { max: spec.max, field: name, multiline: spec.multiline ?? false });
    case 'enum': return oneOf(value, spec.values, name);
    case 'date': return day(value, name);
    case 'time': return clock(value, name);
    case 'int': return integer(value, spec.min, spec.max, name);
    case 'timezone': return timezone(value, name);
    case 'textArray': return arrayOf(value, spec.maxItems, entry => text(entry, { max: spec.maxLength, field: name }), name);
  }
}

/** Validates field values against a module's writable fields (allow-list). */
export function validateFields(module: EntityModule, raw: unknown, { create }: { create: boolean }): FieldValues {
  const data = strictObject(raw, Object.keys(module.writable), 'data');
  const result: FieldValues = {};
  for (const [name, value] of Object.entries(data)) result[name] = fieldValue(name, module.writable[name]!, value);
  if (create) {
    for (const name of module.requiredOnCreate) if (result[name] === undefined || result[name] === null) fail('VALIDATION', name);
  } else if (Object.keys(result).length === 0) {
    fail('VALIDATION', 'patch');
  }
  return result;
}

const version = (value: unknown) => integer(value, 1, 2_000_000_000, 'expected_version');

export function validateOperation(raw: unknown): Operation {
  assertNoForbiddenKeys(raw);
  const base = strictObject(raw, ['op', 'entity', 'id', 'expected_version', 'data', 'patch', 'into'], 'operation') as PlainObject;
  const op = oneOf(base.op, OPERATION_KINDS, 'op');
  const module = moduleFor(base.entity);
  const allowedByOp: Record<OperationKind, string[]> = {
    create: ['op', 'entity', 'data'],
    update: ['op', 'entity', 'id', 'expected_version', 'patch'],
    delete: ['op', 'entity', 'id', 'expected_version'],
    restore: ['op', 'entity', 'id', 'expected_version'],
    convert: ['op', 'entity', 'id', 'expected_version', 'into'],
  };
  strictObject(base, allowedByOp[op], 'operation');

  if (op === 'create') return { op, entity: module.entity, data: validateFields(module, base.data, { create: true }) };
  const id = uuid(base.id, 'id');
  const expected = version(base.expected_version);
  if (op === 'update') return { op, entity: module.entity, id, expected_version: expected, patch: validateFields(module, base.patch, { create: false }) };
  if (op === 'delete' || op === 'restore') return { op, entity: module.entity, id, expected_version: expected };

  if (module.entity !== 'inbox_item') fail('VALIDATION', 'entity');
  const into = strictObject(base.into, ['entity', 'data'], 'into');
  const target = oneOf(into.entity, CONVERSION_TARGETS, 'into');
  return {
    op: 'convert', entity: 'inbox_item', id, expected_version: expected,
    into: { entity: target, data: validateFields(moduleFor(target), into.data, { create: true }) },
  };
}

/**
 * Validates a whole proposal. An existing record may be touched by at most one
 * operation, so every operation's expected version refers to the state the
 * user saw in the preview.
 */
export function validateOperations(raw: unknown): Operation[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_OPERATIONS) fail('VALIDATION', 'operations');
  const operations = (raw as unknown[]).map(validateOperation);
  const touched = new Set<string>();
  for (const operation of operations) {
    if (operation.op === 'create') continue;
    const key = `${operation.entity}:${operation.id}`;
    if (touched.has(key)) fail('VALIDATION', 'operations');
    touched.add(key);
  }
  return operations;
}

/** Indices of the operations the user kept in the preview. */
export function validateSelection(raw: unknown, operationCount: number): number[] | null {
  if (raw === undefined || raw === null) return null;
  const selection = arrayOf(raw, MAX_OPERATIONS, entry => integer(entry, 0, operationCount - 1, 'selection'), 'selection');
  if (selection.length === 0 || new Set(selection).size !== selection.length) fail('VALIDATION', 'selection');
  return [...selection].sort((a, b) => a - b);
}
