// Calendar arithmetic and timezone conversion.
//
// Adapted from TAVRO `_shared/datetime.ts` (todayIn, zonedToUtc, offsetAt).
// Language-specific formatting was removed from core; see src/locales.

import { fail } from '../errors.ts';
import { day } from '../validation.ts';

const partsIn = (timezone: string, instant: number): Record<string, number> => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const result: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(instant))) {
    if (part.type !== 'literal') result[part.type] = Number(part.value);
  }
  return result;
};

/** Offset of `timezone` at `instant`, in milliseconds east of UTC. */
export function offsetAt(timezone: string, instant: number): number {
  const p = partsIn(timezone, instant);
  return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - instant;
}

/** Calendar date (YYYY-MM-DD) currently in effect in `timezone`. */
export function todayIn(timezone: string, now: number = Date.now()): string {
  try {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(new Date(now));
  } catch {
    return fail('INVALID_TIMEZONE');
  }
}

/** Wall clock (HH:MM) currently in effect in `timezone`. */
export function clockIn(timezone: string, now: number = Date.now()): string {
  const p = partsIn(timezone, now);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export function addDays(date: string, days: number): string {
  const base = Date.parse(`${day(date)}T00:00:00Z`);
  return new Date(base + days * 86400000).toISOString().slice(0, 10);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const weekday = new Date(`${day(date)}T00:00:00Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** Monday of the ISO week containing `date`. */
export function weekStart(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

export function monthStart(date: string): string {
  return `${day(date).slice(0, 7)}-01`;
}

export function monthEnd(date: string): string {
  const [year, month] = monthStart(date).split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export function addMonths(date: string, months: number): string {
  const [year, month] = monthStart(date).split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 1 + months, 1)).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${day(to)}T00:00:00Z`) - Date.parse(`${day(from)}T00:00:00Z`)) / 86400000);
}

/**
 * Local wall clock → UTC instant, correct across DST boundaries.
 * Iterating the offset twice converges for real-world zones.
 */
export function zonedToUtc(date: string, time: string, timezone: string): string {
  const wall = Date.parse(`${day(date)}T${time}:00Z`);
  if (!Number.isFinite(wall)) fail('VALIDATION', 'time');
  let instant = wall - offsetAt(timezone, wall);
  instant = wall - offsetAt(timezone, instant);
  return new Date(instant).toISOString();
}
