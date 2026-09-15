-- SEVER v113 recurring tasks.
-- Additive only: existing task rows and user data are preserved.
-- Deploy the protocol-2 client only after this migration is present.
begin;

alter table public.tasks
  add column if not exists recurrence_series_id uuid,
  add column if not exists recurrence_rule jsonb,
  add column if not exists recurrence_occurrence date;

alter table public.tasks drop constraint if exists tasks_recurrence_shape_valid;
alter table public.tasks add constraint tasks_recurrence_shape_valid check (
  (
    recurrence_series_id is null
    and recurrence_rule is null
    and recurrence_occurrence is null
  )
  or
  (
    recurrence_series_id is not null
    and recurrence_occurrence is not null
    and (
      recurrence_rule is null
      or (
        jsonb_typeof(recurrence_rule) = 'object'
        and octet_length(recurrence_rule::text) <= 8192
      )
    )
  )
);

create index if not exists tasks_user_recurrence_series_idx
  on public.tasks(user_id, recurrence_series_id, recurrence_occurrence)
  where recurrence_series_id is not null;

-- Existing v1 field-version rows predate recurrence. Give the new atomic
-- recurrence register a stable inherited stamp so an unrelated v113 edit does
-- not accidentally look like a recurrence edit.
update public.tasks
set sync_versions = jsonb_set(
  sync_versions,
  '{fields,recurrence}',
  coalesce(
    sync_versions->'fields'->'date',
    sync_versions->'life'->'stamp',
    '[0,""]'::jsonb
  ),
  true
)
where sync_versions->>'v' = '1'
  and jsonb_typeof(sync_versions->'fields') = 'object'
  and not (sync_versions->'fields' ? 'recurrence');

-- Keep recurrence metadata in one atomic sync register. A device must never
-- merge a series id from one edit with a rule/occurrence from another.
create or replace function public.sever_sync_groups(t text) returns jsonb
language sql immutable set search_path=public as $$
select case t
when 'tasks' then '{"title":["title"],"date":["scheduled_for"],"time":["scheduled_time"],"duration":["duration_minutes"],"category":["category"],"priority":["priority"],"challenge":["challenge"],"recurrence":["recurrence_series_id","recurrence_rule","recurrence_occurrence"],"completion":["completed","completed_at"]}'::jsonb
when 'habits' then '{"title":["title"]}'::jsonb
when 'habit_entries' then '{"completion":["completed"]}'::jsonb
when 'note_folders' then '{"name":["name"]}'::jsonb
when 'notes' then '{"folder":["folder_id"],"content":["title","body","kind","items","done","protected","secure"]}'::jsonb
when 'focus_sessions' then '{"session":["task_id","duration_minutes","started_at","completed_at","status"]}'::jsonb
when 'user_settings' then '{"data":["data"]}'::jsonb
else '{}'::jsonb end;
$$;

-- Protocol 2 means every task write carries the recurrence field-version
-- register. Clients that only understand protocol 1 must stop syncing instead
-- of silently dropping recurrence metadata.
create or replace function public.sever_sync_protocol() returns integer
language sql stable security invoker set search_path=public as $$select 2$$;
revoke all on function public.sever_sync_protocol() from public;
grant execute on function public.sever_sync_protocol() to anon,authenticated;

commit;
