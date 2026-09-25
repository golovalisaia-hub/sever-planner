import test from 'node:test';
import assert from 'node:assert/strict';
import { fromDbError, publicError, AppError, ERROR_CODES } from '../../src/core/errors.ts';
import { ruErrors } from '../../src/locales/ru/messages.ts';

test('driver errors never leak SQL, parameters or detail', () => {
  const driverError = Object.assign(new Error('duplicate key value violates unique constraint "x" Key (title)=(Секретная заметка)'), {
    code: '23505', detail: 'Key (title)=(Секретная заметка) already exists.', query: 'insert into izi.notes ...',
    params: ['Секретная заметка'], constraint: 'notes_account_id_key', table: 'notes',
  });
  const error = fromDbError(driverError);
  assert.equal(error.code, 'DUPLICATE');
  const serialized = JSON.stringify({ ...publicError(error), message: error.message, diagnostic: error.diagnostic });
  assert.doesNotMatch(serialized, /Секретная|insert into|Key \(/);
  assert.deepEqual(error.diagnostic, { sqlstate: '23505', constraint: 'notes_account_id_key' });
  assert.equal(error.message, 'DUPLICATE');
});

test('SQLSTATE mapping', () => {
  assert.equal(fromDbError({ code: '23503' }).code, 'INVALID_REFERENCE');
  assert.equal(fromDbError({ code: '23514' }).code, 'VALIDATION');
  assert.equal(fromDbError({ code: 'IZ409', message: 'UNDO_CONFLICT' }).code, 'UNDO_CONFLICT');
  assert.equal(fromDbError({ code: 'IZ409', message: 'something else' }).code, 'VERSION_CONFLICT');
  assert.equal(fromDbError({ code: 'IZ404', message: 'NOT_FOUND' }).status, 404);
  assert.equal(fromDbError({ code: '42501', message: 'permission denied for table tasks' }).code, 'DATABASE_ERROR');
  assert.equal(fromDbError(new Error('connection refused 10.0.0.5:5432')).code, 'DATABASE_ERROR');
  assert.deepEqual(fromDbError({ code: '23505', constraint: 'Robert"); drop' }).diagnostic, { sqlstate: '23505' });
});

test('unknown errors become INTERNAL for clients', () => {
  assert.deepEqual(publicError(new TypeError('x is undefined at /srv/app.ts:10')), { code: 'INTERNAL', status: 500, field: null });
  assert.deepEqual(publicError(new AppError('NOT_FOUND')), { code: 'NOT_FOUND', status: 404, field: null });
});

test('every public error code has a Russian message in the locale catalogue', () => {
  for (const code of ERROR_CODES) assert.equal(typeof ruErrors[code], 'string', code);
});
