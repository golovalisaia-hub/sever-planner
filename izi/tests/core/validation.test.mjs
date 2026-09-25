import test from 'node:test';
import assert from 'node:assert/strict';
import {
  strictObject, assertNoForbiddenKeys, text, uuid, day, clock, integer, oneOf, arrayOf, timezone, pagination, errorCode,
} from '../../src/core/validation.ts';

test('strict objects reject unknown and identity fields', () => {
  assert.deepEqual(strictObject({ title: 'x' }, ['title']), { title: 'x' });
  assert.throws(() => strictObject({ title: 'x', extra: 1 }, ['title']), { code: 'UNKNOWN_FIELD', field: 'extra' });
  for (const key of ['account_id', 'accountId', 'user_id', 'telegram_id', 'role', 'entitlement', 'is_admin']) {
    assert.throws(() => strictObject({ [key]: 'x' }, ['title', key]), { code: 'FORBIDDEN_FIELD' }, key);
  }
  assert.throws(() => strictObject([], ['a']), { code: 'VALIDATION' });
  assert.throws(() => strictObject(new Date(), ['a']), { code: 'VALIDATION' });
});

test('forbidden keys are found at any depth', () => {
  assert.throws(() => assertNoForbiddenKeys({ a: [{ b: { account_id: 'x' } }] }), { code: 'FORBIDDEN_FIELD' });
  assert.throws(() => assertNoForbiddenKeys(JSON.parse('{"__proto__": {"role": "owner"}}')), { code: 'FORBIDDEN_FIELD' });
  assert.doesNotThrow(() => assertNoForbiddenKeys({ a: [{ title: 'ok' }] }));
});

test('text: trimmed, bounded, no control characters, single line unless allowed', () => {
  assert.equal(text('  привет  ', { max: 10, field: 't' }), 'привет');
  assert.throws(() => text('', { max: 10, field: 't' }), { code: 'VALIDATION' });
  assert.throws(() => text('a'.repeat(11), { max: 10, field: 't' }), { code: 'VALIDATION' });
  assert.throws(() => text('a\u0000b', { max: 10, field: 't' }), { code: 'VALIDATION' });
  assert.throws(() => text('a\nb', { max: 10, field: 't' }), { code: 'VALIDATION' });
  assert.equal(text('a\nb', { max: 10, field: 't', multiline: true }), 'a\nb');
  assert.throws(() => text(5, { max: 10, field: 't' }), { code: 'VALIDATION' });
});

test('scalar primitives', () => {
  assert.equal(uuid('3fc03172-68d4-4709-aabc-d03a5993d423'), '3fc03172-68d4-4709-aabc-d03a5993d423');
  assert.throws(() => uuid('not-a-uuid'), { code: 'VALIDATION' });
  assert.equal(day('2028-02-29'), '2028-02-29');
  assert.throws(() => day('2026-02-30'), { code: 'VALIDATION' });
  assert.equal(clock('09:05'), '09:05');
  assert.throws(() => clock('9:05'), { code: 'VALIDATION' });
  assert.throws(() => clock('24:00'), { code: 'VALIDATION' });
  assert.equal(integer(5, 1, 10), 5);
  assert.throws(() => integer(5.5, 1, 10), { code: 'VALIDATION' });
  assert.throws(() => integer('5', 1, 10), { code: 'VALIDATION' });
  assert.equal(oneOf('a', ['a', 'b']), 'a');
  assert.throws(() => oneOf('c', ['a', 'b']), { code: 'VALIDATION' });
  assert.deepEqual(arrayOf([1, 2], 3, value => integer(value, 0, 9)), [1, 2]);
  assert.throws(() => arrayOf([1, 2, 3, 4], 3, value => value), { code: 'VALIDATION' });
});

test('timezone: IANA names only (no POSIX offsets or abbreviations)', () => {
  assert.equal(timezone('Europe/Moscow'), 'Europe/Moscow');
  assert.equal(timezone('America/Argentina/Buenos_Aires'), 'America/Argentina/Buenos_Aires');
  for (const bad of ['UTC+3', 'MSK', 'Mars/Olympus', '', 'Europe/Moscow; drop table']) {
    assert.throws(() => timezone(bad), { code: 'INVALID_TIMEZONE' }, bad);
  }
});

test('pagination and machine error codes', () => {
  assert.deepEqual(pagination(undefined), { limit: 20 });
  assert.deepEqual(pagination({ limit: 5 }), { limit: 5 });
  assert.throws(() => pagination({ limit: 500 }), { code: 'VALIDATION' });
  assert.throws(() => pagination({ offset: 5 }), { code: 'UNKNOWN_FIELD' });
  assert.equal(errorCode('TELEGRAM_429'), 'TELEGRAM_429');
  assert.throws(() => errorCode('Ошибка: купить пасту'), { code: 'VALIDATION' });
});
