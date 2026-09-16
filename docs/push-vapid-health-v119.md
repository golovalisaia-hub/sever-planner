# SEVER v119 — private VAPID pair check

A public VAPID key was updated separately from its private secret. This is a hypothesis, not proof of mismatched keys. `sever-push-health` derives a P-256 public key from the existing private secret **inside Supabase** and reports only whether it matches the existing public secret.

## Safety

- POST only; the same `x-sever-cron-token` as the existing dispatcher is checked with a constant-time comparison; `verify_jwt=false` is used only with this custom authentication.
- Returns `ok`, `publicKeyValid`, `privateKeyValid`, `keyPairMatches`; never sends secret/key values, subscription endpoints, raw provider responses or user data.
- Sends no notifications, claims no reminders, and makes no database changes.
- Invoke through trusted internal cron/pg_net with token retrieved from Vault. Never expose or paste the cron token into browser/issue/CI output.

If the pair matches, preserve both keys and investigate the sanitized Apple `reason` / FCM error response in a separate dispatcher change. If it does not match, repair the pair with a planned rotation and explicit device resubscription, not by replacing one secret blindly. This health check alone **does not prove actual push delivery**; issue #48 remains open until server-originated notification and real-device receipt are confirmed.
