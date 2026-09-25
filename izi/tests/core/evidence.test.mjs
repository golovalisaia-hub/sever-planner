// Evidence foundation: a claimed value is accepted only if the user's own
// words contain it and the deterministic lexicon reads the same value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifySpan, verifyTimeClaim, verifyDateClaim, parseEvidence } from '../../src/core/evidence.ts';
import { ruTemporal } from '../../src/locales/ru/temporal.ts';

const SOURCE = 'Завтра стоматолог в 16:00, после него купить пасту, вечером английский 30 минут и напомни оплатить интернет до пятницы';

test('span must literally exist at the claimed offsets', () => {
  const start = SOURCE.indexOf('в 16:00');
  assert.equal(verifySpan(SOURCE, { text: 'в 16:00', start, end: start + 7 }).ok, true);
  assert.deepEqual(verifySpan(SOURCE, { text: 'в 16:00', start: start + 1, end: start + 8 }), { ok: false, reason: 'MISMATCH' });
  assert.deepEqual(verifySpan(SOURCE, { text: 'в 18:00', start: null, end: null }), { ok: false, reason: 'NOT_FOUND' });
  assert.deepEqual(verifySpan(SOURCE, { text: 'x', start: 0, end: 9999 }), { ok: false, reason: 'OUT_OF_RANGE' });
  assert.deepEqual(verifySpan('в 4 и в 4', { text: 'в 4', start: null, end: null }), { ok: false, reason: 'AMBIGUOUS_LOCATION' });
});

test('an invented exact time for "вечером" is rejected', () => {
  const start = SOURCE.indexOf('вечером');
  const claim = { value: { kind: 'exact', time: '18:00' }, evidence: { text: 'вечером', start, end: start + 7 } };
  assert.deepEqual(verifyTimeClaim(SOURCE, claim, ruTemporal), { ok: false, reason: 'VALUE_MISMATCH' });
});

test('a time claim without evidence is rejected', () => {
  assert.deepEqual(verifyTimeClaim(SOURCE, { value: { kind: 'exact', time: '16:00' }, evidence: null }, ruTemporal), { ok: false, reason: 'MISSING' });
});

test('a correct claim is accepted and the server reading is returned', () => {
  const start = SOURCE.indexOf('в 16:00');
  const result = verifyTimeClaim(SOURCE, { value: { kind: 'exact', time: '16:00' }, evidence: { text: 'в 16:00', start, end: start + 7 } }, ruTemporal);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { kind: 'exact', time: '16:00' });
});

test('choosing 16:00 for an ambiguous "в 4" is rejected', () => {
  const source = 'созвон в 4';
  const claim = { value: { kind: 'exact', time: '16:00' }, evidence: { text: 'в 4', start: null, end: null } };
  assert.deepEqual(verifyTimeClaim(source, claim, ruTemporal), { ok: false, reason: 'VALUE_AMBIGUOUS' });
});

test('a deadline claimed as a planned date is rejected', () => {
  const claim = { value: { role: 'plan', ref: { kind: 'token', token: 'this_friday' } }, evidence: { text: 'до пятницы', start: null, end: null } };
  assert.deepEqual(verifyDateClaim(SOURCE, claim, ruTemporal, '2026-09-24'), { ok: false, reason: 'VALUE_MISMATCH' });
  const correct = { value: { role: 'deadline', ref: { kind: 'token', token: 'this_friday' } }, evidence: { text: 'до пятницы', start: null, end: null } };
  const result = verifyDateClaim(SOURCE, correct, ruTemporal, '2026-09-24');
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { role: 'deadline', spec: { kind: 'day', date: '2026-09-25' } });
});

test('a model that turns "next week" into a day is rejected', () => {
  const source = 'разобрать гараж на следующей неделе';
  const claim = { value: { role: 'plan', ref: { kind: 'absolute', year: 2026, month: 9, day: 28 } }, evidence: { text: 'на следующей неделе', start: null, end: null } };
  assert.deepEqual(verifyDateClaim(source, claim, ruTemporal, '2026-09-25'), { ok: false, reason: 'VALUE_MISMATCH' });
});

test('evidence shape is strict', () => {
  assert.throws(() => parseEvidence({ text: 'в 4', start: 1 }), { code: 'VALIDATION' });
  assert.throws(() => parseEvidence({ text: 'в 4', confidence: 0.99 }), { code: 'UNKNOWN_FIELD' });
  assert.deepEqual(parseEvidence({ text: 'в 4' }), { text: 'в 4', start: null, end: null });
});
