# PHASE 3A runbook — shared Supabase project `vdhazibkfpgclcwyvvbi`

The project also hosts **Academy** (live) and the archived **SEVER** tables.
IZI may change **only the `izi` schema**. Never touch `public`, `academy_*`,
`academy-tutor`, Auth, Storage, Vault or cron.

Secrets (DB password, service_role key) go only into environment variables of
the machine running these steps — never into Git, chat or logs. Snapshots
(`before.json`, `after.json`) contain object names and hashes only and stay local.

## 0. Connection

Direct or pooler connection string (Dashboard → Connect). Option B uses the
Supavisor pooler; record which mode (session 5432 / transaction 6543) was used.

```bash
export IZI_TEST_DATABASE_URL='postgresql://…'   # not echoed anywhere
cd izi && npm ci
```

## 1. Snapshot before

```bash
node scripts/phase3a/inventory.mjs --out before.json
```

Expected summary: PostgreSQL 17.x, `academy_tables` = 6 names, no `izi` schema.

## 2. Apply IZI migrations (each file in its own transaction)

```bash
for f in supabase/migrations/00*.sql; do psql "$IZI_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f "$f" || break; done
```

(Equivalent: paste each file into the SQL Editor in order.)

## 3. Declare the environment marker (once)

```bash
psql "$IZI_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/phase3a/set-environment-marker.sql
```

## 4. Snapshot after and compare — acceptance gate

```bash
node scripts/phase3a/inventory.mjs --out after.json
node scripts/phase3a/inventory.mjs --compare before.json after.json   # exit 0 required
```

`non_izi_identical` must be `true`. Edge Functions are not visible to SQL:
compare `supabase functions list --project-ref vdhazibkfpgclcwyvvbi` (or the
Dashboard list) before and after — must still be exactly `academy-tutor` + the
SEVER functions, unchanged versions.

## 5. Contract and concurrency tests (Option B path)

```bash
IZI_EXPECTED_ENVIRONMENT=staging npm run test:integration
```

Stops immediately unless `izi.system_config` says `izi_planner` / `staging`.
Covers: PostgreSQL 17, no client access to `izi`, RLS, no cross-schema links,
transactional rollback, A (20× account creation), B (10× confirm),
C (20× same update_id), D (ordering across 5 workers). Cleans up after itself.
Run it once with the direct connection and once with the pooler (transaction
mode) and record timings.

## 6. Option A probe (Data API)

Only if the owner chooses to test it: add `izi` to Dashboard → API → Exposed
schemas, then

```bash
IZI_SUPABASE_URL=https://vdhazibkfpgclcwyvvbi.supabase.co IZI_SERVICE_ROLE_KEY=… IZI_PUBLIC_KEY=… \
  node scripts/phase3a/data-api-probe.mjs
```

`public_key_refused.ok` must be `true`. Re-run step 4 afterwards (grants must
still show nothing for `anon`/`authenticated`/`PUBLIC`). If Option B is chosen,
remove `izi` from Exposed schemas again.

## 7. Record results

Fill the "PHASE 3A — measured results" table in `IZI_PLAN.md`.
