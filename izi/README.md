# IZI Planner — code

Telegram-first personal planner. Architecture and roadmap: [`../IZI_PLAN.md`](../IZI_PLAN.md).

**Status: PHASE 2 + 2.1 (Foundation, hardening) — IMPLEMENTED + TESTED LOCALLY.**
Nothing here is deployed; migrations have not been applied to any real
Supabase project; there is no Telegram bot, no AI provider, no UI yet.

## Run

```bash
cd izi
npm ci        # PGlite (PostgreSQL 17.5) and TypeScript, pinned in package-lock.json
npm test      # typecheck + all tests (core, db, security)
```

Requires Node ≥ 22.18 (TypeScript files run through Node's type stripping).
Everything is local: the database tests use PGlite, no network services.

## Layout

| Path | What |
|---|---|
| `supabase/migrations/001_core.sql` | accounts, identities, account_settings, telegram_chats, captures (30-day raw text), inbound_updates queue, rate_limits, ai_runs, privileges |
| `supabase/migrations/002_records.sql` | tasks, events, notes, inbox_items (typed tables, composite ownership keys, FTS) |
| `supabase/migrations/003_actions.sql` | pending_actions, append-only activity_log, transactional apply, undo, housekeeping |
| `src/core/repo/` | the only code that talks to the database; user methods require an `AccountContext` |
| `src/core/actions/` | validation of previewable operations (create/update/delete/restore/convert) |
| `src/core/datetime/` | calendar arithmetic and temporal semantics (dates vs deadlines, week/month precision, parts of day, ambiguity) |
| `src/core/evidence.ts` | verification that an extracted value is supported by the user's own words |
| `src/core/validation.ts`, `errors.ts` | strict input validation, public error codes, sanitised database errors |
| `src/modules/` | record modules (tasks, events, notes, inbox) — writable fields mirror SQL |
| `src/locales/ru/` | Russian time/date lexicon and error texts (the only place with Russian strings) |
| `tests/` | `core/` pure logic, `db/` PGlite, `security/` access and static guards, `fakes/` harness |

## Database access: not decided yet (PHASE 3A gate)

`src/core/db.ts` is a minimal contract; there is **no production adapter** yet.
Before any Telegram code, PHASE 3A applies these migrations to a separate
staging Supabase project, checks PostgreSQL 17, privileges, RLS, real
transactions and concurrency (concurrent account creation, double confirm,
duplicate `update_id`, per-chat ordering), and then chooses by measurement:

- **Option A** — Supabase Data API / supabase-js with `service_role`; `izi` added
  to Exposed Schemas, while `anon`, `authenticated` and `PUBLIC` keep no usage
  and no grants; writes through RPC only.
- **Option B** — direct PostgreSQL connection through the Supabase pooler; the
  schema stays unexposed; pooling, connection limits, secrets, transactions and
  latency must be measured.

The PGlite tests here run on a single connection: their "concurrent" cases are
serialised and are not proof of concurrency safety.

## Rules the tests enforce

- Records are written only through `pending_actions` → `izi.apply_pending_action` (one transaction, logged).
- Database access only from `src/core/repo/`; no `console.*`; no secrets; no Cyrillic outside `src/locales/`.
- Client roles (`anon`, `authenticated`) have no access to the `izi` schema.
- Migrations touch only the `izi` schema and are safe to re-run.
