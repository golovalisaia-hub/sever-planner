-- SEVER cloud sync repair: trigger functions are parsed against every table
-- they protect, so field access must be table-safe.
create or replace function public.sever_check_owned_relations()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare row_data jsonb := to_jsonb(new);
begin
  if tg_table_name = 'habit_entries' and not exists (
    select 1 from public.habits
    where id = (row_data->>'habit_id')::uuid and user_id = (row_data->>'user_id')::uuid
  ) then
    raise exception 'habit ownership mismatch' using errcode = '42501';
  end if;
  if tg_table_name = 'notes' and (row_data->>'folder_id') is not null and not exists (
    select 1 from public.note_folders
    where id = (row_data->>'folder_id')::uuid and user_id = (row_data->>'user_id')::uuid
  ) then
    raise exception 'folder ownership mismatch' using errcode = '42501';
  end if;
  if tg_table_name = 'focus_sessions' and (row_data->>'task_id') is not null and not exists (
    select 1 from public.tasks
    where id = (row_data->>'task_id')::uuid and user_id = (row_data->>'user_id')::uuid
  ) then
    raise exception 'task ownership mismatch' using errcode = '42501';
  end if;
  return new;
end;
$$;
