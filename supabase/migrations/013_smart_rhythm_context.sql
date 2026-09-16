-- SEVER v118: a checkpoint is an opportunity, not an obligation to send a push.
-- Keep the existing v115 RPC signature and delivery deduplication for deployed clients.
begin;

create or replace function public.sever_claim_due_rhythm_pushes_v115(p_limit integer default 100)
returns table(
  delivery_id bigint, subscription_id uuid, endpoint text, p256dh text,
  auth text, user_id uuid, timezone text, rhythm_kind text, local_date date,
  due_at timestamptz, total_tasks integer, pending_tasks integer,
  priority_tasks integer, next_task_title text, total_habits integer,
  completed_habits integer, pending_habits integer, next_habit_title text
)
language sql security invoker set search_path = public, pg_catalog, pg_temp
as $$
  with subscription_clock as (
    select ps.id subscription_id, ps.endpoint, ps.p256dh, ps.auth, ps.user_id,
      coalesce(tz.name, 'UTC') timezone,
      (now() at time zone coalesce(tz.name, 'UTC'))::date local_date,
      (now() at time zone coalesce(tz.name, 'UTC'))::time local_time
    from public.push_subscriptions ps
    left join pg_catalog.pg_timezone_names tz on tz.name = ps.timezone
    where ps.enabled
  ), slots as (
    select sc.*, slot.rhythm_kind,
      ((sc.local_date + slot.slot_time) at time zone sc.timezone) due_at
    from subscription_clock sc
    cross join lateral (values
      ('morning'::text, '08:30'::time),
      ('afternoon'::text, '14:00'::time),
      ('evening'::text, '20:30'::time)
    ) slot(rhythm_kind, slot_time)
  ), due as (
    select * from slots
    where due_at <= now() and due_at > now() - interval '10 minutes'
  ), context as (
    select d.*,
      (select count(*)::integer from public.tasks t
        where t.user_id=d.user_id and t.deleted_at is null
          and t.scheduled_for=d.local_date) total_tasks,
      (select count(*)::integer from public.tasks t
        where t.user_id=d.user_id and t.deleted_at is null
          and t.scheduled_for=d.local_date and t.completed) completed_tasks,
      -- Morning can describe the day's plan. Afternoon/evening count only
      -- unfinished tasks whose scheduled time has arrived (or is optional).
      (select count(*)::integer from public.tasks t
        where t.user_id=d.user_id and t.deleted_at is null
          and not t.completed and t.scheduled_for=d.local_date
          and (d.rhythm_kind='morning' or t.scheduled_time is null
            or t.scheduled_time <= d.local_time)) pending_tasks,
      -- The proposed NEXT action must be actionable, not merely important.
      -- In the morning, an event within 60 minutes can be worth preparing for;
      -- afternoon/evening leave future exact-time tasks to their own reminders.
      (select count(*)::integer from public.tasks t
        where t.user_id=d.user_id and t.deleted_at is null
          and not t.completed and t.priority and t.scheduled_for=d.local_date
          and (t.scheduled_time is null
            or (d.rhythm_kind='morning'
              and t.scheduled_time <= (d.local_time + interval '60 minutes')::time)
            or (d.rhythm_kind<>'morning' and t.scheduled_time <= d.local_time))) priority_tasks,
      (select t.title from public.tasks t
        where t.user_id=d.user_id and t.deleted_at is null
          and not t.completed and t.scheduled_for=d.local_date
          and (t.scheduled_time is null
            or (d.rhythm_kind='morning'
              and t.scheduled_time <= (d.local_time + interval '60 minutes')::time)
            or (d.rhythm_kind<>'morning' and t.scheduled_time <= d.local_time))
        order by t.priority desc, t.scheduled_time nulls last, t.created_at, t.id
        limit 1) next_task_title,
      (select count(*)::integer from public.habits h
        where h.user_id=d.user_id and h.deleted_at is null) total_habits,
      (select count(*)::integer from public.habits h
        where h.user_id=d.user_id and h.deleted_at is null
          and exists (select 1 from public.habit_entries he
            where he.user_id=d.user_id and he.habit_id=h.id
              and he.entry_date=d.local_date and he.deleted_at is null
              and he.completed)) completed_habits,
      (select h.title from public.habits h
        where h.user_id=d.user_id and h.deleted_at is null
          and not exists (select 1 from public.habit_entries he
            where he.user_id=d.user_id and he.habit_id=h.id
              and he.entry_date=d.local_date and he.deleted_at is null
              and he.completed)
        order by h.created_at, h.id limit 1) next_habit_title
    from due d
  ), eligible as (
    select c.*,
      greatest(c.total_habits-c.completed_habits,0)::integer pending_habits
    from context c
    where (
      -- Future-only timed plans have their own exact reminder: no generic
      -- morning push telling the user to start hours early.
      (c.rhythm_kind='morning' and
        (c.next_task_title is not null or c.total_habits>c.completed_habits))
      or (c.rhythm_kind='afternoon' and
        (c.pending_tasks>0 or c.total_habits>c.completed_habits))
      or (c.rhythm_kind='evening' and (
        c.pending_tasks>0 or c.total_habits>c.completed_habits
        or ((c.total_tasks>0 or c.total_habits>0)
          and c.completed_tasks=c.total_tasks
          and c.completed_habits=c.total_habits)
      ))
    )
      -- A recent exact-time notification speaks for SEVER at this checkpoint.
      and not exists (
        select 1 from public.push_deliveries pd
        where pd.subscription_id=c.subscription_id
          and pd.status in ('claimed','sent')
          and pd.due_at >= now()-interval '12 minutes'
          and pd.due_at <= now()+interval '1 minute'
      )
    order by c.due_at,c.subscription_id
    limit greatest(1,least(coalesce(p_limit,100),500))
  ), inserted as (
    insert into public.push_rhythm_deliveries
      (user_id,subscription_id,rhythm_kind,local_date,due_at)
    select user_id,subscription_id,rhythm_kind,local_date,due_at from eligible
    on conflict (subscription_id,rhythm_kind,local_date) do nothing
    returning id,subscription_id,rhythm_kind,local_date
  )
  select i.id,e.subscription_id,e.endpoint,e.p256dh,e.auth,e.user_id,
    e.timezone,e.rhythm_kind,e.local_date,e.due_at,e.total_tasks,
    e.pending_tasks,e.priority_tasks,e.next_task_title,e.total_habits,
    e.completed_habits,e.pending_habits,e.next_habit_title
  from inserted i
  join eligible e on e.subscription_id=i.subscription_id
    and e.rhythm_kind=i.rhythm_kind and e.local_date=i.local_date;
$$;

revoke all on function public.sever_claim_due_rhythm_pushes_v115(integer)
  from public, anon, authenticated;
grant execute on function public.sever_claim_due_rhythm_pushes_v115(integer)
  to service_role;

commit;
