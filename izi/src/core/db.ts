// Minimal database contract used by the repository layer.
//
// Every statement is parameterised SQL. The production adapter (Phase 3) is a
// direct Postgres connection from the server; tests use PGlite (PostgreSQL 17,
// same major version as Supabase). Nothing outside src/core/repo may call these
// methods (enforced by tests/security/static.test.mjs).

export type Row = Record<string, unknown>;

export interface Queryable {
  query<T extends Row = Row>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
  /** Runs `fn` in one transaction: every statement commits together or none does. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}
