# SEVER v55 field-sync release

Base: `c3e50cd6dd000591a6db7f938df74f96b882ec36`.
No CSS, layout, theme palette, navigation or visual assets changed.

## Root cause and protocol

Previously `mergeStates` chose one whole record by `updatedAt`, while the DB
keep-newest trigger rejected older whole rows. Thus title and category edits
from two offline clients could overwrite one another.

The client now persists `syncMeta.fieldVersions[collection:id]`; the database
stores the same metadata in additive JSONB column `sync_versions`:

- Each field/register has `[logicalMilliseconds, actorId]`.
- A real edit advances the clock beyond observed clocks, even for multiple
  edits in the same millisecond. Actor IDs are random per runtime, not user
  credentials. Same-field conflicts choose clock, then ASCII actor ID.
- Equal stamps use canonical value ordering for deterministic tie-breaking.
- Task title, date, time, duration, category, priority and challenge are separate.
- Task completion + completion time are atomic. Note content/encryption is
  atomic to prevent combining plaintext and a protected envelope. Folder
  assignment is independent. Focus records and settings data are atomic.
- `createdAt` is not a content conflict or reason to re-upload. A downloaded
  winner is not stamped as another local edit.
- Whole-row LWW remains only for two legacy unversioned records.

## Delete / Undo

Lifecycle metadata is `{generation, deleted, stamp}`. Delete wins over edits
in the same generation, including an edit with a later wall clock. Explicit
Undo which observed the tombstone advances the generation. Repeated deletion
or delivery from older generations cannot resurrect or re-delete restored data.
No tombstones or queues are purged by this release.

PostgreSQL performs the same merge in a row UPDATE trigger, under the ordinary
request's RLS context and row lock. Client-side merging alone is insufficient.
RLS policies and Owner/User rules are unchanged.

## Compatibility / deployment order — REQUIRED

1. Preserve the existing production backup
   `backup/main-before-sever-2-20260910-b5ade7b`
   at `b5ade7b3325be577ed84e9cfd11a32bb39d38875`.
2. Test/apply `supabase/migrations/005_field_version_sync.sql` using an
   authorized migration identity in the correct Supabase project.
   The migration is additive, transaction-wrapped and repeatable. It neither
   deletes user rows nor replaces Auth/RLS policies.
3. Deploy the matching `sever-ai` Edge Function (including `sync-versions.ts`).
   AI patches stamp the changed group and use metadata equality as optimistic
   precondition. A concurrent change fails rather than silently losing data.
4. Confirm `sever_sync_protocol()` returns `1` through the public client path.
   Then verify live two-user Auth/RLS and AI edits before frontend publication.
5. Only then merge/push the tested frontend, wait for main CI and Pages, and
   perform read-only production smoke.

Old data is read without a destructive backfill. A record gets metadata on
an actual edit. Old clients may read metadata-bearing rows; writes without
valid new versions are rejected, not guessed or applied over newer data.
Unversioned pending offline queues remain on the originating device.
Initialization stops with `SYNC_LEGACY_QUEUE_REVIEW`, retaining account cache
and queue for explicit reconciliation. They are NOT silently uploaded or
discarded. Users should sync old devices before rollout. Do not clear storage
to resolve a blocked queue.

The new client checks the schema protocol before account hydration. Without
migration it keeps local data and reports `SYNC_SCHEMA_UPGRADE_REQUIRED`.
This is a safety check, not permission to publish ahead of the migration.

Database rollback must preserve `sync_versions` and tombstones. Reverting
static files to the old backup stops versioned writes; it does not magically
downgrade the data protocol. In an incident, retain queues/data and restore a
known-good compatible client or operate local/read-only until repaired.

## Regression coverage

- `tests/field-sync.test.mjs`: scenarios A–H, legacy snapshots, atomic groups,
  no-op saves, no clock inflation and deterministic merging.
- `tests/browser/concurrent-db.cjs`: actual application in independent desktop
  and mobile contexts, actual migrated PGlite SQL/RLS, duplicate and stale
  writes, same-field and different-field conflicts, actual UI delete/Undo,
  offline/reopen/reconnect, B isolation, migration retry and metadata validation.
- Auth and channel transport are explicitly test adapters; this is NOT hosted
  GoTrue, PostgREST HTTP, Realtime WebSocket or physical-device evidence.
- Existing tests cover protected notes, draft reconciliation, Undo, security,
  AI, PWA, themes, responsive layouts and backend.
- CI now runs the two-context SQL suite and real installed PWA upgrade.

## Release boundary

`sever-v55-field-sync`: new app/cloud/sync-core URLs are v55. Unchanged CSS and
other assets retain their versions. The v52→v55 upgrade test checks all cached
asset hashes and an offline reopen.

## External blocker observed on 2026-09-10

Production protocol request returned HTTP 404 / `PGRST202`, not protocol 1.
No local Supabase migration credentials/tool session were available. Dashboard
opened at sign-in; GitHub repository Actions secrets list was empty.

**DO NOT MERGE/PUBLISH until the migration and Edge Function are deployed and
verified.** A passing local SQL simulation does not establish hosted readiness.
The frontend still intentionally contains the exact Calm/Cozy/Focus design
from the explicitly requested base, not the divergent remote design branch.
