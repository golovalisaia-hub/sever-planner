-- v120: One remote diagnostic per existing subscription, enforced atomically by PK.
-- The ledger contains neither endpoint, encryption keys, provider bodies nor VAPID material.
create table if not exists public.push_probe_attempts_v120 (
  subscription_id uuid primary key references public.push_subscriptions(id) on delete cascade,
  provider text not null check (provider in ('apple', 'google')),
  status text not null default 'claimed' check (status in ('claimed', 'sent', 'failed')),
  http_status smallint check (http_status between 100 and 599),
  reason text check (reason is null or length(reason) <= 64),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

alter table public.push_probe_attempts_v120 enable row level security;
revoke all on table public.push_probe_attempts_v120 from public, anon, authenticated;
grant select, insert, update on table public.push_probe_attempts_v120 to service_role;

-- Explicit denial as defence in depth; service_role bypasses RLS.
create policy push_probe_no_browser_access_v120 on public.push_probe_attempts_v120
  for all to anon, authenticated using (false) with check (false);
