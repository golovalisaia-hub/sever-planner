-- SEVER AI foundation. Apply once, after 002, in a transaction.
begin;
alter table public.profiles add column if not exists role text not null default 'user'
  check (role in ('owner','user'));
alter table public.tasks add column if not exists scheduled_time time;

drop policy if exists "profiles are private" on public.profiles;
drop policy if exists "profiles are readable by self" on public.profiles;
create policy "profiles are readable by self" on public.profiles for select to authenticated
  using (id = auth.uid());
-- No client INSERT/UPDATE/DELETE grant: signup trigger creates profiles.
revoke insert, update, delete on public.profiles from anon, authenticated;
create unique index if not exists profiles_single_owner on public.profiles(role) where role = 'owner';

create table if not exists public.ai_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 300),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.ai_plans (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('financial_goal','reading','study','habit','project')),
  title text not null check (char_length(title) between 1 and 160),
  data jsonb not null,
  status text not null default 'active' check (status in ('active','paused','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table if not exists public.ai_usage (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  model text not null,
  latency_ms integer not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  tool text,
  success boolean not null default false,
  error_code text,
  created_at timestamptz not null default now()
);
alter table public.ai_memories enable row level security;
alter table public.ai_plans enable row level security;
alter table public.ai_usage enable row level security;
create policy "ai memories are private" on public.ai_memories for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "ai plans are private" on public.ai_plans for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "ai usage is readable by self" on public.ai_usage for select to authenticated
  using (user_id = auth.uid());
revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;
grant all on public.ai_usage to service_role;
grant select,insert,update,delete on public.ai_memories,public.ai_plans to authenticated;
create index if not exists ai_usage_rate_idx on public.ai_usage(user_id,created_at desc);
create index if not exists ai_memories_user_idx on public.ai_memories(user_id);
create index if not exists ai_plans_user_idx on public.ai_plans(user_id);

-- Reserved before contacting the provider, including failed calls. The role,
-- per-minute and daily limits are computed inside the database.
create or replace function public.sever_claim_ai_quota(p_request_id uuid,p_provider text,p_model text)
returns boolean language plpgsql security definer set search_path = public as $$
declare caller uuid := auth.uid(); owner boolean; minute_count integer; day_count integer; global_count integer;
begin
  if caller is null then raise exception 'authentication required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(78142201);
  if exists(select 1 from public.ai_usage where request_id=p_request_id) then
    raise exception 'request already attempted' using errcode='23505';
  end if;
  select role='owner' into owner from public.profiles where id=caller;
  select count(*) into minute_count from public.ai_usage
    where user_id=caller and created_at>=now()-interval '1 minute';
  select count(*) into day_count from public.ai_usage
    where user_id=caller and created_at>=date_trunc('day',now());
  select count(*) into global_count from public.ai_usage where created_at>=date_trunc('day',now());
  if minute_count >= (case when owner then 10 else 3 end)
    or day_count >= (case when owner then 150 else 30 end) or global_count >= 450 then return false; end if;
  insert into public.ai_usage(request_id,user_id,provider,model)
    values(p_request_id,caller,left(p_provider,40),left(p_model,100));
  return true;
end;
$$;
revoke all on function public.sever_claim_ai_quota(uuid,text,text) from public,anon;
grant execute on function public.sever_claim_ai_quota(uuid,text,text) to authenticated;

-- Server transaction: plan and related task records are committed together.
-- The caller supplies no user_id; repeat confirmation returns the existing plan.
create or replace function public.sever_create_ai_plan(p_plan jsonb,p_tasks jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare caller uuid:=auth.uid(); plan_id uuid:=(p_plan->>'id')::uuid; row jsonb; result jsonb;
begin
  if caller is null then raise exception 'authentication required' using errcode='42501'; end if;
  if jsonb_array_length(p_tasks)>90 then raise exception 'too many tasks'; end if;
  perform pg_advisory_xact_lock(hashtextextended(caller::text,0));
  select to_jsonb(p) into result from public.ai_plans p where id=plan_id and user_id=caller;
  if result is not null then return result; end if;
  insert into public.ai_plans(id,user_id,kind,title,data)
    values(plan_id,caller,p_plan->>'kind',p_plan->>'title',p_plan->'data');
  for row in select value from jsonb_array_elements(p_tasks) loop
    insert into public.tasks(id,user_id,title,scheduled_for,scheduled_time,duration_minutes,category)
      values((row->>'id')::uuid,caller,row->>'title',(row->>'date')::date,
        nullif(row->>'time','')::time,nullif(row->>'durationMinutes','')::integer,'Личное');
  end loop;
  select to_jsonb(p) into result from public.ai_plans p where id=plan_id and user_id=caller;
  return result;
end;
$$;
revoke all on function public.sever_create_ai_plan(jsonb,jsonb) from public,anon;
grant execute on function public.sever_create_ai_plan(jsonb,jsonb) to authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,email,role) values(new.id,new.email,'user')
    on conflict(id) do update set email=excluded.email,updated_at=now();
  return new;
end;
$$;
-- Service-only aggregate; contains no personal content or account identifiers.
create or replace function public.sever_ai_system_usage()
returns jsonb language sql security definer set search_path=public as $$
  select jsonb_build_object('requestsToday',count(*),'successful',count(*) filter(where success),
    'failedOrPending',count(*) filter(where not success),'inputTokens',coalesce(sum(input_tokens),0),
    'outputTokens',coalesce(sum(output_tokens),0),'averageLatencyMs',coalesce(round(avg(latency_ms)),0))
  from public.ai_usage where created_at>=date_trunc('day',now());
$$;
revoke all on function public.sever_ai_system_usage() from public,anon,authenticated;
grant execute on function public.sever_ai_system_usage() to service_role;
commit;
-- OWNER assignment intentionally lives in a separate private admin operation.
-- Resolve the supplied email once; assign the verified UUID, never email metadata.
