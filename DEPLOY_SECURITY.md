# Secure deployment

GitHub remains the source repository. GitHub Pages can host the PWA, but it does not apply the repository `_headers` file. For the full security-header policy, deploy through Cloudflare Pages.

## Cloudflare Pages

1. Connect `golovalisaia-hub/sever-planner` and use `main` as the production branch.
2. This is a static site: no framework preset, no build command, output directory `/`.
3. Confirm that `_headers` is included in the deployment and inspect the live response headers.
4. In Supabase Auth URL Configuration, set the exact production origin as Site URL and add exact development/preview callback URLs only. Do not use wildcard production redirects.
5. Apply SQL migrations in numeric order. Do not apply ad-hoc production schema edits.
6. Require the `Security and regression tests` workflow before deployment.

For automated RLS isolation checks, create two disposable confirmed Auth users and add these GitHub Actions secrets: `SEVER_RLS_TEST_URL`, `SEVER_RLS_TEST_ANON_KEY`, `SEVER_RLS_USER_A_EMAIL`, `SEVER_RLS_USER_A_PASSWORD`, `SEVER_RLS_USER_B_EMAIL`, and `SEVER_RLS_USER_B_PASSWORD`. The test creates temporary planner rows and removes them afterwards. Without all six values the external RLS test is reported as skipped, never as passed.

## Verification checklist

- CSP contains `frame-ancestors 'none'` and no remote script origin.
- Supabase login, registration, confirmation callback, realtime and reconnect work.
- Offline static assets load after one online visit.
- A protected-note marker is absent from localStorage, IndexedDB, backup and sync queue.
- RLS A→B and B→A tests have been run with disposable users.
- Service worker updates to `sever-v36-security` without manual cache clearing.

The FastAPI folder is a future foundation. Its development-only `X-SEVER-User-Id` identity must be replaced by verified Supabase JWT authentication before it stores private production data.
