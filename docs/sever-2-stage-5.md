# SEVER 2 — Stage 5 release validation

Validation date: 2026-09-09. Branch: `sever-2-design-v1`.
Stage 4 parent: `ded9dbc6325164111b80fb3f018c502a047449ef`.
The commit containing this report is the stage 5 checkpoint, not approval to release.

## Release gate

**READY TO MERGE: NO. No merge, push, or deployment performed.**

All executed local tests passed. The complete release gate is **NOT PASS**:
two live Supabase integration tests were skipped because disposable-account
configuration was absent. Real USER A PC ↔ phone sync has not been verified.
Local two-client simulations must not be treated as live-device evidence.

## Changes limited to concrete bugs and validation

- Fixed a theme-switch layout shift at 320 px: the toast now uses the same
  short text for every theme.
- Fixed 17 px of quick-add dialog overflow caused by a visually hidden date
  input inheriting full-width control sizing. Its chosen date still saves.
- Updated the standalone responsive test's obsolete hero/summary expectations
  to the approved SEVER 2 baseline, without changing the visible layout.
- Bumped the service-worker release to `sever-v54-release-validation` and
  changed app/design-system asset URLs to v54 in both HTML and the cache list.
  Unchanged files retain their own asset version; coherence is checked by hashes.
- Added release CRUD/protected-note tests, the six-size visual matrix, and a
  real service-worker upgrade harness. Added optional browser-channel support
  to standalone browser tests and ignored pytest cache output.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| Unit, planner, AI, ownership, security | 86 PASS, 2 SKIP, 0 FAIL | `.artifacts/release/unit-security.log` |
| Static | 38/38 PASS | `.artifacts/release/static.log` |
| Sync core | 13/13 PASS | `.artifacts/release/sync.log` |
| Backend | 3/3 PASS; 16 deprecation warnings | `.artifacts/release/backend.log` |
| Playwright, four viewport projects | 148/148 PASS | `.artifacts/release/playwright-final.log` |
| UI actions | PASS | `.artifacts/release/ui-actions.log` |
| Standalone responsive | PASS | `.artifacts/release/responsive.log` |
| PWA v52 → v54, atomic cache, offline reopen | PASS; 35 asset hashes match | `.artifacts/release/pwa-upgrade.json` |
| Theme persistence, first paint, layout shift | PASS, included in Playwright | `tests/browser/themes.spec.cjs`, `theme-pwa.spec.cjs` |
| Calm / Cozy / Focus | PASS in local visual matrix | `.artifacts/release/visual.log` |
| Mobile / tablet / desktop | PASS in local viewport matrix | `.artifacts/release/screenshots/matrix.json` |
| Tracked-source secret scan using CI pattern | PASS | `.artifacts/release/secret-scan.log` |
| Live Auth and two-user RLS | SKIPPED, not PASS | missing test configuration |
| Real USER A PC ↔ phone | NOT VERIFIED | external release blocker |

Browser: headless Microsoft Edge, Windows. Viewport emulation is not a physical
phone test. PWA checks use real service workers and persistent browser profiles;
they do not constitute an OS-level installed-app or production deployment test.

### Functional coverage

Browser tests cover task create/edit/complete/delete/Undo; calendar navigation;
timer start/pause/reset; note create/edit/delete/Undo; protected-note encryption,
wrong/correct password, editing and relock on reload; habit toggle; progress;
settings; AI open/close. Protected-note flows use real browser WebCrypto.
AI provider calls were not part of the requested open/close check.

Anonymous/account isolation, explicit import consent, stale-account requests,
and two-client entity/settings round trips passed local regression tests.
Remote reconciliation in these tests is simulated rather than a live account.

### Visual evidence

216 captures: 3 themes × 6 sizes × (8 views + 4 dialogs).
Sizes: 320×568, 390×844, 430×932, 768×1024, 1440×900, 1920×1080.
Views: Home, Calendar, Timer, Notes, Habits, Progress, Settings, AI.
Dialogs: task, note, protected note, quick add.

Automated checks cover horizontal overflow, dialog bounds, visible icons,
broken images, bottom navigation/AI overlap, browser errors, and identical
view geometry across themes. Screenshot contact sheets and representative
screens were visually inspected; this is not a pixel-level manual audit of
every screenshot.

Open `.artifacts/release/screenshots/index.html` for the complete gallery.
Artifacts are local and intentionally ignored by Git.

## Reproduce

Run from the repository root, using the installed Node dependencies:

```powershell
node --test tests/*.test.mjs tests/security/*.test.*
node tests/qa_static.mjs
node tests/sync_core.mjs
$env:SEVER_BROWSER_CHANNEL = 'msedge'
$env:SEVER_E2E_PORT = '41753' # choose a free port; an existing server is rejected
node node_modules/@playwright/test/cli.js test --workers=2
```

For standalone UI/responsive/visual scripts, set `SEVER_E2E_PORT=41752`
in both terminals, then start `node tests/browser/server.cjs` in the other
terminal. Do not share a server or output directory with a concurrent
Playwright run.

```powershell
$env:SEVER_E2E_PORT = '41752'
$env:SEVER_E2E_URL = 'http://127.0.0.1:41752/'
node tests/ui-actions-e2e.mjs
node tests/responsive-e2e.mjs
node tests/browser/release-visual.cjs
node tests/browser/release-pwa-upgrade.cjs
```

Run `python -m pytest tests -q -p no:cacheprovider` from `backend` in the
existing backend environment. Every command must exit successfully.
`npm` was unavailable in this shell, so the package test script's three
commands were run directly, checking each exit status.

## Required before approval

Configure disposable test accounts securely, not in source files or chat:

- Auth: `SEVER_AUTH_TEST_URL`, `SEVER_AUTH_TEST_ANON_KEY`,
  `SEVER_AUTH_TEST_EMAIL`, `SEVER_AUTH_TEST_PASSWORD`.
- RLS: `SEVER_RLS_TEST_URL`, `SEVER_RLS_TEST_ANON_KEY`,
  `SEVER_RLS_USER_A_EMAIL`, `SEVER_RLS_USER_A_PASSWORD`,
  `SEVER_RLS_USER_B_EMAIL`, `SEVER_RLS_USER_B_PASSWORD`.

Rerun the full suite with zero skips and verify live same-user PC ↔ phone
sync, including account/anonymous isolation and appearance persistence.
Record actual results, then request explicit merge approval.
No known critical defect remains in the executed local checks; missing
live evidence still blocks the release gate.

## Resumed validation — 2026-09-10

The previous checkpoint is `74a9c548725df91eaa431d159d1ff7edd9a34689`.
No application code, visual tokens or layout changed during this continuation.

The initial rerun exposed a test-harness defect: Playwright silently reused
port 41741, which served a different checkout (`app.js?v=51`, old theme names)
instead of this checkout (`app.js?v=54`). That run was interrupted and is
not release evidence. The existing server was left untouched.

- Disabled reuse of an unknown existing server.
- Added validated `SEVER_E2E_PORT` configuration shared by the local server,
  Playwright, theme helpers and persistent/offline PWA contexts.
- Added three regression tests covering default/custom ports, invalid input,
  and the no-reuse policy.
- Verified that port 41741 now fails explicitly with "already used"
  (`.artifacts/release/resume-port-conflict.log`).

Repeated unit/security checks: **89 PASS, 2 SKIP, 0 FAIL**. Static: **38/38**.
Sync core: **13/13**. Backend: **3/3**, 16 deprecation warnings. Standalone UI,
responsive checks, and real PWA v52 → v54 upgrade/offline reopen passed again;
all 35 cached asset hashes match. Evidence is under `.artifacts/release/resume-*`.

Final full Playwright run: **148/148 PASS, exit 0**, on isolated port 41755
with a separate output directory. Evidence:
`.artifacts/release/resume-playwright-complete.log`.
Earlier sandbox runs were interrupted after a teardown hang; an intermediate
run also timed out in the persistent-browser test. They are not counted as
successful runs. The final run outside the sandbox completed normally.

Live Auth/RLS configuration is still absent from the test environment.
Physical PC ↔ phone sync remains unverified. **READY TO MERGE: NO.**
