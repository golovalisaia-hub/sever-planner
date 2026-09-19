-- Restrict push_subscriptions.endpoint to known Web Push provider hosts.
-- `authenticated` may insert and update its own subscription rows, and the
-- service-role dispatcher sends an outbound HTTPS request to whatever endpoint
-- the row contains. Without this constraint that is an attacker-controlled
-- outbound request from trusted infrastructure (SSRF). The dispatcher applies
-- the same allowlist at runtime; this is the schema-level half of the defence.
begin;

-- Pre-existing rows are only disabled, never deleted: an endpoint outside the
-- allowlist stops being dispatched but the user keeps the row and can resubscribe.
update public.push_subscriptions
set enabled = false, updated_at = now()
where enabled
  and endpoint !~ '^https://(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)/';

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_endpoint_trusted_host;

-- NOT VALID keeps the migration safe on a table that already holds rows:
-- every insert and update is checked, historical rows are left to the update above.
alter table public.push_subscriptions
  add constraint push_subscriptions_endpoint_trusted_host check (
    endpoint ~ '^https://(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)/'
  ) not valid;

commit;
