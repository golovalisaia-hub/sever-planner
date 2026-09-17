-- v126: one user-requested live Apple Web Push check after UI diagnostics cleanup.
-- Stores only provider outcome metadata; never stores endpoints, payloads or VAPID material.
create table public.push_iphone_live_check_v126 (
  subscription_id uuid primary key references public.push_subscriptions(id) on delete cascade,
  status text not null default 'claimed' check (status in ('claimed','sent','failed')),
  http_status smallint check (http_status between 100 and 599),
  reason text check (reason is null or length(reason) <= 64),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.push_iphone_live_check_v126 enable row level security;
revoke all on table public.push_iphone_live_check_v126 from public, anon, authenticated;
grant select, insert, update on table public.push_iphone_live_check_v126 to service_role;
create policy push_iphone_live_check_no_browser_v126 on public.push_iphone_live_check_v126
  for all to anon, authenticated using (false) with check (false);
