// Temporal semantics: what a user said about *when*, without inventing anything.
//
// The rule of the product: a date or a time exists only if the user said it.
// Everything that is vague stays vague and is represented explicitly:
//   - "next week"   -> a week (a range), never one arbitrary day;
//   - "in the evening" -> part_of_day = evening, time = null;
//   - "at 4"        -> ambiguous (04:00 or 16:00), needs clarification;
//   - "by Friday"   -> a deadline, not a planned date.
// Fixes TAVRO audit findings T5 (next_week became a day) and T6 (no deadline).

import { fail } from '../errors.ts';
import { day as validDay } from '../validation.ts';
import { addDays, addMonths, daysBetween, isoWeekday, monthEnd, monthStart, weekStart } from './calendar.ts';

export const PARTS_OF_DAY = ['morning', 'afternoon', 'evening', 'night'] as const;
export type PartOfDay = typeof PARTS_OF_DAY[number];

export type TimeSpec =
  | { kind: 'none' }
  | { kind: 'exact'; time: string }
  | { kind: 'part_of_day'; partOfDay: PartOfDay }
  | { kind: 'ambiguous'; candidates: string[]; needsClarification: true };

export type DateSpec =
  | { kind: 'none' }
  | { kind: 'day'; date: string }
  | { kind: 'week'; start: string; end: string }
  | { kind: 'month'; start: string; end: string }
  | { kind: 'ambiguous'; candidates: string[]; needsClarification: true };

export const DATE_PRECISIONS = ['day', 'week', 'month'] as const;
export type DatePrecision = typeof DATE_PRECISIONS[number];

export const DATE_ROLES = ['plan', 'deadline'] as const;
export type DateRole = typeof DATE_ROLES[number];

export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export type Weekday = typeof WEEKDAYS[number];

/** Closed vocabulary a parser (deterministic or AI) may emit for a relative date. */
export const DAY_TOKENS = [
  'today', 'tomorrow', 'day_after_tomorrow', 'yesterday',
  ...WEEKDAYS.map(name => `this_${name}`),
  ...WEEKDAYS.map(name => `next_${name}`),
] as const;
export const WEEK_TOKENS = ['this_week', 'next_week'] as const;
export const MONTH_TOKENS = ['this_month', 'next_month'] as const;
const IN_DAYS = /^in_([1-9]\d{0,2})_days$/;
export const MAX_IN_DAYS = 365;

export function isDateToken(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if ((DAY_TOKENS as readonly string[]).includes(value)) return true;
  if ((WEEK_TOKENS as readonly string[]).includes(value) || (MONTH_TOKENS as readonly string[]).includes(value)) return true;
  const match = IN_DAYS.exec(value);
  return Boolean(match && Number(match[1]) <= MAX_IN_DAYS);
}

export type DateRef =
  | { kind: 'token'; token: string }
  | { kind: 'absolute'; year: number | null; month: number; day: number };

const MAX_ABSOLUTE_YEARS = 5;

export const exactDay = (date: string): DateSpec => ({ kind: 'day', date: validDay(date) });
export const weekOf = (date: string): DateSpec => {
  const start = weekStart(date);
  return { kind: 'week', start, end: addDays(start, 6) };
};
export const monthOf = (date: string): DateSpec => ({ kind: 'month', start: monthStart(date), end: monthEnd(date) });
const ambiguousDates = (candidates: string[]): DateSpec => ({ kind: 'ambiguous', candidates, needsClarification: true });

/** Resolves a relative token against the user's own "today" (already in their timezone). */
export function resolveDateToken(token: string, today: string): DateSpec {
  validDay(today, 'today');
  if (!isDateToken(token)) fail('VALIDATION', 'date_token');
  switch (token) {
    case 'today': return exactDay(today);
    case 'tomorrow': return exactDay(addDays(today, 1));
    case 'day_after_tomorrow': return exactDay(addDays(today, 2));
    case 'yesterday': return exactDay(addDays(today, -1));
    case 'this_week': return weekOf(today);
    case 'next_week': return weekOf(addDays(weekStart(today), 7));
    case 'this_month': return monthOf(today);
    case 'next_month': return monthOf(addMonths(today, 1));
  }
  const inDays = IN_DAYS.exec(token);
  if (inDays) return exactDay(addDays(today, Number(inDays[1])));

  const [scope, name] = token.split('_') as [string, Weekday];
  const target = WEEKDAYS.indexOf(name) + 1;
  const current = isoWeekday(today);
  if (scope === 'next') {
    // Same weekday of the following ISO week.
    return exactDay(addDays(weekStart(today), 7 + target - 1));
  }
  const delta = (target - current + 7) % 7;
  // "On Friday" said on a Friday: today or in a week? Not ours to guess.
  if (delta === 0) return ambiguousDates([today, addDays(today, 7)]);
  return exactDay(addDays(today, delta));
}

function realDate(year: number, month: number, dayOfMonth: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(dayOfMonth)) return null;
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

/**
 * An explicit calendar date. Without a year it is the nearest occurrence that is
 * not in the past (a product rule, covered by tests); an impossible date fails.
 */
export function resolveAbsolute(ref: { year: number | null; month: number; day: number }, today: string): DateSpec {
  validDay(today, 'today');
  const thisYear = Number(today.slice(0, 4));
  let date: string | null;
  if (ref.year !== null) {
    date = realDate(ref.year, ref.month, ref.day);
  } else {
    date = realDate(thisYear, ref.month, ref.day);
    if (!date || date < today) date = realDate(thisYear + 1, ref.month, ref.day);
  }
  if (!date) return fail('VALIDATION', 'date');
  if (Math.abs(daysBetween(today, date)) > MAX_ABSOLUTE_YEARS * 366) fail('VALIDATION', 'date');
  return exactDay(date);
}

export function resolveDateRef(ref: DateRef, today: string): DateSpec {
  return ref.kind === 'token' ? resolveDateToken(ref.token, today) : resolveAbsolute(ref, today);
}

export function exactTime(hour: number, minute = 0): TimeSpec {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return fail('VALIDATION', 'time');
  }
  return { kind: 'exact', time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
}

export function ambiguousTime(candidates: string[]): TimeSpec {
  return { kind: 'ambiguous', candidates: [...new Set(candidates)].sort(), needsClarification: true };
}

/** Last day of the period, used when a period is a deadline ("by the end of the week"). */
export function deadlineBoundary(spec: DateSpec): string | null {
  if (spec.kind === 'day') return spec.date;
  if (spec.kind === 'week' || spec.kind === 'month') return spec.end;
  return null;
}

export const CLARIFICATIONS = [
  'ambiguous_date',
  'ambiguous_time',
  'time_without_date',
  'time_needs_single_day',
  'deadline_ambiguous',
  'deadline_time_without_date',
  'deadline_time_unsupported',
  'event_needs_single_day',
] as const;
export type Clarification = typeof CLARIFICATIONS[number];

export type TaskTemporalFields = {
  plan_date: string | null;
  plan_precision: DatePrecision | null;
  plan_time: string | null;
  part_of_day: PartOfDay | null;
  due_date: string | null;
  due_time: string | null;
};

const NONE_DATE: DateSpec = { kind: 'none' };
const NONE_TIME: TimeSpec = { kind: 'none' };

/**
 * Maps what was said onto task columns. Anything that would require guessing is
 * returned as a clarification and the corresponding field stays null.
 */
export function taskTemporalFields(input: { plan?: DateSpec; time?: TimeSpec; deadline?: DateSpec; deadlineTime?: TimeSpec }):
  { fields: TaskTemporalFields; clarifications: Clarification[] } {
  const plan = input.plan ?? NONE_DATE;
  const time = input.time ?? NONE_TIME;
  const deadline = input.deadline ?? NONE_DATE;
  const deadlineTime = input.deadlineTime ?? NONE_TIME;
  const clarifications: Clarification[] = [];
  const fields: TaskTemporalFields = { plan_date: null, plan_precision: null, plan_time: null, part_of_day: null, due_date: null, due_time: null };

  if (plan.kind === 'day') { fields.plan_date = plan.date; fields.plan_precision = 'day'; }
  else if (plan.kind === 'week') { fields.plan_date = plan.start; fields.plan_precision = 'week'; }
  else if (plan.kind === 'month') { fields.plan_date = plan.start; fields.plan_precision = 'month'; }
  else if (plan.kind === 'ambiguous') clarifications.push('ambiguous_date');

  if (time.kind === 'exact') {
    if (fields.plan_precision === 'day') fields.plan_time = time.time;
    else if (plan.kind === 'none') clarifications.push('time_without_date');
    else if (plan.kind !== 'ambiguous') clarifications.push('time_needs_single_day');
  } else if (time.kind === 'part_of_day') {
    fields.part_of_day = time.partOfDay;
  } else if (time.kind === 'ambiguous') {
    clarifications.push('ambiguous_time');
  }

  if (deadline.kind === 'ambiguous') clarifications.push('deadline_ambiguous');
  else fields.due_date = deadlineBoundary(deadline);

  if (deadlineTime.kind === 'exact') {
    if (fields.due_date) fields.due_time = deadlineTime.time;
    else clarifications.push('deadline_time_without_date');
  } else if (deadlineTime.kind !== 'none') {
    clarifications.push('deadline_time_unsupported');
  }

  return { fields, clarifications: [...new Set(clarifications)] };
}

export type EventTemporalFields = { start_date: string | null; start_time: string | null; part_of_day: PartOfDay | null };

/** Events happen on one day; a vague period is a clarification, not a default. */
export function eventTemporalFields(input: { date?: DateSpec; time?: TimeSpec }):
  { fields: EventTemporalFields; clarifications: Clarification[] } {
  const date = input.date ?? NONE_DATE;
  const time = input.time ?? NONE_TIME;
  const clarifications: Clarification[] = [];
  const fields: EventTemporalFields = { start_date: null, start_time: null, part_of_day: null };

  if (date.kind === 'day') fields.start_date = date.date;
  else if (date.kind === 'week' || date.kind === 'month') clarifications.push('event_needs_single_day');
  else if (date.kind === 'ambiguous') clarifications.push('ambiguous_date');

  if (time.kind === 'exact') {
    if (fields.start_date) fields.start_time = time.time;
    else if (date.kind === 'none') clarifications.push('time_without_date');
  } else if (time.kind === 'part_of_day') fields.part_of_day = time.partOfDay;
  else if (time.kind === 'ambiguous') clarifications.push('ambiguous_time');

  return { fields, clarifications: [...new Set(clarifications)] };
}
