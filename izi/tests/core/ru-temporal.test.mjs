// D5: time expressions in Russian. Nothing vague becomes an exact time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ruTemporal } from '../../src/locales/ru/temporal.ts';

const time = phrase => {
  const found = ruTemporal.recognizeTimes(phrase);
  assert.equal(found.length, 1, `exactly one time expression in «${phrase}», got ${JSON.stringify(found)}`);
  return found[0];
};
const exact = (phrase, expected) => {
  const { spec } = time(phrase);
  assert.deepEqual(spec, { kind: 'exact', time: expected }, phrase);
};
const ambiguous = (phrase, candidates) => {
  const { spec } = time(phrase);
  assert.equal(spec.kind, 'ambiguous', phrase);
  assert.equal(spec.needsClarification, true, phrase);
  assert.deepEqual(spec.candidates, candidates, phrase);
};

test('"вечером" is a part of day with no exact time', () => {
  const { spec, evidence } = time('позвонить маме вечером');
  assert.deepEqual(spec, { kind: 'part_of_day', partOfDay: 'evening' });
  assert.equal(evidence.text, 'вечером');
  assert.equal('time' in spec, false);
});

test('утром / днём / ночью / вечерком are parts of day too', () => {
  assert.deepEqual(time('утром пробежка').spec, { kind: 'part_of_day', partOfDay: 'morning' });
  assert.deepEqual(time('днём созвон').spec, { kind: 'part_of_day', partOfDay: 'afternoon' });
  assert.deepEqual(time('днем созвон').spec, { kind: 'part_of_day', partOfDay: 'afternoon' });
  assert.deepEqual(time('ночью сделать бэкап').spec, { kind: 'part_of_day', partOfDay: 'night' });
  assert.deepEqual(time('вечерком английский').spec, { kind: 'part_of_day', partOfDay: 'evening' });
});

test('"в 4" is ambiguous between 04:00 and 16:00 and needs clarification', () => {
  ambiguous('встреча в 4', ['04:00', '16:00']);
  ambiguous('в 4 часа созвон', ['04:00', '16:00']);
  ambiguous('в четыре позвонить', ['04:00', '16:00']);
  ambiguous('в 12', ['00:00', '12:00']);
});

test('"в 4 утра" = 04:00, "в 4 дня" = 16:00, "в 4 вечера" = 16:00', () => {
  exact('в 4 утра', '04:00');
  exact('в 4 дня', '16:00');
  exact('в 4 вечера', '16:00');
  exact('в 4 часа дня', '16:00');
  exact('в час дня', '13:00');
  exact('в 11 вечера', '23:00');
  exact('в 12 дня', '12:00');
  exact('в 12 ночи', '00:00');
  exact('в 2 ночи', '02:00');
  exact('в 7:30 утра', '07:30');
});

test('"в 16", "в 16:00", "в 16 часов" = 16:00', () => {
  exact('в 16', '16:00');
  exact('в 16:00', '16:00');
  exact('в 16 часов', '16:00');
  exact('стоматолог в 16.00', '16:00');
  exact('к 18:30', '18:30');
  exact('в полдень', '12:00');
});

test('a single-digit clock is ambiguous, a two-digit 24h clock is not', () => {
  ambiguous('в 9:30', ['09:30', '21:30']);
  exact('в 09:30', '09:30');
  exact('в 10:00', '10:00');
});

test('contradictions are not guessed', () => {
  assert.equal(time('в 16 утра').spec.kind, 'ambiguous');
  assert.equal(time('в 2 вечера').spec.kind, 'ambiguous');
});

test('counts are not clock times', () => {
  assert.deepEqual(ruTemporal.recognizeTimes('в 2 раза больше'), []);
  assert.deepEqual(ruTemporal.recognizeTimes('к 25 сентября'), []);
  assert.deepEqual(ruTemporal.recognizeTimes('купить 4 яблока'), []);
  assert.deepEqual(ruTemporal.recognizeTimes('потом как-нибудь позже'), []);
});

test('evidence offsets point at the original words', () => {
  const phrase = 'Завтра стоматолог в 16:00, вечером английский';
  const found = ruTemporal.recognizeTimes(phrase);
  assert.equal(found.length, 2);
  for (const { evidence } of found) assert.equal(phrase.slice(evidence.start, evidence.end), evidence.text);
  assert.deepEqual(found.map(f => f.spec.kind), ['exact', 'part_of_day']);
});

// ----------------------------------------------------------------- dates ---

const date = phrase => {
  const found = ruTemporal.recognizeDates(phrase);
  assert.equal(found.length, 1, `exactly one date expression in «${phrase}», got ${JSON.stringify(found)}`);
  return found[0];
};

test('relative days and weekdays', () => {
  assert.deepEqual(date('завтра к врачу').ref, { kind: 'token', token: 'tomorrow' });
  assert.deepEqual(date('послезавтра').ref, { kind: 'token', token: 'day_after_tomorrow' });
  assert.deepEqual(date('в пятницу').ref, { kind: 'token', token: 'this_friday' });
  assert.deepEqual(date('во вторник').ref, { kind: 'token', token: 'this_tuesday' });
  assert.deepEqual(date('в следующую пятницу').ref, { kind: 'token', token: 'next_friday' });
  assert.deepEqual(date('через 3 дня').ref, { kind: 'token', token: 'in_3_days' });
  assert.equal(date('в пятницу').role, 'plan');
});

test('"до пятницы" / "к пятнице" is a deadline, not a planned date', () => {
  for (const phrase of ['оплатить интернет до пятницы', 'сдать отчёт к пятнице', 'не позже пятницы']) {
    const found = date(phrase);
    assert.equal(found.role, 'deadline', phrase);
    assert.deepEqual(found.ref, { kind: 'token', token: 'this_friday' }, phrase);
  }
});

test('"на следующей неделе" is a week token, "до конца недели" a week deadline', () => {
  assert.deepEqual(date('на следующей неделе').ref, { kind: 'token', token: 'next_week' });
  assert.deepEqual(date('на этой неделе').ref, { kind: 'token', token: 'this_week' });
  const end = date('до конца недели');
  assert.equal(end.role, 'deadline');
  assert.deepEqual(end.ref, { kind: 'token', token: 'this_week' });
  assert.deepEqual(date('в следующем месяце').ref, { kind: 'token', token: 'next_month' });
});

test('explicit calendar dates', () => {
  assert.deepEqual(date('25 сентября').ref, { kind: 'absolute', day: 25, month: 9, year: null });
  assert.deepEqual(date('25 сентября 2027').ref, { kind: 'absolute', day: 25, month: 9, year: 2027 });
  assert.deepEqual(date('25.09.2026').ref, { kind: 'absolute', day: 25, month: 9, year: 2026 });
  assert.deepEqual(date('2026-10-01').ref, { kind: 'absolute', year: 2026, month: 10, day: 1 });
  const deadline = date('до 1 октября');
  assert.equal(deadline.role, 'deadline');
});

test('vague words are not dates', () => {
  for (const phrase of ['потом', 'как-нибудь', 'позже', 'когда-нибудь', 'в 16.00']) {
    assert.deepEqual(ruTemporal.recognizeDates(phrase), [], phrase);
  }
});
