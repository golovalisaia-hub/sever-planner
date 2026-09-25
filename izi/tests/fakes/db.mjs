// Test database: PGlite (PostgreSQL 17, same major version as Supabase) with the
// Supabase client roles recreated, IZI migrations applied, and a session that
// runs as `service_role` — the role the IZI server will use.

import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

export const MIGRATIONS_DIR = new URL('../../supabase/migrations/', import.meta.url);

export const migrationFiles = () => readdirSync(MIGRATIONS_DIR).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();

export const migrationSql = name => readFileSync(new URL(name, MIGRATIONS_DIR), 'utf8');

export async function createPg() {
  const pg = new PGlite();
  await pg.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create role server_without_bypass nologin;
  `);
  return pg;
}

export async function migrate(pg) {
  for (const name of migrationFiles()) await pg.exec(migrationSql(name));
}

/** A fresh migrated database whose session role is service_role. */
export async function freshDb() {
  const pg = await createPg();
  await migrate(pg);
  await pg.exec('set role service_role');
  return { pg, db: asDb(pg) };
}

/** Adapts PGlite to src/core/db.ts `Db`. */
export function asDb(pg) {
  const wrap = handle => ({ query: (sql, params = []) => handle.query(sql, params) });
  return { ...wrap(pg), transaction: fn => pg.transaction(tx => fn(wrap(tx))) };
}

export async function asRole(pg, role, fn) {
  await pg.exec(`set role ${role}`);
  try { return await fn(); } finally { await pg.exec('set role service_role'); }
}

/** Runs as the migration owner with triggers off: only for arranging test fixtures (e.g. moving time). */
export async function asOwnerRaw(pg, sql, params = []) {
  await pg.exec('reset role; set session_replication_role = replica');
  try { return await pg.query(sql, params); } finally { await pg.exec('set session_replication_role = origin; set role service_role'); }
}

export async function asOwner(pg, fn) {
  await pg.exec('reset role');
  try { return await fn(); } finally { await pg.exec('set role service_role'); }
}
