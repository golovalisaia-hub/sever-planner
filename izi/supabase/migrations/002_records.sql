-- IZI Planner · 002 · record tables: tasks, events, notes, inbox items.
--
-- Typed tables, not one generic `records(type, jsonb)`. Shared conventions:
--   account_id on every row; unique (account_id, id) so other rows can point at
--   a record with a composite foreign key that also proves same ownership;
--   source (channel) + capture_id (provenance); version (optimistic
--   concurrency, bumped by trigger on every update); created/updated/deleted_at.
-- Records are written only through izi.apply_pending_action (003), which logs
-- every change in izi.activity_log.

-- ---------------------------------------------------------------- helpers ---

create or replace function izi.text_items_ok(p_items text[], p_max_length integer) returns boolean
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select coalesce(bool_and(item is not null and char_length(btrim(item)) between 1 and p_max_length), true)
    from unnest(p_items) as item
$$;

-- Server-owned fields on insert: clients cannot pre-set version or deletion.
create or replace function izi.record_before_insert() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  new.version := 1;
  new.deleted_at := null;
  new.created_at := now();
  new.updated_at := now();
  return new;
end $$;

-- Undo restores an earlier state verbatim, including derived columns; inside
-- izi.undo_pending_action this transaction-local flag disables re-derivation.
create or replace function izi.is_restoring() returns boolean
language sql stable set search_path = pg_catalog, pg_temp as $$
  select coalesce(current_setting('izi.restoring', true), '') = 'on'
$$;

create or replace function izi.account_timezone(p_account uuid) returns text
language sql stable set search_path = pg_catalog, pg_temp as $$
  select s.timezone from izi.account_settings s where s.account_id = p_account
$$;

-- ------------------------------------------------------------------ tasks ---
-- "Planned for Friday" (plan_date) and "due by Friday" (due_date) are different
-- facts. A vague plan keeps its precision: "next week" is plan_precision=week
-- with the Monday as plan_date, never an arbitrary day. "In the evening" is a
-- part_of_day, never an exact time.

create table if not exists izi.tasks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references izi.accounts(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 500),
  notes text check (char_length(notes) <= 10000),
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  priority text not null default 'normal' check (priority in ('normal', 'high')),
  plan_date date,
  plan_precision text check (plan_precision in ('day', 'week', 'month')),
  plan_time time,
  part_of_day text check (part_of_day in ('morning', 'afternoon', 'evening', 'night')),
  due_date date,
  due_time time,
  duration_minutes integer check (duration_minutes between 1 and 1440),
  timezone text check (char_length(timezone) between 1 and 64),
  completed_at timestamptz,
  completed_local_date date,
  completed_local_hour smallint check (completed_local_hour between 0 and 23),
  reschedule_count integer not null default 0 check (reschedule_count >= 0),
  source text not null check (source in ('telegram', 'miniapp', 'quick_capture', 'import', 'system')),
  capture_id uuid,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  search_vector tsvector generated always as
    (to_tsvector('russian'::regconfig, title || ' ' || coalesce(notes, ''))) stored,
  constraint tasks_account_id_key unique (account_id, id),
  constraint tasks_capture_fk foreign key (account_id, capture_id) references izi.captures(account_id, id),
  constraint tasks_plan_precision check ((plan_date is null) = (plan_precision is null)),
  constraint tasks_plan_week_starts_monday check (plan_precision is distinct from 'week' or extract(isodow from plan_date) = 1),
  constraint tasks_plan_month_starts_first check (plan_precision is distinct from 'month' or extract(day from plan_date) = 1),
  constraint tasks_plan_time_needs_day check (plan_time is null or plan_precision = 'day'),
  constraint tasks_time_or_part_of_day check (plan_time is null or part_of_day is null),
  constraint tasks_due_time_needs_date check (due_time is null or due_date is not null),
  constraint tasks_times_need_timezone check ((plan_time is null and due_time is null) or timezone is not null),
  constraint tasks_whole_minutes check (
    (plan_time is null or extract(second from plan_time) = 0) and (due_time is null or extract(second from due_time) = 0)),
  constraint tasks_completion check ((status = 'done') = (completed_at is not null))
);
create index if not exists tasks_account_plan_idx on izi.tasks(account_id, plan_date) where deleted_at is null;
create index if not exists tasks_account_due_idx on izi.tasks(account_id, due_date) where deleted_at is null and status = 'open';
create index if not exists tasks_account_status_idx on izi.tasks(account_id, status, updated_at desc) where deleted_at is null;
create index if not exists tasks_account_updated_idx on izi.tasks(account_id, updated_at desc);
create index if not exists tasks_capture_idx on izi.tasks(account_id, capture_id) where capture_id is not null;
create index if not exists tasks_search_idx on izi.tasks using gin (search_vector);

create or replace function izi.tasks_before_write() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare v_timezone text; v_local timestamp;
begin
  if new.timezone is null and (new.plan_time is not null or new.due_time is not null) then
    new.timezone := izi.account_timezone(new.account_id);
    if new.timezone is null then raise exception 'TIMEZONE_REQUIRED' using errcode = 'IZ422'; end if;
  end if;
  if new.timezone is not null and (tg_op = 'INSERT' or new.timezone is distinct from old.timezone) then
    perform izi.assert_timezone(new.timezone);
  end if;
  if tg_op = 'UPDATE' and izi.is_restoring() then return new; end if;

  -- Derived, server-owned fields.
  if tg_op = 'INSERT' then
    new.reschedule_count := 0;
  else
    new.reschedule_count := old.reschedule_count
      + case when old.plan_date is not null and new.plan_date is distinct from old.plan_date then 1 else 0 end;
  end if;

  if new.status = 'done' then
    if tg_op = 'INSERT' or old.status is distinct from 'done' then
      new.completed_at := now();
      v_timezone := coalesce(new.timezone, izi.account_timezone(new.account_id));
      if v_timezone is not null then
        v_local := now() at time zone v_timezone;
        new.completed_local_date := v_local::date;
        new.completed_local_hour := extract(hour from v_local)::smallint;
      else
        new.completed_local_date := null;
        new.completed_local_hour := null;
      end if;
    else
      new.completed_at := old.completed_at;
      new.completed_local_date := old.completed_local_date;
      new.completed_local_hour := old.completed_local_hour;
    end if;
  else
    new.completed_at := null;
    new.completed_local_date := null;
    new.completed_local_hour := null;
  end if;
  return new;
end $$;

create or replace trigger t05_insert before insert on izi.tasks
  for each row execute function izi.record_before_insert();
create or replace trigger t10_touch before update on izi.tasks
  for each row execute function izi.touch_versioned();
create or replace trigger t20_rules before insert or update on izi.tasks
  for each row execute function izi.tasks_before_write();

-- ----------------------------------------------------------------- events ---
-- Date, time and duration are each null until the user states them. An event
-- without a date stays an event; clarification is the capture layer's job.

create table if not exists izi.events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references izi.accounts(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 500),
  notes text check (char_length(notes) <= 10000),
  start_date date,
  start_time time,
  part_of_day text check (part_of_day in ('morning', 'afternoon', 'evening', 'night')),
  duration_minutes integer check (duration_minutes between 1 and 10080),
  timezone text check (char_length(timezone) between 1 and 64),
  -- Derived instant for reminders; the wall clock above stays the source of truth.
  starts_at timestamptz,
  location text check (char_length(btrim(location)) between 1 and 300),
  participants text[] not null default '{}'
    check (cardinality(participants) <= 50 and izi.text_items_ok(participants, 120)),
  status text not null default 'planned' check (status in ('planned', 'done', 'cancelled')),
  source text not null check (source in ('telegram', 'miniapp', 'quick_capture', 'import', 'system')),
  capture_id uuid,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint events_account_id_key unique (account_id, id),
  constraint events_capture_fk foreign key (account_id, capture_id) references izi.captures(account_id, id),
  constraint events_time_needs_date check (start_time is null or start_date is not null),
  constraint events_time_or_part_of_day check (start_time is null or part_of_day is null),
  constraint events_time_needs_timezone check (start_time is null or timezone is not null),
  constraint events_whole_minutes check (start_time is null or extract(second from start_time) = 0)
);
create index if not exists events_account_date_idx on izi.events(account_id, start_date) where deleted_at is null;
create index if not exists events_account_updated_idx on izi.events(account_id, updated_at desc);
create index if not exists events_capture_idx on izi.events(account_id, capture_id) where capture_id is not null;

create or replace function izi.events_before_write() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if new.timezone is null and new.start_time is not null then
    new.timezone := izi.account_timezone(new.account_id);
    if new.timezone is null then raise exception 'TIMEZONE_REQUIRED' using errcode = 'IZ422'; end if;
  end if;
  if new.timezone is not null and (tg_op = 'INSERT' or new.timezone is distinct from old.timezone) then
    perform izi.assert_timezone(new.timezone);
  end if;
  if tg_op = 'UPDATE' and izi.is_restoring() then return new; end if;
  new.starts_at := case
    when new.start_date is not null and new.start_time is not null
      then (new.start_date + new.start_time) at time zone new.timezone
  end;
  return new;
end $$;

create or replace trigger t05_insert before insert on izi.events
  for each row execute function izi.record_before_insert();
create or replace trigger t10_touch before update on izi.events
  for each row execute function izi.touch_versioned();
create or replace trigger t20_rules before insert or update on izi.events
  for each row execute function izi.events_before_write();

-- ------------------------------------------------------------------ notes ---
-- Plain notes with full-text search. No client-side encryption in V1.

create table if not exists izi.notes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references izi.accounts(id) on delete cascade,
  title text check (char_length(btrim(title)) between 1 and 300),
  body text not null check (char_length(btrim(body)) between 1 and 20000),
  tags text[] not null default '{}' check (cardinality(tags) <= 20 and izi.text_items_ok(tags, 50)),
  source text not null check (source in ('telegram', 'miniapp', 'quick_capture', 'import', 'system')),
  capture_id uuid,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  search_vector tsvector generated always as
    (to_tsvector('russian'::regconfig, coalesce(title, '') || ' ' || body)) stored,
  constraint notes_account_id_key unique (account_id, id),
  constraint notes_capture_fk foreign key (account_id, capture_id) references izi.captures(account_id, id)
);
create index if not exists notes_account_updated_idx on izi.notes(account_id, updated_at desc) where deleted_at is null;
create index if not exists notes_capture_idx on izi.notes(account_id, capture_id) where capture_id is not null;
create index if not exists notes_search_idx on izi.notes using gin (search_vector);

create or replace trigger t05_insert before insert on izi.notes
  for each row execute function izi.record_before_insert();
create or replace trigger t10_touch before update on izi.notes
  for each row execute function izi.touch_versioned();

-- ------------------------------------------------------------------ inbox ---
-- A safe place for thoughts that are not (yet) a task, event or note. It is
-- not "a task without a date". Conversion links point at the resulting record
-- through composite keys, so they can never cross accounts.

create table if not exists izi.inbox_items (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references izi.accounts(id) on delete cascade,
  text text not null check (char_length(btrim(text)) between 1 and 4000),
  status text not null default 'unprocessed' check (status in ('unprocessed', 'converted', 'archived')),
  converted_entity text check (converted_entity in ('task', 'event', 'note')),
  converted_task_id uuid,
  converted_event_id uuid,
  converted_note_id uuid,
  converted_at timestamptz,
  source text not null check (source in ('telegram', 'miniapp', 'quick_capture', 'import', 'system')),
  capture_id uuid,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint inbox_items_account_id_key unique (account_id, id),
  constraint inbox_items_capture_fk foreign key (account_id, capture_id) references izi.captures(account_id, id),
  constraint inbox_items_task_fk foreign key (account_id, converted_task_id) references izi.tasks(account_id, id),
  constraint inbox_items_event_fk foreign key (account_id, converted_event_id) references izi.events(account_id, id),
  constraint inbox_items_note_fk foreign key (account_id, converted_note_id) references izi.notes(account_id, id),
  constraint inbox_items_conversion check (
    num_nonnulls(converted_task_id, converted_event_id, converted_note_id) = case when status = 'converted' then 1 else 0 end
    and (status = 'converted') = (converted_entity is not null)
    and (status = 'converted') = (converted_at is not null)
    and coalesce(converted_entity = 'task', false) = (converted_task_id is not null)
    and coalesce(converted_entity = 'event', false) = (converted_event_id is not null)
    and coalesce(converted_entity = 'note', false) = (converted_note_id is not null)
  )
);
create index if not exists inbox_items_account_status_idx on izi.inbox_items(account_id, status, created_at desc) where deleted_at is null;
create index if not exists inbox_items_account_updated_idx on izi.inbox_items(account_id, updated_at desc);
create index if not exists inbox_items_capture_idx on izi.inbox_items(account_id, capture_id) where capture_id is not null;
create index if not exists inbox_items_task_idx on izi.inbox_items(account_id, converted_task_id) where converted_task_id is not null;
create index if not exists inbox_items_event_idx on izi.inbox_items(account_id, converted_event_id) where converted_event_id is not null;
create index if not exists inbox_items_note_idx on izi.inbox_items(account_id, converted_note_id) where converted_note_id is not null;

create or replace function izi.inbox_items_before_write() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if tg_op = 'UPDATE' and izi.is_restoring() then return new; end if;
  if new.status = 'converted' then
    new.converted_at := case when tg_op = 'UPDATE' and old.status = 'converted' then old.converted_at else now() end;
  else
    new.converted_at := null;
  end if;
  return new;
end $$;

create or replace trigger t05_insert before insert on izi.inbox_items
  for each row execute function izi.record_before_insert();
create or replace trigger t10_touch before update on izi.inbox_items
  for each row execute function izi.touch_versioned();
create or replace trigger t20_rules before insert or update on izi.inbox_items
  for each row execute function izi.inbox_items_before_write();

select izi._secure_schema();
