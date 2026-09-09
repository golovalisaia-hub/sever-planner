# SEVER 2 — Stage 4: Multi-theme system

Date: September 9, 2026. Branch: `sever-2-design-v1`.
Pre-stage commit: `b5ade7b3325be577ed84e9cfd11a32bb39d38875`.

## Delivered

- Calm Balance, Cozy Mood, Focus Peak, selected via `html[data-theme]`.
- One existing DOM/layout and one shared visual component layer; palettes are semantic custom properties.
- Three CSS-preview radio cards in Settings → Appearance → Interface theme, including selected check, keyboard arrows/Home/End and accessible names.
- Immediate switching through existing `appearance` persistence and settings reconciliation.
- Legacy theme migration; anonymous/account scope isolation unchanged.
- Single synchronous initialization before styles/first paint, including native theme-color.
- Atomic v53 service-worker asset set for offline reopen.
- No images, landscape, aurora, neon or glow in the new themes.

Existing component sizes, positions, navigation, task structure and timer/calendar logic are unchanged.
The explicitly requested picker replaces five old cards with three; desktop retains one row and mobile retains three rows. The section and downstream geometry match the pre-stage layout.

## Verification

| Check | Result |
| --- | --- |
| PERSISTENCE | PASS |
| NO FLASH | PASS |
| LAYOUT SHIFT | PASS |
| FUNCTIONAL TESTS | PASS |

- 48 screenshots: 3 themes × Home, Calendar, Timer, Notes, Habits, Progress, Settings, AI × 390×844 / 1440×900.
- All sampled rectangles match the pre-stage commit at 0.01 CSS pixel precision, including the settings section and surrounding shell. All three themes match each other.
- No layout-shift PerformanceObserver entries during theme switching; document and task DOM identity preserved.
- First-paint/first-contentful-paint probes with delayed app bootstrap match the chosen palette.
- Real service worker: each theme survives offline reload and full browser shutdown/relaunch with a persistent profile, including first paint after reopen. This covers the PWA storage/cache lifecycle; an OS-installed standalone app was not separately launched.
- 66/66 browser tests passed in Edge/Chromium, covering the required viewports plus the existing 11-size responsive/zoom regression matrix.
- Node tests: 86 passed, 2 existing environment-dependent skips, 0 failed.
- Static checks: 38/38. Sync-core checks: 13/13.
- Account settings projection, remote reconciliation and scope isolation tested locally; live multi-device Supabase sync was not exercised against a real account. No sync engine or schema changes.
- AI panel opening, input and closing tested; live model requests were not sent.

## Evidence and reproduction

Generated local evidence is ignored by Git in `.artifacts/themes/`:

- `index.html`: all 48 full-resolution screenshots, grouped by theme/viewport.
- `baseline.json`, `geometry.json`, `layout-verification.json`: pre/post rectangle evidence.
- `unit.log`, `static.log`, `sync.log`, `full-browser.log`: test results.

With the local server (`node tests/browser/server.cjs`) running:

```powershell
$env:SEVER_BROWSER_CHANNEL='msedge' # optional; otherwise bundled Chromium
node tests/browser/capture-themes.cjs --baseline
node tests/browser/capture-themes.cjs
node tests/browser/theme-report.cjs
node node_modules/@playwright/test/cli.js test --project=phone-390 --project=desktop --workers=2
node --test tests/*.test.mjs tests/security/*.test.*
node tests/qa_static.mjs
node tests/sync_core.mjs
```

Stage 4 only. No merge or deployment.
