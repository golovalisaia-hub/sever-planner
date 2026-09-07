# SEVER AI implementation

Work follows stages A–J from the supplied specification. Branch: feature/sever-ai.

- A: audited. SEVER is a static vanilla-JS PWA with Supabase Auth, Postgres and Realtime sync.
- B: migration `003_sever_ai.sql` is applied. Roles live in `profiles.role`; the immutable OWNER UUID is `6cc5a4e9-a0c9-48da-8fea-ee290dca92f1`.
- C–I: the `sever-ai` Supabase Edge Function is deployed with server-only provider configuration, quotas, streaming, context validation, tool permissions, plans, guide and transparent memory.
- J: AI/RLS/provider tests (20), static/UI checks (36) and sync checks (11) passed before release.

Provider secrets remain only in Supabase Edge Function Secrets. No secret is stored in this repository or sent to the browser.
