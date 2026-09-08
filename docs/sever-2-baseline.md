# SEVER 2 UI stabilization v3 baseline

Main HEAD, verified on GitHub before changes: c2f47e438260df5298297ebe6572123b5a563869.
UI baseline: fefd677ea2310b44fc6ed6e672c561703b2b6400; its tree db1f9f68dc7f61d22c155110c88e648e3605d6b3 is identical to published sync fix bd484f2568e9fac868b34400f709902bb3a96f3c.
Branch: sever-2-ui-stabilization-v3. Main and previous design branches are preserved.

Before product edits:
- node --test tests/*.test.mjs tests/security/*.*: 81 passed, 2 existing credential-dependent skips, 0 failed. Includes Draft and Undo.
- node tests/qa_static.mjs: 38/38.
- node tests/sync_core.mjs: 13/13, including advancing-clock deletion regression.
- node node_modules/@playwright/test/cli.js test --workers=2: 28/28.
- ../.venv/Scripts/python.exe -m pytest backend/tests -q: 3 passed, 16 dependency warnings.
- Isolated Chromium, real service worker: 88 screenshots, 11 sizes x 8 views, no page errors.

Baseline images and logs: ../sever-2-review/v3/baseline. Sizes: 320x568, 360x800, 375x812, 390x844, 393x852, 412x915, 430x932, 768x1024, 1280x720, 1440x900, 1920x1080.

## Audit and ownership

style.css / qa.css / responsive.css provide original structure and accessibility. design-system.css owns shared controls, icons, focus, spacing tokens. mobile-system.css owns sheets and More/settings presentation. onboarding.css owns tours. northern.css and reference-theme.css supply existing theme atmosphere. northern-components.css supplies earlier component decoration. sever-v41.css is the effective shared component and desktop shell owner. mobile-home.css owns final mobile Home/nav geometry. sever-ai.css must own ALL AI geometry, including the mobile launcher; remove its competing Home rules instead of appending overrides.

Preserve IDs, form fields and navigation data attributes. app.js owns task rendering, timer, persistence and view switching; notes-pro.js owns notes and protected-note editing; mobile-ui.js connects More/settings; js/ui-state.js preserves drafts. Cloud runtime, sync core, Supabase client, authentication, RLS, migrations, backend and all persistence/crypto models are frozen throughout UI work. No function refactors are justified.

## Existing issues

Small-phone tasks are pushed down by hero, motivation and four metric cards. Metric labels are too small. AI launcher placement is split across two CSS files and competes with Create. Closed AI panel expands full-page captures. Production task/goal placeholders contain imposed examples. Existing legacy browser contexts that block service workers may emit a registration.waiting error; actual-worker baseline has no runtime errors. Existing task renderer uses text glyphs and 'Без времени' metadata; any presentation change must preserve its events and data model.

Existing stabilization work is reviewed and reused selectively, excluding the separate three-theme experiment. PWA changes are restricted to release version and asset manifests. Version-specific test expectations may follow the new asset release, with assertions retained.
