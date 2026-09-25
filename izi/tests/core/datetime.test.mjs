import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveDateToken, resolveAbsolute, taskTemporalFields, eventTemporalFields, isDateToken, deadlineBoundary, exactTime,
} from '../../src/core/datetime/semantics.ts';
import { todayIn, zonedToUtc, weekStart, addDays } from '../../src/core/datetime/calendar.ts';

// 2026-09-25 is a Friday.
const TODAY = '2026-09-25';

test('next_week is a whole week, never one invented day', () => {
  const spec = resolveDateToken('next_week', TODAY);
  assert.deepEqual(spec, { kind: 'week', start: '2026-09-28', end: '2026-10-04' });
  assert.notEqual(spec.kind, 'day');
  assert.deepEqual(resolveDateToken('this_week', TODAY), { kind: 'week', start: '2026-09-21', end: '2026-09-27' });
  assert.deepEqual(resolveDateToken('next_month', TODAY), { kind: 'month', start: '2026-10-01', end: '2026-10-31' });
});

test('relative day tokens resolve against the user\'s today', () => {
  assert.deepEqual(resolveDateToken('tomorrow', TODAY), { kind: 'day', date: '2026-09-26' });
  assert.deepEqual(resolveDateToken('in_3_days', TODAY), { kind: 'day', date: '2026-09-28' });
  assert.deepEqual(resolveDateToken('this_saturday', TODAY), { kind: 'day', date: '2026-09-26' });
  assert.deepEqual(resolveDateToken('next_monday', TODAY), { kind: 'day', date: '2026-09-28' });
  assert.deepEqual(resolveDateToken('next_friday', TODAY), { kind: 'day', date: '2026-10-02' });
});

test('"this friday" said on a Friday is ambiguous, not silently today', () => {
  const spec = resolveDateToken('this_friday', TODAY);
  assert.equal(spec.kind, 'ambiguous');
  assert.deepEqual(spec.candidates, ['2026-09-25', '2026-10-02']);
});

test('unknown tokens are rejected', () => {
  assert.equal(isDateToken('someday'), false);
  assert.equal(isDateToken('in_999_days'), false);
  assert.throws(() => resolveDateToken('someday', TODAY), { code: 'VALIDATION' });
});

test('an explicit date without a year is the next occurrence; impossible dates fail', () => {
  assert.deepEqual(resolveAbsolute({ year: null, month: 9, day: 25 }, TODAY), { kind: 'day', date: '2026-09-25' });
  assert.deepEqual(resolveAbsolute({ year: null, month: 3, day: 1 }, TODAY), { kind: 'day', date: '2027-03-01' });
  assert.throws(() => resolveAbsolute({ year: 2026, month: 2, day: 30 }, TODAY), { code: 'VALIDATION' });
  assert.throws(() => resolveAbsolute({ year: 2099, month: 1, day: 1 }, TODAY), { code: 'VALIDATION' });
});

test('task: planned date and deadline are different fields', () => {
  const planned = taskTemporalFields({ plan: resolveDateToken('next_friday', TODAY) });
  assert.equal(planned.fields.plan_date, '2026-10-02');
  assert.equal(planned.fields.due_date, null);

  const due = taskTemporalFields({ deadline: resolveDateToken('next_friday', TODAY) });
  assert.equal(due.fields.plan_date, null);
  assert.equal(due.fields.due_date, '2026-10-02');
  assert.deepEqual(due.clarifications, []);
});

test('task: part of day never creates an exact time', () => {
  const { fields, clarifications } = taskTemporalFields({ plan: resolveDateToken('tomorrow', TODAY), time: { kind: 'part_of_day', partOfDay: 'evening' } });
  assert.equal(fields.part_of_day, 'evening');
  assert.equal(fields.plan_time, null);
  assert.deepEqual(clarifications, []);
});

test('task: a time without a date is a clarification, not "today"', () => {
  const { fields, clarifications } = taskTemporalFields({ time: exactTime(16) });
  assert.equal(fields.plan_date, null);
  assert.equal(fields.plan_time, null);
  assert.deepEqual(clarifications, ['time_without_date']);
});

test('task: next week keeps week precision; an exact time needs a single day', () => {
  const { fields, clarifications } = taskTemporalFields({ plan: resolveDateToken('next_week', TODAY), time: exactTime(10) });
  assert.equal(fields.plan_date, '2026-09-28');
  assert.equal(fields.plan_precision, 'week');
  assert.equal(fields.plan_time, null);
  assert.deepEqual(clarifications, ['time_needs_single_day']);
});

test('task: ambiguous time asks instead of choosing', () => {
  const { fields, clarifications } = taskTemporalFields({
    plan: resolveDateToken('tomorrow', TODAY),
    time: { kind: 'ambiguous', candidates: ['04:00', '16:00'], needsClarification: true },
  });
  assert.equal(fields.plan_time, null);
  assert.deepEqual(clarifications, ['ambiguous_time']);
});

test('deadline of a period is its last day ("by the end of the week")', () => {
  assert.equal(deadlineBoundary(resolveDateToken('this_week', TODAY)), '2026-09-27');
  assert.equal(taskTemporalFields({ deadline: resolveDateToken('this_week', TODAY) }).fields.due_date, '2026-09-27');
});

test('event: no date, time or duration is invented', () => {
  const empty = eventTemporalFields({});
  assert.deepEqual(empty.fields, { start_date: null, start_time: null, part_of_day: null });
  assert.deepEqual(empty.clarifications, []);
  const vague = eventTemporalFields({ date: resolveDateToken('next_week', TODAY) });
  assert.equal(vague.fields.start_date, null);
  assert.deepEqual(vague.clarifications, ['event_needs_single_day']);
});

test('timezone arithmetic across DST (from TAVRO, kept)', () => {
  assert.equal(zonedToUtc('2026-03-29', '03:30', 'Europe/Berlin'), '2026-03-29T01:30:00.000Z');
  assert.equal(zonedToUtc('2026-09-25', '16:00', 'Europe/Moscow'), '2026-09-25T13:00:00.000Z');
  assert.equal(todayIn('Asia/Vladivostok', Date.parse('2026-09-25T15:30:00Z')), '2026-09-26');
  assert.equal(weekStart('2026-09-27'), '2026-09-21');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});
