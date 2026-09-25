-- IZI Planner · 003 · pending actions, activity log, transactional apply and undo.
--
-- Preview -> Confirm -> Apply. A pending action stores the exact operations the
-- user saw; confirming applies the selected ones in ONE database call:
-- either every selected operation is applied (and logged) or nothing is.
-- This fixes TAVRO audit finding T3 (draft marked confirmed, then records
-- inserted one by one through independent requests).

-- --------------------------------------------------------- entity registry --
-- Closed set of record types. Must mirror src/modules/*/spec.ts (tested).

create or replace function izi.entity_table(p_entity text) returns text
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select case p_entity
    when 'task' then 'tasks' when 'event' then 'events'
    when 'note' then 'notes' when 'inbox_item' then 'inbox_items'
  end
$$;

create or replace function izi.entity_writable_columns(p_entity text) returns text[]
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select case p_entity
    when 'task' then array['title', 'notes', 'status', 'priority', 'plan_date', 'plan_precision', 'plan_time',
                           'part_of_day', 'due_date', 'due_time', 'duration_minutes', 'timezone']
    when 'event' then array['title', 'notes', 'start_date', 'start_time', 'part_of_day', 'duration_minutes',
                            'timezone', 'location', 'participants', 'status']
    when 'note' then array['title', 'body', 'tags']
    when 'inbox_item' then array['text', 'status']
  end
$$;

-- ---------------------------------------------------------- pending actions --

create table if not exists izi.pending_actions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references izi.accounts(id) on delete cascade,
  kind text not null check (kind in ('capture', 'mutation', 'conversion')),
  channel text not null check (channel in ('telegram', 'miniapp', 'quick_capture', 'import', 'system')),
  capture_id uuid,
  status text not null default 'pending' check (status in ('pending', 'applied', 'discarded', 'expired', 'undone')),
  -- Opaque handle for chat buttons (Telegram callback_data is limited to 64 bytes).
  short_token text not null default replace(gen_random_uuid()::text, '-', '') check (short_token ~ '^[0-9a-f]{32}$'),
  idempotency_key text check (idempotency_key ~ '^[A-Za-z0-9:_.-]{1,128}$'),
  operations jsonb not null check (jsonb_typeof(operations) = 'array' and jsonb_array_length(operations) between 1 and 50),
  selected integer[],
  result jsonb,
  expires_at timestamptz not null,
  undo_window interval not null default interval '10 minutes'
    check (undo_window between interval '10 minutes' and interval '1 day'),
  applied_at timestamptz,
  undo_until timestamptz,
  discarded_at timestamptz,
  undone_at timestamptz,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pending_actions_short_token_key unique (short_token),
  constraint pending_actions_account_id_key unique (account_id, id),
  constraint pending_actions_idempotency_key unique (account_id, idempotency_key),
  constraint pending_actions_capture_fk foreign key (account_id, capture_id) references izi.captures(account_id, id),
  constraint pending_actions_capture_kind check (kind <> 'capture' or capture_id is not null),
  constraint pending_actions_expiry check (expires_at > created_at and expires_at <= created_at + interval '7 days'),
  constraint pending_actions_applied check (status not in ('applied', 'undone') or (applied_at is not null and undo_until is not null and result is not null))
);
create index if not exists pending_actions_account_status_idx on izi.pending_actions(account_id, status, created_at desc);
create index if not exists pending_actions_expiry_idx on izi.pending_actions(expires_at) where status = 'pending';
create index if not exists pending_actions_capture_idx on izi.pending_actions(account_id, capture_id) where capture_id is not null;

-- What was previewed is what gets applied: operations are immutable, and the
-- status moves only forward.
create or replace function izi.pending_actions_guard() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then raise exception 'INVALID_STATE' using errcode = 'IZ423'; end if;
    new.selected := null; new.result := null;
    new.applied_at := null; new.undo_until := null; new.discarded_at := null; new.undone_at := null;
    return new;
  end if;
  if new.operations is distinct from old.operations or new.kind is distinct from old.kind
     or new.channel is distinct from old.channel or new.capture_id is distinct from old.capture_id
     or new.short_token is distinct from old.short_token or new.idempotency_key is distinct from old.idempotency_key
     or new.expires_at is distinct from old.expires_at or new.undo_window is distinct from old.undo_window then
    raise exception 'IMMUTABLE_FIELD' using errcode = 'IZ422';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'pending' and new.status in ('applied', 'discarded', 'expired'))
    or (old.status = 'applied' and new.status = 'undone')) then
    raise exception 'INVALID_STATE' using errcode = 'IZ423';
  end if;
  return new;
end $$;

create or replace trigger t10_touch before update on izi.pending_actions
  for each row execute function izi.touch_versioned();
create or replace trigger t20_rules before insert or update on izi.pending_actions
  for each row execute function izi.pending_actions_guard();

-- ------------------------------------------------------------- activity log --
-- Append-only history: foundation for Undo, audit, Trends and Memory. It keeps
-- only the changed columns of a record (never capture raw text), and after
-- 30 days text-bearing values are redacted while dates, statuses and the fact
-- of the change remain.

create table if not exists izi.activity_log (
  id bigint generated always as identity primary key,
  account_id uuid not null references izi.accounts(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  local_date date,
  local_hour smallint check (local_hour between 0 and 23),
  actor text not null check (actor in ('user', 'system')),
  channel text not null check (channel in ('telegram', 'miniapp', 'quick_capture', 'import', 'system')),
  entity_type text not null check (entity_type in ('task', 'event', 'note', 'inbox_item')),
  entity_id uuid not null,
  action text not null check (action in ('create', 'update', 'delete', 'restore', 'undo')),
  changed_fields text[] not null default '{}',
  before_state jsonb,
  after_state jsonb,
  pending_action_id uuid,
  correlation_id uuid,
  undo_of bigint references izi.activity_log(id),
  payload_expires_at timestamptz not null default now() + interval '30 days',
  payload_redacted_at timestamptz,
  constraint activity_log_pending_action_fk foreign key (account_id, pending_action_id)
    references izi.pending_actions(account_id, id) on delete set null (pending_action_id),
  constraint activity_log_payload_retention check (payload_expires_at <= occurred_at + interval '30 days')
);
create index if not exists activity_log_account_time_idx on izi.activity_log(account_id, occurred_at desc);
create index if not exists activity_log_entity_idx on izi.activity_log(account_id, entity_type, entity_id, id desc);
create index if not exists activity_log_action_idx on izi.activity_log(account_id, pending_action_id) where pending_action_id is not null;
create index if not exists activity_log_undo_of_idx on izi.activity_log(undo_of) where undo_of is not null;
create index if not exists activity_log_redaction_idx on izi.activity_log(payload_expires_at) where payload_redacted_at is null;

create or replace function izi.activity_log_guard() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare v_frozen text[] := array['before_state', 'after_state', 'payload_redacted_at', 'pending_action_id'];
begin
  if (to_jsonb(new) - v_frozen) is distinct from (to_jsonb(old) - v_frozen) then
    raise exception 'IMMUTABLE_FIELD' using errcode = 'IZ422';
  end if;
  -- The only allowed changes: the link to a purged pending action becomes
  -- null, and payloads are redacted (never rewritten).
  if new.pending_action_id is not null and new.pending_action_id is distinct from old.pending_action_id then
    raise exception 'IMMUTABLE_FIELD' using errcode = 'IZ422';
  end if;
  if (new.before_state is distinct from old.before_state or new.after_state is distinct from old.after_state)
     and new.payload_redacted_at is null then
    raise exception 'IMMUTABLE_FIELD' using errcode = 'IZ422';
  end if;
  return new;
end $$;

create or replace trigger t10_guard before update on izi.activity_log
  for each row execute function izi.activity_log_guard();

-- Keys that hold user-written text; removed from payloads after retention.
create or replace function izi._text_keys() returns text[]
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select array['title', 'notes', 'body', 'text', 'location', 'participants', 'tags']
$$;

create or replace function izi._pick(p_row jsonb, p_keys text[]) returns jsonb
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    from jsonb_each(coalesce(p_row, '{}'::jsonb)) e where e.key = any(p_keys)
$$;

-- Columns that differ between two row images (ignoring bookkeeping columns).
create or replace function izi._changed(p_before jsonb, p_after jsonb) returns text[]
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select coalesce(array_agg(e.key order by e.key), '{}')
    from jsonb_each(p_after) e
   where e.key not in ('version', 'updated_at', 'created_at', 'account_id', 'search_vector', 'id')
     and (p_before -> e.key) is distinct from e.value
$$;

create or replace function izi._log(
  p_account uuid, p_action uuid, p_channel text, p_entity text, p_id uuid, p_kind text,
  p_fields text[], p_before jsonb, p_after jsonb, p_correlation uuid, p_undo_of bigint
) returns bigint
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare v_local timestamp; v_id bigint; v_timezone text := izi.account_timezone(p_account);
begin
  if v_timezone is not null then v_local := now() at time zone v_timezone; end if;
  insert into izi.activity_log (account_id, actor, channel, entity_type, entity_id, action, changed_fields,
                                before_state, after_state, pending_action_id, correlation_id, undo_of, local_date, local_hour)
  values (p_account, 'user', p_channel, p_entity, p_id, p_kind, coalesce(p_fields, '{}'),
          p_before, p_after, p_action, p_correlation, p_undo_of, v_local::date, extract(hour from v_local)::smallint)
  returning id into v_id;
  return v_id;
end $$;

-- ----------------------------------------------------------- record writes --

create or replace function izi._assert_columns(p_entity text, p_data jsonb, p_extra text[] default '{}') returns text[]
language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
declare v_allowed text[] := izi.entity_writable_columns(p_entity) || p_extra; v_columns text[];
begin
  if v_allowed is null or p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'VALIDATION' using errcode = 'IZ422';
  end if;
  select coalesce(array_agg(k order by k), '{}') into v_columns from jsonb_object_keys(p_data) as k;
  if exists (select 1 from unnest(v_columns) as c where not (c = any(v_allowed))) then
    raise exception 'UNKNOWN_FIELD' using errcode = 'IZ422';
  end if;
  return v_columns;
end $$;

create or replace function izi._insert_record(p_account uuid, p_entity text, p_data jsonb, p_channel text, p_capture uuid)
returns jsonb
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare v_table text := izi.entity_table(p_entity); v_columns text[]; v_row jsonb;
begin
  v_columns := izi._assert_columns(p_entity, p_data);
  execute format(
    'insert into izi.%I as t (account_id, source, capture_id%s) select $1, $2, $3%s '
    'from jsonb_populate_record(null::izi.%I, $4) as r returning to_jsonb(t.*)',
    v_table,
    coalesce((select string_agg(', ' || quote_ident(c), '' order by c) from unnest(v_columns) as c), ''),
    coalesce((select string_agg(', r.' || quote_ident(c), '' order by c) from unnest(v_columns) as c), ''),
    v_table)
  into v_row using p_account, p_channel, p_capture, p_data;
  return v_row;
end $$;

-- Locks the live row owned by p_account and checks the version the user saw.
create or replace function izi._lock_record(p_account uuid, p_entity text, p_id uuid, p_expected integer, p_deleted boolean)
returns jsonb
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare v_row jsonb;
begin
  if p_id is null or p_expected is null then raise exception 'VALIDATION' using errcode = 'IZ422'; end if;
  execute format('select to_jsonb(t.*) from izi.%I as t where t.id = $1 and t.account_id = $2 and (t.deleted_at is not null) = $3 for update',
                 izi.entity_table(p_entity))
    into v_row using p_id, p_account, p_deleted;
  if v_row is null then raise exception 'NOT_FOUND' using errcode = 'IZ404'; end if;
  if (v_row ->> 'version')::integer <> p_expected then
    raise exception 'VERSION_CONFLICT' using errcode = 'IZ409';
  end if;
  return v_row;
end $$;

create or replace function izi._update_record(p_account uuid, p_entity text, p_id uuid, p_patch jsonb, p_columns text[])
returns jsonb
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare v_table text := izi.entity_table(p_entity); v_row jsonb;
begin
  if cardinality(p_columns) = 0 then raise exception 'VALIDATION' using errcode = 'IZ422'; end if;
  execute format(
    'update izi.%I as t set %s from jsonb_populate_record(null::izi.%I, $1) as r '
    'where t.id = $2 and t.account_id = $3 returning to_jsonb(t.*)',
    v_table,
    (select string_agg(format('%I = r.%I', c, c), ', ' order by c) from unnest(p_columns) as c),
    v_table)
  into v_row using p_patch, p_id, p_account;
  if v_row is null then raise exception 'NOT_FOUND' using errcode = 'IZ404'; end if;
  return v_row;
end $$;

-- Applies one validated operation and logs it. Raises on any problem, which
-- rolls back the whole enclosing apply.
create or replace function izi._apply_operation(p_account uuid, p_action uuid, p_channel text, p_capture uuid, p_op jsonb, p_index integer)
returns jsonb
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  v_kind text := p_op ->> 'op';
  v_entity text := p_op ->> 'entity';
  v_id uuid;
  v_expected integer;
  v_before jsonb; v_after jsonb; v_fields text[]; v_target text; v_created jsonb; v_link jsonb;
  v_correlation uuid := gen_random_uuid();
begin
  if izi.entity_table(v_entity) is null then raise exception 'VALIDATION' using errcode = 'IZ422'; end if;
  if v_kind <> 'create' then
    v_id := (p_op ->> 'id')::uuid;
    v_expected := (p_op ->> 'expected_version')::integer;
  end if;

  if v_kind = 'create' then
    v_after := izi._insert_record(p_account, v_entity, p_op -> 'data', p_channel, p_capture);
    v_fields := izi._changed('{}'::jsonb, v_after - 'search_vector');
    perform izi._log(p_account, p_action, p_channel, v_entity, (v_after ->> 'id')::uuid, 'create',
                     v_fields, null, izi._pick(v_after, v_fields || array['id', 'version']), v_correlation, null);
    return jsonb_build_object('index', p_index, 'op', v_kind, 'entity', v_entity,
                              'id', v_after ->> 'id', 'version', (v_after ->> 'version')::integer);
  end if;

  if v_kind = 'update' then
    v_before := izi._lock_record(p_account, v_entity, v_id, v_expected, false);
    v_after := izi._update_record(p_account, v_entity, v_id, p_op -> 'patch', izi._assert_columns(v_entity, p_op -> 'patch'));
  elsif v_kind in ('delete', 'restore') then
    v_before := izi._lock_record(p_account, v_entity, v_id, v_expected, v_kind = 'restore');
    v_after := izi._update_record(p_account, v_entity, v_id,
                 jsonb_build_object('deleted_at', case when v_kind = 'delete' then now() end), array['deleted_at']);
  elsif v_kind = 'convert' then
    v_target := p_op -> 'into' ->> 'entity';
    if v_entity <> 'inbox_item' or v_target is null or v_target not in ('task', 'event', 'note') then
      raise exception 'VALIDATION' using errcode = 'IZ422';
    end if;
    v_before := izi._lock_record(p_account, v_entity, v_id, v_expected, false);
    if v_before ->> 'status' = 'converted' then raise exception 'INVALID_STATE' using errcode = 'IZ423'; end if;
    v_created := izi._insert_record(p_account, v_target, p_op -> 'into' -> 'data', p_channel, p_capture);
    v_fields := izi._changed('{}'::jsonb, v_created - 'search_vector');
    perform izi._log(p_account, p_action, p_channel, v_target, (v_created ->> 'id')::uuid, 'create',
                     v_fields, null, izi._pick(v_created, v_fields || array['id', 'version']), v_correlation, null);
    v_link := jsonb_build_object('status', 'converted', 'converted_entity', v_target,
                                 'converted_' || v_target || '_id', v_created ->> 'id');
    v_after := izi._update_record(p_account, v_entity, v_id, v_link, array(select jsonb_object_keys(v_link)));
  else
    raise exception 'VALIDATION' using errcode = 'IZ422';
  end if;

  v_fields := izi._changed(v_before, v_after);
  perform izi._log(p_account, p_action, p_channel, v_entity, v_id,
                   case v_kind when 'convert' then 'update' else v_kind end,
                   v_fields, izi._pick(v_before, v_fields || array['version']), izi._pick(v_after, v_fields || array['version']),
                   v_correlation, null);
  return jsonb_build_object('index', p_index, 'op', v_kind, 'entity', v_entity, 'id', v_id,
                            'version', (v_after ->> 'version')::integer)
         || case when v_created is not null
              then jsonb_build_object('created', jsonb_build_object('entity', v_target, 'id', v_created ->> 'id',
                                                                    'version', (v_created ->> 'version')::integer))
              else '{}'::jsonb end;
end $$;

-- ------------------------------------------------------------ public API ----

-- Confirms a pending action. One call = one transaction: all selected
-- operations are applied and logged, the action becomes `applied`, the capture
-- becomes `confirmed` — or, on any error, nothing changes at all.
-- A repeated confirm returns the stored result without applying again.
create or replace function izi.apply_pending_action(p_account uuid, p_action uuid, p_selection integer[] default null)
returns jsonb
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  a izi.pending_actions%rowtype;
  v_count integer;
  v_selection integer[];
  v_index integer;
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  select * into a from izi.pending_actions p where p.id = p_action and p.account_id = p_account for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'IZ404'; end if;
  if a.status = 'applied' then return a.result || jsonb_build_object('replayed', true); end if;
  if a.status <> 'pending' then raise exception 'INVALID_STATE' using errcode = 'IZ423'; end if;
  if a.expires_at <= now() then raise exception 'ACTION_EXPIRED' using errcode = 'IZ410'; end if;

  v_count := jsonb_array_length(a.operations);
  if p_selection is null then
    select array_agg(i order by i) into v_selection from generate_series(0, v_count - 1) as i;
  else
    select array_agg(distinct i order by i) into v_selection from unnest(p_selection) as i;
    if coalesce(cardinality(v_selection), 0) = 0 or cardinality(v_selection) <> cardinality(p_selection)
       or exists (select 1 from unnest(v_selection) as i where i is null or i < 0 or i >= v_count) then
      raise exception 'VALIDATION' using errcode = 'IZ422';
    end if;
  end if;

  foreach v_index in array v_selection loop
    v_results := v_results || jsonb_build_array(
      izi._apply_operation(p_account, a.id, a.channel, a.capture_id, a.operations -> v_index, v_index));
  end loop;

  if a.capture_id is not null then
    update izi.captures c set status = 'confirmed'
     where c.id = a.capture_id and c.account_id = p_account and c.status = 'preview';
    if not found then raise exception 'INVALID_STATE' using errcode = 'IZ423'; end if;
  end if;

  v_result := jsonb_build_object('action_id', a.id, 'status', 'applied', 'operations', v_results,
                                 'undo_until', now() + a.undo_window);
  update izi.pending_actions p
     set status = 'applied', selected = v_selection, result = v_result,
         applied_at = now(), undo_until = now() + a.undo_window
   where p.id = a.id;
  return v_result || jsonb_build_object('replayed', false);
end $$;

create or replace function izi.discard_pending_action(p_account uuid, p_action uuid) returns text
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare a izi.pending_actions%rowtype;
begin
  select * into a from izi.pending_actions p where p.id = p_action and p.account_id = p_account for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'IZ404'; end if;
  if a.status = 'discarded' then return 'discarded'; end if;
  if a.status <> 'pending' then raise exception 'INVALID_STATE' using errcode = 'IZ423'; end if;
  update izi.pending_actions p set status = 'discarded', discarded_at = now() where p.id = a.id;
  if a.capture_id is not null then
    update izi.captures c set status = 'discarded'
     where c.id = a.capture_id and c.account_id = p_account and c.status in ('preview', 'needs_clarification');
  end if;
  return 'discarded';
end $$;

-- Reverts an applied action within its undo window, newest change first.
-- If any affected record changed after the action, nothing is reverted
-- (UNDO_CONFLICT): newer user changes are never silently destroyed.
create or replace function izi.undo_pending_action(p_account uuid, p_action uuid) returns jsonb
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  a izi.pending_actions%rowtype;
  e izi.activity_log%rowtype;
  v_key text; v_expected integer; v_current jsonb; v_after jsonb; v_fields text[]; v_restore jsonb;
  v_versions jsonb := '{}'::jsonb;
  v_count integer := 0;
begin
  select * into a from izi.pending_actions p where p.id = p_action and p.account_id = p_account for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'IZ404'; end if;
  if a.status = 'undone' then
    return jsonb_build_object('action_id', a.id, 'status', 'undone', 'replayed', true);
  end if;
  if a.status <> 'applied' then raise exception 'INVALID_STATE' using errcode = 'IZ423'; end if;
  if now() > a.undo_until then raise exception 'UNDO_EXPIRED' using errcode = 'IZ410'; end if;

  perform set_config('izi.restoring', 'on', true);
  for e in
    select * from izi.activity_log l
     where l.account_id = p_account and l.pending_action_id = a.id and l.action <> 'undo'
     order by l.id desc
  loop
    v_key := e.entity_type || ':' || e.entity_id;
    -- A record touched twice inside one action: expect the version our own
    -- previous revert produced.
    v_expected := coalesce((v_versions ->> v_key)::integer, (e.after_state ->> 'version')::integer);
    execute format('select to_jsonb(t.*) from izi.%I as t where t.id = $1 and t.account_id = $2 for update',
                   izi.entity_table(e.entity_type))
      into v_current using e.entity_id, p_account;
    if v_current is null or v_expected is null or (v_current ->> 'version')::integer <> v_expected then
      raise exception 'UNDO_CONFLICT' using errcode = 'IZ409';
    end if;

    if e.action = 'create' then
      v_fields := array['deleted_at'];
      v_restore := jsonb_build_object('deleted_at', now());
    else
      v_fields := e.changed_fields;
      v_restore := izi._pick(e.before_state, e.changed_fields);
    end if;

    if cardinality(v_fields) > 0 then
      v_after := izi._update_record(p_account, e.entity_type, e.entity_id, v_restore, v_fields);
    else
      v_after := v_current;
    end if;
    v_versions := v_versions || jsonb_build_object(v_key, (v_after ->> 'version')::integer);
    perform izi._log(p_account, a.id, a.channel, e.entity_type, e.entity_id, 'undo', v_fields,
                     izi._pick(v_current, v_fields || array['version']), izi._pick(v_after, v_fields || array['version']),
                     e.correlation_id, e.id);
    v_count := v_count + 1;
  end loop;
  perform set_config('izi.restoring', 'off', true);

  update izi.pending_actions p set status = 'undone', undone_at = now() where p.id = a.id;
  return jsonb_build_object('action_id', a.id, 'status', 'undone', 'reverted', v_count, 'replayed', false);
end $$;

-- --------------------------------------------------------- housekeeping ------
-- Scheduled in a later phase (pg_cron); never on a user's request path.

create or replace function izi.expire_pending_actions(p_now timestamptz default now(), p_limit integer default 1000)
returns integer
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare v_count integer;
begin
  with expired as (
    update izi.pending_actions p set status = 'expired'
     where p.id in (
       select q.id from izi.pending_actions q
        where q.status = 'pending' and q.expires_at <= p_now
        order by q.expires_at
        limit greatest(1, least(coalesce(p_limit, 1000), 10000))
        for update skip locked)
    returning p.account_id, p.capture_id
  ), captures as (
    update izi.captures c set status = 'expired'
      from expired x
     where x.capture_id is not null and c.account_id = x.account_id and c.id = x.capture_id
       and c.status in ('preview', 'needs_clarification')
    returning 1
  )
  select count(*) into v_count from expired;
  return v_count;
end $$;

-- Terminal pending actions older than p_before are removed; their operations
-- (which contain record values) do not outlive the activity-log retention.
create or replace function izi.purge_pending_actions(p_before timestamptz)
returns integer
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare v_count integer;
begin
  delete from izi.pending_actions p
   where p.updated_at < p_before
     and (p.status in ('discarded', 'expired', 'undone') or (p.status = 'applied' and p.undo_until < p_before));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- The only way to change an activity-log row's payload. SECURITY DEFINER
-- because the server role has no UPDATE privilege on the append-only log.
create or replace function izi.redact_activity_payloads(p_now timestamptz default now(), p_limit integer default 5000)
returns integer
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare v_count integer;
begin
  update izi.activity_log l
     set before_state = l.before_state - izi._text_keys(),
         after_state = l.after_state - izi._text_keys(),
         payload_redacted_at = p_now
   where l.id in (
     select q.id from izi.activity_log q
      where q.payload_redacted_at is null and q.payload_expires_at <= p_now
      order by q.id
      limit greatest(1, least(coalesce(p_limit, 5000), 50000)));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

select izi._secure_schema();
