begin;

create or replace function public.sever_claim_due_pushes_v96(p_limit integer default 100)
returns table(delivery_id bigint,subscription_id uuid,endpoint text,p256dh text,auth text,task_id uuid,user_id uuid,task_title text,task_category text,task_priority boolean,duration_minutes integer,scheduled_for date,scheduled_time time,reminder_kind text,due_at timestamptz)
language sql security definer set search_path = public, pg_catalog, pg_temp
as $$
  with candidate as (
    select ps.id subscription_id,ps.endpoint,ps.p256dh,ps.auth,t.id task_id,t.user_id,t.title task_title,
      coalesce(t.category,'') task_category,coalesce(t.priority,false) task_priority,t.duration_minutes,
      t.scheduled_for,t.scheduled_time,r.reminder_kind,r.due_at
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
    order by r.due_at,t.priority desc,t.id,ps.id
    limit greatest(1,least(coalesce(p_limit,100),500))
  ), inserted as (
    insert into public.push_deliveries(user_id,task_id,subscription_id,reminder_kind,due_at)
    select user_id,task_id,subscription_id,reminder_kind,due_at from candidate
    on conflict (task_id,subscription_id,reminder_kind,due_at) do nothing
    returning id,task_id,subscription_id,reminder_kind,due_at
  )
  select i.id,c.subscription_id,c.endpoint,c.p256dh,c.auth,c.task_id,c.user_id,c.task_title,c.task_category,c.task_priority,c.duration_minutes,c.scheduled_for,c.scheduled_time,c.reminder_kind,c.due_at
  from inserted i join candidate c on c.task_id=i.task_id and c.subscription_id=i.subscription_id and c.reminder_kind=i.reminder_kind and c.due_at=i.due_at;
$$;

revoke all on function public.sever_claim_due_pushes_v96(integer) from public, anon, authenticated;
grant execute on function public.sever_claim_due_pushes_v96(integer) to service_role;

commit;
