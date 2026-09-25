// The only place that talks to the database driver. Every error leaving this
// module is an AppError with a public code; driver messages, SQL and parameter
// values never escape (see fromDbError).

import type { Db, Queryable, Row } from '../db.ts';
import { fail, fromDbError } from '../errors.ts';

export async function rows<T extends Row>(db: Queryable, sql: string, params: readonly unknown[] = []): Promise<T[]> {
  try {
    return (await db.query<T>(sql, params)).rows;
  } catch (error) {
    throw fromDbError(error);
  }
}

export async function maybeOne<T extends Row>(db: Queryable, sql: string, params: readonly unknown[] = []): Promise<T | null> {
  const result = await rows<T>(db, sql, params);
  return result[0] ?? null;
}

export async function one<T extends Row>(db: Queryable, sql: string, params: readonly unknown[] = []): Promise<T> {
  const row = await maybeOne<T>(db, sql, params);
  if (!row) fail('NOT_FOUND');
  return row as T;
}

export async function transaction<T>(db: Db, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  try {
    return await db.transaction(fn);
  } catch (error) {
    throw fromDbError(error);
  }
}

/** Table names come from the module registry only; this is a second guard. */
export function tableName(name: string): string {
  if (!/^[a-z][a-z_]{1,40}$/.test(name)) fail('INTERNAL');
  return `izi.${name}`;
}

export function columnList(columns: readonly string[]): string {
  for (const column of columns) if (!/^[a-z][a-z0-9_]{0,40}$/.test(column)) fail('INTERNAL');
  return columns.join(', ');
}

/**
 * Select list for API reads: calendar dates as 'YYYY-MM-DD' and wall-clock
 * times as 'HH:MM' strings, so no driver turns a date into a shifted instant.
 */
export function readList(columns: readonly string[]): string {
  columnList(columns);
  return columns.map(column => {
    if (column.endsWith('_date')) return `${column}::text as ${column}`;
    if (column.endsWith('_time')) return `to_char(${column}, 'HH24:MI') as ${column}`;
    return column;
  }).join(', ');
}
