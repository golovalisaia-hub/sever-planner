// Russian temporal lexicon (D5, D6).
//
// Deterministic, no AI. Recognises what a Russian speaker said about time and
// date and reports it with the exact span it came from. Product rules encoded
// here (each is covered by tests):
//   - "утром/днём/вечером/ночью" are parts of day, never an exact time;
//   - "в 4" is ambiguous (04:00 or 16:00) and needs clarification;
//   - "в 4 утра" = 04:00, "в 4 дня" = 16:00, "в 4 вечера" = 16:00;
//   - "в 16", "в 16:00", "в 16 часов" = 16:00 (an hour of 13..23 is unambiguous);
//   - a clock with a single-digit hour ("в 9:30") is ambiguous; "09:30" is not;
//   - "до/к пятнице" is a deadline, "в пятницу" is a planned date;
//   - "на следующей неделе" is a week, not a day.

import type { DateRecognition, TemporalLexicon, TimeRecognition } from '../../core/datetime/lexicon.ts';
import type { DateRef, DateRole, PartOfDay, TimeSpec } from '../../core/datetime/semantics.ts';
import { WEEKDAYS, ambiguousTime, exactTime } from '../../core/datetime/semantics.ts';

const L = '(?<![\\p{L}\\p{N}])';
const R = '(?![\\p{L}\\p{N}])';

const HOUR_WORDS: Record<string, number> = {
  'час': 1, 'один': 1, 'два': 2, 'три': 3, 'четыре': 4, 'пять': 5, 'шесть': 6,
  'семь': 7, 'восемь': 8, 'девять': 9, 'десять': 10, 'одиннадцать': 11, 'двенадцать': 12,
};
const HOUR_WORD_ALT = Object.keys(HOUR_WORDS).sort((a, b) => b.length - a.length).join('|');
const HOURS_SUFFIX = '(?:\\s*(?:часа|часов|час|ч\\.?))?';

const QUALIFIERS = ['утра', 'дня', 'вечера', 'ночи'] as const;
type Qualifier = typeof QUALIFIERS[number];

const PART_OF_DAY_WORDS: Record<string, PartOfDay> = {
  'с утра': 'morning', 'утречком': 'morning', 'утром': 'morning',
  'днём': 'afternoon', 'днем': 'afternoon', 'после обеда': 'afternoon',
  'вечерком': 'evening', 'вечером': 'evening',
  'ночью': 'night',
};

// Nouns that turn "в 4 …" into a count, not a clock ("в 2 раза", "к 25 сентября").
const NOT_A_CLOCK = '(?!\\s*[:.]\\d)(?!\\s+(?:раз|январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр|числ|минут|мин|сек|дн|день|недел|месяц|год|лет|процент|руб|шт|этаж|класс|утра|дня|вечера|ночи)[\\p{L}]*)';

type Match = { start: number; end: number; text: string };
type Candidate<T> = Match & { value: T };

function findAll(pattern: RegExp, text: string): RegExpExecArray[] {
  const results: RegExpExecArray[] = [];
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    results.push(match);
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
  return results;
}

/** Keeps earlier and, at the same position, longer matches; drops overlaps. */
function nonOverlapping<T>(candidates: Candidate<T>[]): Candidate<T>[] {
  const sorted = [...candidates].sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const kept: Candidate<T>[] = [];
  for (const candidate of sorted) {
    if (kept.some(existing => candidate.start < existing.end && existing.start < candidate.end)) continue;
    kept.push(candidate);
  }
  return kept;
}

function hourValue(raw: string): { hour: number; leadingZero: boolean } | null {
  const lowered = raw.toLowerCase();
  if (lowered in HOUR_WORDS) return { hour: HOUR_WORDS[lowered]!, leadingZero: false };
  if (!/^\d{1,2}$/.test(raw)) return null;
  const hour = Number(raw);
  return hour <= 23 ? { hour, leadingZero: raw.length === 2 && raw.startsWith('0') } : null;
}

const hhmm = (hour: number, minute: number) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

/** 12-hour reading of an hour 1..12: the two wall clocks it could mean. */
function twelveHourCandidates(hour: number, minute: number): string[] {
  return hour === 12 ? [hhmm(0, minute), hhmm(12, minute)] : [hhmm(hour, minute), hhmm(hour + 12, minute)];
}

/** Applies "утра/дня/вечера/ночи"; contradictory combinations are not guessed. */
function qualify(hour: number, minute: number, qualifier: Qualifier): TimeSpec {
  const contradictory = () => ambiguousTime(hour >= 13 ? [hhmm(hour, minute)] : twelveHourCandidates(hour, minute));
  if (hour >= 13) {
    const ok = (qualifier === 'дня' && hour <= 17) || (qualifier === 'вечера' && hour >= 16) || (qualifier === 'ночи' && hour >= 21);
    return ok ? exactTime(hour, minute) : contradictory();
  }
  if (hour === 0) return qualifier === 'ночи' ? exactTime(0, minute) : contradictory();
  switch (qualifier) {
    case 'утра':
      return hour <= 11 ? exactTime(hour, minute) : contradictory();
    case 'дня':
      if (hour === 12) return exactTime(12, minute);
      return hour <= 5 ? exactTime(hour + 12, minute) : contradictory();
    case 'вечера':
      return hour >= 4 && hour <= 11 ? exactTime(hour + 12, minute) : contradictory();
    case 'ночи':
      if (hour === 12) return exactTime(0, minute);
      if (hour <= 5) return exactTime(hour, minute);
      return hour >= 9 ? exactTime(hour + 12, minute) : contradictory();
  }
}

/** A bare hour or a clock without "утра/вечера": 24-hour when unambiguous, otherwise not guessed. */
function unqualified(hourText: string, minute: number, hasClock: boolean): TimeSpec | null {
  const parsed = hourValue(hourText);
  if (!parsed) return null;
  const { hour, leadingZero } = parsed;
  if (hour >= 13 || hour === 0 || leadingZero) return exactTime(hour, minute);
  // Two-digit clock notation "10:30"/"12:00" is read as a 24-hour clock.
  if (hasClock && hourText.length === 2) return exactTime(hour, minute);
  return ambiguousTime(twelveHourCandidates(hour, minute));
}

const QUALIFIED = new RegExp(
  `${L}(?:(?:в|к|около|на)\\s+)?(\\d{1,2}|${HOUR_WORD_ALT})(?:[:.](\\d{2}))?${HOURS_SUFFIX}\\s+(${QUALIFIERS.join('|')})${R}`,
  'giu',
);
const CLOCK = new RegExp(`${L}(?:(?:в|к|около|с|до|на)\\s+)?(\\d{1,2}):([0-5]\\d)${R}`, 'giu');
const DOTTED_CLOCK = new RegExp(`${L}(?:в|к|около)\\s+(\\d{1,2})\\.([0-5]\\d)${R}`, 'giu');
const BARE_HOUR = new RegExp(`${L}(?:в|к|около)\\s+(\\d{1,2}|${HOUR_WORD_ALT})${HOURS_SUFFIX}${R}${NOT_A_CLOCK}`, 'giu');
const NOON = new RegExp(`${L}(?:(?:в|к|около)\\s+)?(полдень|полночь)${R}`, 'giu');
const PART_OF_DAY = new RegExp(
  `${L}(${Object.keys(PART_OF_DAY_WORDS).sort((a, b) => b.length - a.length).map(word => word.replace(' ', '\\s+')).join('|')})${R}`,
  'giu',
);

function recognizeTimes(text: string): TimeRecognition[] {
  const candidates: Candidate<TimeSpec>[] = [];
  const push = (match: RegExpExecArray, value: TimeSpec | null) => {
    if (value) candidates.push({ start: match.index, end: match.index + match[0].length, text: match[0], value });
  };

  for (const match of findAll(QUALIFIED, text)) {
    const parsed = hourValue(match[1]!);
    const minute = match[2] === undefined ? 0 : Number(match[2]);
    if (!parsed || minute > 59) continue;
    push(match, qualify(parsed.hour, minute, match[3]!.toLowerCase() as Qualifier));
  }
  for (const match of findAll(CLOCK, text)) push(match, unqualified(match[1]!, Number(match[2]), true));
  for (const match of findAll(DOTTED_CLOCK, text)) push(match, unqualified(match[1]!, Number(match[2]), true));
  for (const match of findAll(BARE_HOUR, text)) push(match, unqualified(match[1]!, 0, false));
  for (const match of findAll(NOON, text)) push(match, exactTime(match[1]!.toLowerCase() === 'полдень' ? 12 : 0));
  for (const match of findAll(PART_OF_DAY, text)) {
    const key = match[1]!.toLowerCase().replace(/\s+/g, ' ');
    push(match, { kind: 'part_of_day', partOfDay: PART_OF_DAY_WORDS[key]! });
  }

  return nonOverlapping(candidates).map(({ start, end, text: spanText, value }) => ({ spec: value, evidence: { text: spanText, start, end } }));
}

// ------------------------------------------------------------------ dates ---

const WEEKDAY_FORMS: Record<string, number> = {};
const addForms = (index: number, forms: string[]) => { for (const form of forms) WEEKDAY_FORMS[form] = index; };
addForms(0, ['понедельник', 'понедельника', 'понедельнику']);
addForms(1, ['вторник', 'вторника', 'вторнику']);
addForms(2, ['среду', 'среда', 'среды', 'среде']);
addForms(3, ['четверг', 'четверга', 'четвергу']);
addForms(4, ['пятницу', 'пятница', 'пятницы', 'пятнице']);
addForms(5, ['субботу', 'суббота', 'субботы', 'субботе']);
addForms(6, ['воскресенье', 'воскресенья', 'воскресенью']);
const WEEKDAY_ALT = Object.keys(WEEKDAY_FORMS).sort((a, b) => b.length - a.length).join('|');

const MONTHS: Record<string, number> = {
  'января': 1, 'февраля': 2, 'марта': 3, 'апреля': 4, 'мая': 5, 'июня': 6,
  'июля': 7, 'августа': 8, 'сентября': 9, 'октября': 10, 'ноября': 11, 'декабря': 12,
};

const DEADLINE = '(?:(до|к|ко|не\\s+позже|не\\s+позднее)\\s+)?';
const RELATIVE_WORDS: Record<string, string> = { 'сегодня': 'today', 'завтра': 'tomorrow', 'послезавтра': 'day_after_tomorrow', 'вчера': 'yesterday' };

const RELATIVE = new RegExp(`${L}${DEADLINE}(сегодня|завтра|послезавтра|вчера)${R}`, 'giu');
const WEEKDAY = new RegExp(`${L}${DEADLINE}(?:(?:в|во|на)\\s+)?(?:(следующ(?:ий|ую|ее|его|ей|ему)|эт(?:от|у|о|ого|ой|ому))\\s+)?(${WEEKDAY_ALT})${R}`, 'giu');
const IN_DAYS = new RegExp(`${L}через\\s+(\\d{1,3})\\s+(?:день|дня|дней)${R}`, 'giu');
const PERIOD = new RegExp(`${L}(?:(на|в)\\s+(этой|следующей)\\s+неделе|(в)\\s+(этом|следующем)\\s+месяце|(до)\\s+конца\\s+(недели|месяца))${R}`, 'giu');
const DAY_MONTH = new RegExp(`${L}${DEADLINE}(\\d{1,2})\\s+(${Object.keys(MONTHS).join('|')})(?:\\s+(\\d{4})(?:\\s*г(?:ода|\\.)?)?)?${R}`, 'giu');
const NUMERIC_DATE = new RegExp(`${L}${DEADLINE}(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{4}))?${R}(?!\\.\\d)`, 'giu');
const ISO_DATE = new RegExp(`${L}${DEADLINE}(\\d{4})-(\\d{2})-(\\d{2})${R}`, 'giu');

const roleOf = (prefix: string | undefined): DateRole => (prefix ? 'deadline' : 'plan');

function recognizeDates(text: string): DateRecognition[] {
  const candidates: Candidate<{ role: DateRole; ref: DateRef }>[] = [];
  const push = (match: RegExpExecArray, role: DateRole, ref: DateRef) =>
    candidates.push({ start: match.index, end: match.index + match[0].length, text: match[0], value: { role, ref } });

  for (const match of findAll(RELATIVE, text)) {
    push(match, roleOf(match[1]), { kind: 'token', token: RELATIVE_WORDS[match[2]!.toLowerCase()]! });
  }
  for (const match of findAll(WEEKDAY, text)) {
    const index = WEEKDAY_FORMS[match[3]!.toLowerCase()]!;
    const scope = match[2] && match[2].toLowerCase().startsWith('следующ') ? 'next' : 'this';
    push(match, roleOf(match[1]), { kind: 'token', token: `${scope}_${WEEKDAYS[index]}` });
  }
  for (const match of findAll(IN_DAYS, text)) {
    const days = Number(match[1]);
    if (days >= 1 && days <= 365) push(match, 'plan', { kind: 'token', token: `in_${days}_days` });
  }
  for (const match of findAll(PERIOD, text)) {
    if (match[1]) push(match, 'plan', { kind: 'token', token: match[2]!.toLowerCase() === 'этой' ? 'this_week' : 'next_week' });
    else if (match[3]) push(match, 'plan', { kind: 'token', token: match[4]!.toLowerCase() === 'этом' ? 'this_month' : 'next_month' });
    else push(match, 'deadline', { kind: 'token', token: match[6]!.toLowerCase() === 'недели' ? 'this_week' : 'this_month' });
  }
  for (const match of findAll(DAY_MONTH, text)) {
    push(match, roleOf(match[1]), { kind: 'absolute', day: Number(match[2]), month: MONTHS[match[3]!.toLowerCase()]!, year: match[4] ? Number(match[4]) : null });
  }
  for (const match of findAll(NUMERIC_DATE, text)) {
    const dayOfMonth = Number(match[2]);
    const month = Number(match[3]);
    if (dayOfMonth < 1 || dayOfMonth > 31 || month < 1 || month > 12) continue;
    // "в 12.05" reads as a clock, not a date: without a year it is left to the time lexicon.
    if (!match[4] && !match[1] && /(?:^|[\s(])(?:в|около)\s+$/iu.test(text.slice(0, match.index))) continue;
    push(match, roleOf(match[1]), { kind: 'absolute', day: dayOfMonth, month, year: match[4] ? Number(match[4]) : null });
  }
  for (const match of findAll(ISO_DATE, text)) {
    push(match, roleOf(match[1]), { kind: 'absolute', year: Number(match[2]), month: Number(match[3]), day: Number(match[4]) });
  }

  return nonOverlapping(candidates).map(({ start, end, text: spanText, value }) => ({ role: value.role, ref: value.ref, evidence: { text: spanText, start, end } }));
}

export const ruTemporal: TemporalLexicon = { locale: 'ru', recognizeTimes, recognizeDates };
