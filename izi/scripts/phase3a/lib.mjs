// Shared helpers for PHASE 3A scripts and integration tests.
// The connection string comes only from the environment and is never printed.

import pg from 'pg';

export function databaseUrl() {
  const url = process.env.IZI_TEST_DATABASE_URL;
  if (!url) return null;
  return url;
}

/** Host part only, for logs; credentials are never shown. */
export function describeTarget(url) {
  try { const u = new URL(url); return `${u.hostname}:${u.port || 5432}/${u.pathname.slice(1)}`; } catch { return 'invalid-url'; }
}

export function isLocalHost(url) {
  try { return ['localhost', '127.0.0.1', '::1', ''].includes(new URL(url).hostname); } catch { return false; }
}

export function createPool(url, max = 25) {
  const u = new URL(url);
  const local = isLocalHost(url);
  return new pg.Pool({
    connectionString: url,
    max,
    ssl: local || u.searchParams.get('sslmode') === 'disable' ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    statement_timeout: 30000,
  });
}

/**
 * Stops unless the database declares itself as IZI in the expected
 * environment. `local` is accepted only for a localhost target.
 */
export async function assertEnvironment(pool, url) {
  const expected = process.env.IZI_EXPECTED_ENVIRONMENT || 'staging';
  if (!['staging', 'local'].includes(expected)) throw new Error('STOP: IZI_EXPECTED_ENVIRONMENT must be staging (or local on localhost)');
  if (expected === 'local' && !isLocalHost(url)) throw new Error('STOP: environment "local" is allowed only for localhost');
  try {
    const { rows } = await pool.query('select izi.assert_environment($1) as environment', [expected]);
    return rows[0].environment;
  } catch (error) {
    throw new Error(`STOP: environment marker check failed (${error.code || 'no code'} ${error.message.split('\n')[0]})`);
  }
}
