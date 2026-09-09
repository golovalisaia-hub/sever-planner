-- Apply BEFORE deploying the v55 client. Additive; no user rows are deleted.
-- Existing records remain readable without a backfill. v1 rows refuse legacy
-- whole-row UPDATEs rather than silently discarding another device's changes.
begin;

do $$
declare t text;
begin
  foreach t in array array['tasks','habits','habit_entries','note_folders','notes','focus_sessions','user_settings'] loop
    execute format('alter table public.%I add column if not exists sync_versions jsonb not null default ''{}''::jsonb',t);
    execute format('alter table public.%I drop constraint if exists sever_sync_versions_valid',t);
    execute format('alter table public.%I add constraint sever_sync_versions_valid check (jsonb_typeof(sync_versions)=''object'' and octet_length(sync_versions::text)<32768)',t);
  end loop;
end $$;

-- Canonical JSON matches the client's sorted-key serializer for tie breaking.
create or replace function public.sever_sync_canonical(j jsonb) returns text
language plpgsql immutable set search_path=public as $$
declare result text;
begin
  case jsonb_typeof(j)
  when 'array' then
    select '['||coalesce(string_agg(public.sever_sync_canonical(value),',' order by ord),'')||']'
      into result from jsonb_array_elements(j) with ordinality as e(value,ord);
  when 'object' then
    select '{'||coalesce(string_agg(to_jsonb(key)::text||':'||public.sever_sync_canonical(value),',' order by key collate "C"),'')||'}'
      into result from jsonb_each(j);
  else result:=coalesce(j::text,'null');
  end case;
  return result;
end $$;

create or replace function public.sever_sync_stamp_cmp(a jsonb,b jsonb) returns integer
language sql immutable set search_path=public as $$
  select case when coalesce((a->>0)::numeric,0)>coalesce((b->>0)::numeric,0) then 1
    when coalesce((a->>0)::numeric,0)<coalesce((b->>0)::numeric,0) then -1
    when coalesce(a->>1,'') collate "C">coalesce(b->>1,'') collate "C" then 1
    when coalesce(a->>1,'') collate "C"<coalesce(b->>1,'') collate "C" then -1 else 0 end;
$$;

create or replace function public.sever_sync_groups(t text) returns jsonb
language sql immutable set search_path=public as $$
select case t
when 'tasks' then '{"title":["title"],"date":["scheduled_for"],"time":["scheduled_time"],"duration":["duration_minutes"],"category":["category"],"priority":["priority"],"challenge":["challenge"],"completion":["completed","completed_at"]}'::jsonb
when 'habits' then '{"title":["title"]}'::jsonb
when 'habit_entries' then '{"completion":["completed"]}'::jsonb
when 'note_folders' then '{"name":["name"]}'::jsonb
when 'notes' then '{"folder":["folder_id"],"content":["title","body","kind","items","done","protected","secure"]}'::jsonb
when 'focus_sessions' then '{"session":["task_id","duration_minutes","started_at","completed_at","status"]}'::jsonb
when 'user_settings' then '{"data":["data"]}'::jsonb
else '{}'::jsonb end;
$$;

create or replace function public.sever_sync_legacy_meta(row_data jsonb,groups jsonb) returns jsonb
language plpgsql immutable set search_path=public as $$
declare stamp jsonb; fields jsonb;
begin
  stamp:=jsonb_build_array(floor(extract(epoch from (row_data->>'updated_at')::timestamptz)*1000),'');
  select jsonb_object_agg(key,stamp) into fields from jsonb_each(groups);
  return jsonb_build_object('v',1,'life',jsonb_build_object('generation',0,'deleted',row_data->>'deleted_at' is not null,'stamp',stamp),'fields',fields);
end $$;

create or replace function public.sever_keep_newest_update()
returns trigger language plpgsql security invoker set search_path=public as $$
declare
  a jsonb:=to_jsonb(old); b jsonb:=to_jsonb(new); output jsonb:=to_jsonb(old);
  groups jsonb:=public.sever_sync_groups(tg_table_name);
  am jsonb:=a->'sync_versions'; bm jsonb:=b->'sync_versions';
  meta jsonb; group_item record; col text; av jsonb; bv jsonb; winner jsonb; stamp jsonb;
  ag integer; bg integer; ad boolean; bd boolean; c integer;
begin
  if bm->>'v' is distinct from '1' then
    if am->>'v'='1' then
      raise exception 'SYNC_CLIENT_UPGRADE_REQUIRED' using errcode='40001';
    end if;
    if new.updated_at<old.updated_at then return old; end if;
    return new;
  end if;
  if am->>'v' is distinct from '1' then am:=public.sever_sync_legacy_meta(a,groups); end if;
  if jsonb_typeof(bm->'fields') is distinct from 'object' or jsonb_typeof(bm->'life') is distinct from 'object' then
    raise exception 'INVALID_SYNC_VERSIONS' using errcode='22023';
  end if;
  ag:=(am->'life'->>'generation')::integer; bg:=(bm->'life'->>'generation')::integer;
  ad:=(am->'life'->>'deleted')::boolean; bd:=(bm->'life'->>'deleted')::boolean;
  if ag is null or bg is null or bg<0 or bg>1000000 or ad is null or bd is null or
    bd is distinct from (new.deleted_at is not null) then
    raise exception 'INVALID_SYNC_LIFECYCLE' using errcode='22023';
  end if;
  -- Delete wins within a generation. Undo explicitly advances the generation.
  if ag>bg or (ag=bg and ad and not bd) then return old; end if;
  if bg>ag or (ag=bg and bd and not ad) then return new; end if;
  meta:=jsonb_build_object('v',1,'life',
    case when public.sever_sync_stamp_cmp(am->'life'->'stamp',bm->'life'->'stamp')>=0 then am->'life' else bm->'life' end,
    'fields','{}'::jsonb);
  for group_item in select * from jsonb_each(groups) loop
    av:='[]'::jsonb; bv:='[]'::jsonb;
    for col in select jsonb_array_elements_text(group_item.value) loop
      if col in ('completed_at','started_at') then
        av:=av||jsonb_build_array(floor(extract(epoch from (a->>col)::timestamptz)*1000));
        bv:=bv||jsonb_build_array(floor(extract(epoch from (b->>col)::timestamptz)*1000));
      else av:=av||jsonb_build_array(a->col); bv:=bv||jsonb_build_array(b->col);
      end if;
    end loop;
    -- A legacy PATCH/UPSERT can inherit the old metadata when it omits the
    -- column. Never let changed values masquerade as the same operation.
    if a->'sync_versions'->>'v'='1' and am=bm and av is distinct from bv then
      raise exception 'SYNC_CLIENT_UPGRADE_REQUIRED' using errcode='40001';
    end if;
    c:=public.sever_sync_stamp_cmp(am->'fields'->group_item.key,bm->'fields'->group_item.key);
    if c>0 or (c=0 and public.sever_sync_canonical(av) collate "C">=public.sever_sync_canonical(bv) collate "C") then
      winner:=a;stamp:=am->'fields'->group_item.key;
    else winner:=b;stamp:=bm->'fields'->group_item.key;
    end if;
    for col in select jsonb_array_elements_text(group_item.value) loop
      output:=jsonb_set(output,array[col],coalesce(winner->col,'null'::jsonb));
    end loop;
    meta:=jsonb_set(meta,array['fields',group_item.key],coalesce(stamp,'[0,""]'::jsonb));
  end loop;
  output:=output||jsonb_build_object('sync_versions',meta,'updated_at',greatest(old.updated_at,new.updated_at),
    'deleted_at',case when ad then to_timestamp((meta->'life'->'stamp'->>0)::numeric/1000) else null end);
  new:=jsonb_populate_record(new,output);
  return new;
end $$;

create or replace function public.sever_validate_sync_versions() returns trigger
language plpgsql security invoker set search_path=public as $$
declare m jsonb:=new.sync_versions; s jsonb; k text;
begin
  if m='{}'::jsonb then return new; end if;
  if m->>'v' is distinct from '1' or jsonb_typeof(m->'fields') is distinct from 'object'
    or jsonb_typeof(m->'life') is distinct from 'object'
    or coalesce(m->'life'->>'generation','') !~ '^[0-9]{1,6}$'
    or jsonb_typeof(m->'life'->'deleted') is distinct from 'boolean'
    or (m->'life'->>'deleted')::boolean is distinct from (new.deleted_at is not null) then
    raise exception 'INVALID_SYNC_VERSIONS' using errcode='22023';
  end if;
  for k in select jsonb_object_keys(public.sever_sync_groups(tg_table_name)) loop
    if not (m->'fields' ? k) then raise exception 'MISSING_FIELD_VERSION' using errcode='22023'; end if;
  end loop;
  for s in select value from jsonb_each(m->'fields') union all select m->'life'->'stamp' loop
    if jsonb_typeof(s) is distinct from 'array' or jsonb_array_length(s)<>2
      or jsonb_typeof(s->0) is distinct from 'number' or jsonb_typeof(s->1) is distinct from 'string'
      or (s->>0)::numeric<0 or (s->>0)::numeric>8640000000000000 or trunc((s->>0)::numeric)<>(s->>0)::numeric
      or length(s->>1)>128 or (s->>1) !~ '^[a-zA-Z0-9-]*$' then
      raise exception 'INVALID_FIELD_STAMP' using errcode='22023';
    end if;
  end loop;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['tasks','habits','habit_entries','note_folders','notes','focus_sessions','user_settings'] loop
    execute format('drop trigger if exists sever_00_validate_versions on public.%I',t);
    execute format('create trigger sever_00_validate_versions before insert or update on public.%I for each row execute function public.sever_validate_sync_versions()',t);
  end loop;
end $$;

-- Read-only deployment handshake: old-schema clients must never be published.
create or replace function public.sever_sync_protocol() returns integer
language sql stable security invoker set search_path=public as $$select 1$$;
revoke all on function public.sever_sync_protocol() from public;
grant execute on function public.sever_sync_protocol() to anon,authenticated;
commit;
