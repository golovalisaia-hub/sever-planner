-- v121: One additional user-requested Apple test, independently reserved before network IO.
-- Retain v120's immutable diagnostic history and never store endpoints or key material here.
create table public.push_iphone_retry_v121 (
  subscription_id uuid primary key references public.push_subscriptions(id) on delete cascade,
  status text not null default 'claimed' check (status in ('claimed','sent','failed')),
  http_status smallint check (http_status between 100 and 599),
  reason text check (reason is null or length(reason) <= 64),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.push_iphone_retry_v121 enable row level security;
revoke all on table public.push_iphone_retry_v121 from public, anon, authenticated;
grant select, insert, update on table public.push_iphone_retry_v121 to service_role;
create policy push_iphone_retry_no_browser_v121 on public.push_iphone_retry_v121
  for all to anon, authenticated using (false) with check (false);
