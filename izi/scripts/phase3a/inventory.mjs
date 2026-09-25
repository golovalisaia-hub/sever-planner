// Read-only inventory of everything OUTSIDE the izi schema (plus a summary of
// izi), used before and after applying IZI migrations to the shared project.
//
//   IZI_TEST_DATABASE_URL=... node scripts/phase3a/inventory.mjs --out before.json
//   IZI_TEST_DATABASE_URL=... node scripts/phase3a/inventory.mjs --out after.json
//   node scripts/phase3a/inventory.mjs --compare before.json after.json
//
// Output contains object names and definition hashes only — no row data.
// Keep the JSON files local; do not commit them.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createPool, databaseUrl, describeTarget } from './lib.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

const QUERIES = {
  version: `select current_setting('server_version') as version, current_setting('server_version_num')::int as num`,
  schemas: `select nspname as name from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema' order by 1`,
  tables: `select n.nspname as schema, c.relname as name, c.relkind as kind, c.relrowsecurity as rls, c.relforcerowsecurity as force_rls
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where c.relkind in ('r','p','v','m','f') and n.nspname !~ '^pg_' and n.nspname <> 'information_schema' order by 1,2`,
  columns: `select table_schema as schema, table_name as name,
                   jsonb_agg(jsonb_build_array(column_name, data_type, is_nullable, column_default) order by ordinal_position) as cols
              from information_schema.columns where table_schema !~ '^pg_' and table_schema <> 'information_schema' group by 1,2 order by 1,2`,
  constraints: `select n.nspname as schema, c.conrelid::regclass::text as tbl, c.conname as name, pg_get_constraintdef(c.oid) as def
                  from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname !~ '^pg_' order by 1,2,3`,
  indexes: `select schemaname as schema, tablename as tbl, indexname as name, indexdef as def from pg_indexes where schemaname !~ '^pg_' order by 1,2,3`,
  functions: `select n.nspname as schema, p.oid::regprocedure::text as name, md5(pg_get_functiondef(p.oid)) as def_md5
                from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname !~ '^pg_' and n.nspname <> 'information_schema' and p.prokind in ('f','p') order by 1,2`,
  triggers: `select n.nspname as schema, c.relname as tbl, t.tgname as name, md5(pg_get_triggerdef(t.oid)) as def_md5
               from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
              where not t.tgisinternal and n.nspname !~ '^pg_' order by 1,2,3`,
  policies: `select schemaname as schema, tablename as tbl, policyname as name, md5(coalesce(qual,'') || coalesce(with_check,'') || array_to_string(roles, ',') || cmd) as def_md5
               from pg_policies order by 1,2,3`,
  grants: `select table_schema as schema, table_name as tbl, grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
             from information_schema.role_table_grants where table_schema !~ '^pg_' and table_schema <> 'information_schema' group by 1,2,3 order by 1,2,3`,
  extensions: `select extname as name, extversion as version from pg_extension order by 1`,
};

async function optional(pool, sql) {
  try { return (await pool.query(sql)).rows; } catch (error) { return { unavailable: error.code || 'ERROR' }; }
}

async function snapshot() {
  const url = databaseUrl();
  if (!url) throw new Error('Set IZI_TEST_DATABASE_URL');
  const pool = createPool(url, 2);
  try {
    const result = { target: describeTarget(url), taken_at: new Date().toISOString() };
    for (const [key, sql] of Object.entries(QUERIES)) result[key] = (await pool.query(sql)).rows;
    result.cron_jobs = await optional(pool, `select jobname as name, schedule, active, md5(command) as command_md5 from cron.job order by 1`);
    result.vault_secret_names = await optional(pool, `select name from vault.secrets order by 1`);
    result.migrations = await optional(pool, `select version, name from supabase_migrations.schema_migrations order by 1`);
    result.auth_users = await optional(pool, `select count(*)::int as n from auth.users`);
    result.storage = await optional(pool, `select b.name, b.public, count(o.id)::int as objects from storage.buckets b left join storage.objects o on o.bucket_id = b.id group by 1,2 order by 1`);
    return result;
  } finally { await pool.end(); }
}

/** Everything that must be identical before/after: all objects outside `izi`. */
function nonIzi(inventory) {
  const out = {};
  for (const [key, value] of Object.entries(inventory)) {
    if (['target', 'taken_at', 'auth_users', 'storage'].includes(key)) continue;
    out[key] = Array.isArray(value) ? value.filter(row => row.schema !== 'izi' && row.name !== 'izi' && !String(row.name || '').startsWith('izi.')) : value;
  }
  return out;
}

function summarise(inventory) {
  const tables = inventory.tables.filter(t => t.kind === 'r');
  const publicTables = tables.filter(t => t.schema === 'public').map(t => t.name);
  return {
    target: inventory.target,
    postgres: inventory.version[0],
    schemas: inventory.schemas.map(s => s.name),
    public_tables: publicTables.length,
    academy_tables: publicTables.filter(n => n.startsWith('academy_')),
    sever_tables: publicTables.filter(n => !n.startsWith('academy_')).length,
    izi_tables: tables.filter(t => t.schema === 'izi').map(t => t.name),
    cron_jobs: Array.isArray(inventory.cron_jobs) ? inventory.cron_jobs.map(j => j.name) : inventory.cron_jobs,
    non_izi_fingerprint: hash(nonIzi(inventory)),
  };
}

const args = process.argv.slice(2);
if (args[0] === '--compare') {
  const [before, after] = args.slice(1).map(path => JSON.parse(readFileSync(path, 'utf8')));
  const a = nonIzi(before); const b = nonIzi(after);
  const changed = Object.keys({ ...a, ...b }).filter(key => hash(a[key]) !== hash(b[key]));
  console.log(JSON.stringify({ before: summarise(before), after: summarise(after), non_izi_identical: changed.length === 0, changed_sections: changed }, null, 2));
  process.exit(changed.length === 0 ? 0 : 1);
} else {
  const out = args[args.indexOf('--out') + 1];
  if (!out || args.indexOf('--out') < 0) throw new Error('Usage: --out <file.json> | --compare <before.json> <after.json>');
  const inventory = await snapshot();
  writeFileSync(out, JSON.stringify(inventory, null, 2));
  console.log(JSON.stringify(summarise(inventory), null, 2));
}
