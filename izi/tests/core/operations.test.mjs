import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOperation, validateOperations, validateSelection } from '../../src/core/actions/operations.ts';

const ID = '3fc03172-68d4-4709-aabc-d03a5993d423';

test('create operation keeps only writable fields', () => {
  const op = validateOperation({ op: 'create', entity: 'task', data: { title: ' Оплатить интернет ', due_date: '2026-10-02' } });
  assert.deepEqual(op, { op: 'create', entity: 'task', data: { title: 'Оплатить интернет', due_date: '2026-10-02' } });
});

test('server-owned and identity fields cannot be set by a client', () => {
  const attempts = [
    { account_id: ID }, { accountId: ID }, { user_id: ID }, { role: 'owner' }, { entitlement: 'pro' },
    { telegram_id: 1 }, { version: 7 }, { id: ID }, { completed_at: '2026-01-01T00:00:00Z' }, { reschedule_count: 0 },
    { source: 'import' }, { capture_id: ID }, { deleted_at: null }, { converted_task_id: ID },
  ];
  for (const extra of attempts) {
    assert.throws(() => validateOperation({ op: 'create', entity: 'task', data: { title: 'x', ...extra } }),
      error => ['FORBIDDEN_FIELD', 'UNKNOWN_FIELD'].includes(error.code), JSON.stringify(extra));
  }
  assert.throws(() => validateOperation({ op: 'create', entity: 'task', data: { title: 'x' }, account_id: ID }), { code: 'FORBIDDEN_FIELD' });
});

test('inbox status cannot be set to converted by a plain update', () => {
  assert.throws(() => validateOperation({ op: 'update', entity: 'inbox_item', id: ID, expected_version: 1, patch: { status: 'converted' } }), { code: 'VALIDATION' });
});

test('update/delete/restore/convert require an id and the version the user saw', () => {
  assert.throws(() => validateOperation({ op: 'update', entity: 'task', id: ID, patch: { title: 'x' } }), { code: 'VALIDATION' });
  assert.throws(() => validateOperation({ op: 'delete', entity: 'task', expected_version: 1 }), { code: 'VALIDATION' });
  assert.throws(() => validateOperation({ op: 'update', entity: 'task', id: ID, expected_version: 1, patch: {} }), { code: 'VALIDATION' });
  const convert = validateOperation({ op: 'convert', entity: 'inbox_item', id: ID, expected_version: 2, into: { entity: 'task', data: { title: 'Изучить Playwright' } } });
  assert.equal(convert.into.entity, 'task');
  assert.throws(() => validateOperation({ op: 'convert', entity: 'task', id: ID, expected_version: 1, into: { entity: 'note', data: { body: 'x' } } }), { code: 'VALIDATION' });
});

test('field values are validated by type', () => {
  const bad = [
    { plan_date: '2026-02-30' }, { plan_time: '4pm' }, { part_of_day: 'dusk' }, { duration_minutes: 0 },
    { priority: 'urgent' }, { timezone: 'UTC+3' }, { title: null },
  ];
  for (const data of bad) {
    assert.throws(() => validateOperation({ op: 'create', entity: 'task', data: { title: 'x', ...data } }), error => ['VALIDATION', 'INVALID_TIMEZONE'].includes(error.code), JSON.stringify(data));
  }
});

test('an existing record may appear in only one operation; at most 50 operations', () => {
  const update = { op: 'update', entity: 'task', id: ID, expected_version: 1, patch: { title: 'a' } };
  assert.throws(() => validateOperations([update, { op: 'delete', entity: 'task', id: ID, expected_version: 1 }]), { code: 'VALIDATION' });
  assert.throws(() => validateOperations([]), { code: 'VALIDATION' });
  const many = Array.from({ length: 51 }, () => ({ op: 'create', entity: 'note', data: { body: 'x' } }));
  assert.throws(() => validateOperations(many), { code: 'VALIDATION' });
});

test('selection is a set of valid indices', () => {
  assert.deepEqual(validateSelection([2, 0], 3), [0, 2]);
  assert.equal(validateSelection(undefined, 3), null);
  assert.throws(() => validateSelection([0, 0], 3), { code: 'VALIDATION' });
  assert.throws(() => validateSelection([3], 3), { code: 'VALIDATION' });
  assert.throws(() => validateSelection([], 3), { code: 'VALIDATION' });
});
