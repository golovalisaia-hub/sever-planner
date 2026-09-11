-- SEVER task reminders v82.
-- Secrets are provisioned out-of-band in Supabase Vault under the names used below.
begin;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  timezone text not null default 'UTC',
  user_agent text not null default '',
  enabled boolean not null default true,
  remind_day_before boolean not null default true,
  remind_15_minutes boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists push_subscriptions_user_enabled_idx on public.push_subscriptions(user_id, enabled);
alter table public.push_subscriptions enable row level security;
drop policy if exists "push subscriptions are private" on public.push_subscriptions;
create policy "push subscriptions are private" on public.push_subscriptions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.push_subscriptions to authenticated;
revoke all on public.push_subscriptions from anon;

create table if not exists public.push_deliveries (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  reminder_kind text not null check (reminder_kind in ('day_before','fifteen_minutes')),
  due_at timestamptz not null,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz,
  status text not null default 'claimed' check (status in ('claimed','sent','failed')),
  error_code text,
  created_at timestamptz not null default now(),
  unique (task_id, subscription_id, reminder_kind, due_at)
);

create index if not exists push_deliveries_status_idx on public.push_deliveries(status, claimed_at);
alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from public, anon, authenticated;
grant select, insert, update, delete on public.push_deliveries to service_role;

create or replace function public.sever_push_runtime_secrets()
returns table(vapid_public text, vapid_private text, cron_token text)
language sql security definer set search_path = vault, public, pg_temp
as $$
  select
    max(decrypted_secret) filter (where name='sever_push_vapid_public'),
    max(decrypted_secret) filter (where name='sever_push_vapid_private'),
    max(decrypted_secret) filter (where name='sever_push_cron_token')
  from vault.decrypted_secrets
  where name in ('sever_push_vapid_public','sever_push_vapid_private','sever_push_cron_token');
$$;
revoke all on function public.sever_push_runtime_secrets() from public, anon, authenticated;
grant execute on function public.sever_push_runtime_secrets() to service_role;

create or replace function public.sever_claim_due_pushes(p_limit integer default 100)
returns table(delivery_id bigint,subscription_id uuid,endpoint text,p256dh text,auth text,task_id uuid,user_id uuid,task_title text,scheduled_for date,scheduled_time time,reminder_kind text,due_at timestamptz)
language sql security definer set search_path = public, pg_catalog, pg_temp
as $$
  with candidate as (
    select ps.id subscription_id,ps.endpoint,ps.p256dh,ps.auth,t.id task_id,t.user_id,t.title task_title,t.scheduled_for,t.scheduled_time,r.reminder_kind,r.due_at
    from public.push_subscriptions ps
    join public.tasks t on t.user_id=ps.user_id
    left join pg_catalog.pg_timezone_names tz on tz.name=ps.timezone
    cross join lateral (
      select 'day_before'::text,((t.scheduled_for+t.scheduled_time) at time zone coalesce(tz.name,'UTC'))-interval '1 day' where ps.remind_day_before
      union all
      select 'fifteen_minutes'::text,((t.scheduled_for+t.scheduled_time) at time zone coalesce(tz.name,'UTC'))-interval '15 minutes' where ps.remind_15_minutes
    ) r(reminder_kind,due_at)
    where ps.enabled and t.deleted_at is null and not t.completed and t.scheduled_for is not null and t.scheduled_time is not null
      and r.due_at<=now() and r.due_at>now()-interval '5 minutes'
    order by r.due_at,t.id,ps.id
    limit greatest(1,least(coalesce(p_limit,100),500))
  ), inserted as (
    insert into public.push_deliveries(user_id,task_id,subscription_id,reminder_kind,due_at)
    select user_id,task_id,subscription_id,reminder_kind,due_at from candidate
    on conflict (task_id,subscription_id,reminder_kind,due_at) do nothing
    returning id,task_id,subscription_id,reminder_kind,due_at
  )
  select i.id,c.subscription_id,c.endpoint,c.p256dh,c.auth,c.task_id,c.user_id,c.task_title,c.scheduled_for,c.scheduled_time,c.reminder_kind,c.due_at
  from inserted i join candidate c on c.task_id=i.task_id and c.subscription_id=i.subscription_id and c.reminder_kind=i.reminder_kind and c.due_at=i.due_at;
$$;
revoke all on function public.sever_claim_due_pushes(integer) from public, anon, authenticated;
grant execute on function public.sever_claim_due_pushes(integer) to service_role;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname='sever-task-push-dispatch' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule('sever-task-push-dispatch','* * * * *',$cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='sever_project_url' limit 1) || '/functions/v1/sever-push-dispatch',
      headers := jsonb_build_object('Content-Type','application/json','x-sever-cron-token',(select decrypted_secret from vault.decrypted_secrets where name='sever_push_cron_token' limit 1)),
      body := jsonb_build_object('source','cron','at',now()),
      timeout_milliseconds := 10000
    );
  $cron$);
end $$;

commit;
