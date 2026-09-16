-- v126: One expressly requested additional Apple Web Push check; keep all prior probe history immutable.
-- One row per actual subscription prevents concurrent or repeated sends; no endpoints, payloads or keys stored.
create table public.push_owner_iphone_check_v126 (
  subscription_id uuid primary key references public.push_subscriptions(id) on delete cascade,
  status text not null default 'claimed' check (status in ('claimed','sent','failed')),
  http_status smallint check (http_status between 100 and 599),
  reason text check (reason is null or length(reason) <= 64),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.push_owner_iphone_check_v126 enable row level security;
revoke all on table public.push_owner_iphone_check_v126 from public, anon, authenticated;
grant select, insert, update on table public.push_owner_iphone_check_v126 to service_role;
create policy push_owner_iphone_check_no_browser_v126 on public.push_owner_iphone_check_v126
  for all to anon, authenticated using (false) with check (false);
