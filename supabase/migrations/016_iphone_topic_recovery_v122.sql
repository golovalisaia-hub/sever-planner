-- v122: Preserve both the accepted v120 and rejected v121 attempts; permit one corrected retry only.
-- No subscription endpoint, notification payload, encryption or VAPID key material is recorded.
create table public.push_iphone_topic_recovery_v122 (
  subscription_id uuid primary key references public.push_subscriptions(id) on delete cascade,
  status text not null default 'claimed' check (status in ('claimed','sent','failed')),
  http_status smallint check (http_status between 100 and 599),
  reason text check (reason is null or length(reason) <= 64),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.push_iphone_topic_recovery_v122 enable row level security;
revoke all on table public.push_iphone_topic_recovery_v122 from public, anon, authenticated;
grant select, insert, update on table public.push_iphone_topic_recovery_v122 to service_role;
create policy push_iphone_topic_no_browser_v122 on public.push_iphone_topic_recovery_v122
  for all to anon, authenticated using (false) with check (false);
