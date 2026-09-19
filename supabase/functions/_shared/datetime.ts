// Timezone-aware date resolution shared by SEVER and TAVRO.
//
// The rule that matters for TAVRO: a language model never returns an absolute
// instant. It returns either an explicit calendar date the user actually said,
// a relative token from a closed vocabulary, or nothing at all. This module is
// the only place that turns those into real dates, against the user's own
// timezone, so an unspecified date stays unspecified instead of quietly
// becoming "today".

import { fail } from './validation.ts';

export const RELATIVE_TOKENS = [
  'today', 'tomorrow', 'day_after_tomorrow', 'yesterday',
  'next_monday', 'next_tuesday', 'next_wednesday', 'next_thursday', 'next_friday', 'next_saturday', 'next_sunday',
  'this_monday', 'this_tuesday', 'this_wednesday', 'this_thursday', 'this_friday', 'this_saturday', 'this_sunday',
  'next_week', 'next_month',
] as const;

export type RelativeToken = typeof RELATIVE_TOKENS[number];

const WEEKDAY_INDEX: Record<string, number> = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7 };

const partsIn = (timezone: string, instant: number): Record<string, number> => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const result: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(instant))) {
    if (part.type !== 'literal') result[part.type] = Number(part.value === '24' ? '00' : part.value);
  }
  return result;
};

/** Offset of `timezone` at `instant`, in milliseconds east of UTC. */
export function offsetAt(timezone: string, instant: number): number {
  const parts = partsIn(timezone, instant);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - instant;
}

/** Calendar date (YYYY-MM-DD) currently in effect in `timezone`. */
export function todayIn(timezone: string, now: Date | number = Date.now()): string {
  const instant = typeof now === 'number' ? now : now.getTime();
  try { return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(new Date(instant)); }
  catch { return fail('VALIDATION', 'Некорректный часовой пояс.'); }
}

/** Wall clock (HH:MM) currently in effect in `timezone`. */
export function clockIn(timezone: string, now: Date | number = Date.now()): string {
  const instant = typeof now === 'number' ? now : now.getTime();
  const parts = partsIn(timezone, instant);
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

export function addDays(date: string, days: number): string {
  const base = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(base)) fail('VALIDATION', 'Нужна корректная дата.');
  return new Date(base + days * 86400000).toISOString().slice(0, 10);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function weekdayOf(date: string): number {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/**
 * Resolves a relative token against the user's own "today".
 * `this_<weekday>` is the nearest upcoming occurrence including today;
 * `next_<weekday>` always lands in the following calendar week.
 */
export function resolveRelative(token: string, today: string): string {
  if (token === 'today') return today;
  if (token === 'tomorrow') return addDays(today, 1);
  if (token === 'day_after_tomorrow') return addDays(today, 2);
  if (token === 'yesterday') return addDays(today, -1);
  if (token === 'next_week') return addDays(today, 7);
  if (token === 'next_month') {
    const [year, month, dayOfMonth] = today.split('-').map(Number);
    const target = new Date(Date.UTC(year, month, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(dayOfMonth, lastDay));
    return target.toISOString().slice(0, 10);
  }
  const match = /^(this|next)_(\w+)$/.exec(token);
  if (match && WEEKDAY_INDEX[match[2]]) {
    const target = WEEKDAY_INDEX[match[2]];
    const current = weekdayOf(today);
    const delta = match[1] === 'next' ? nextWeekDelta(current, target) : (target - current + 7) % 7;
    return addDays(today, delta);
  }
  const inDays = /^in_(\d{1,3})_days$/.exec(token);
  if (inDays) return addDays(today, Number(inDays[1]));
  return fail('VALIDATION', 'Неизвестная относительная дата.');
}

/** Days from `current` to `target` in the *following* ISO week. */
function nextWeekDelta(current: number, target: number): number {
  const startOfNextWeek = 8 - current; // next Monday
  return startOfNextWeek + (target - 1);
}

/**
 * Turns a local wall clock into a UTC instant, correct across DST boundaries.
 * Iterating the offset twice converges for every real-world zone.
 */
export function zonedToUtc(date: string, time: string | null, timezone: string): string {
  const wall = Date.parse(`${date}T${time || '00:00'}:00Z`);
  if (!Number.isFinite(wall)) fail('VALIDATION', 'Нужна корректная дата.');
  let instant = wall - offsetAt(timezone, wall);
  instant = wall - offsetAt(timezone, instant);
  return new Date(instant).toISOString();
}

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

/** Short Russian label: "сегодня, 15:00" · "вт, 22 сен · 15:00" · "3 окт". */
export function formatWhen(date: string | null, time: string | null, today: string): string {
  if (!date) return time ? `время ${time}, дата не указана` : 'без даты';
  const clockPart = time ? `, ${time}` : '';
  if (date === today) return `сегодня${clockPart}`;
  if (date === addDays(today, 1)) return `завтра${clockPart}`;
  if (date === addDays(today, -1)) return `вчера${clockPart}`;
  const [, month, dayOfMonth] = date.split('-').map(Number);
  const weekday = WEEKDAYS_SHORT[weekdayOf(date) - 1];
  const withinWeek = date > today && date <= addDays(today, 6);
  const prefix = withinWeek ? `${weekday}, ` : '';
  return `${prefix}${dayOfMonth} ${MONTHS_SHORT[month - 1]}${clockPart}`;
}

/** Inclusive day range, capped so a search can never scan an unbounded window. */
export function dayRange(from: string, to: string, maxDays = 366): [string, string] {
  if (to < from) fail('VALIDATION', 'Конец периода раньше начала.');
  if ((Date.parse(to) - Date.parse(from)) / 86400000 > maxDays) fail('VALIDATION', `Выберите период до ${maxDays} дней.`);
  return [from, to];
}
