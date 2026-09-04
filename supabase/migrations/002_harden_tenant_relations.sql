-- Hardens cross-table ownership so a child row cannot point at another user's parent row.
-- Safe to run after 001_initial_cloud_sync.sql; the guards make this migration rerunnable.

create unique index if not exists tasks_user_id_id_uidx on public.tasks(user_id, id);
create unique index if not exists habits_user_id_id_uidx on public.habits(user_id, id);
create unique index if not exists note_folders_user_id_id_uidx on public.note_folders(user_id, id);

-- Replace the single-column foreign keys with owner-aware composite foreign keys.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'habit_entries_habit_id_fkey'
      and conrelid = 'public.habit_entries'::regclass
  ) then
    alter table public.habit_entries drop constraint habit_entries_habit_id_fkey;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'habit_entries_owner_habit_fkey'
      and conrelid = 'public.habit_entries'::regclass
  ) then
    alter table public.habit_entries
      add constraint habit_entries_owner_habit_fkey
      foreign key (user_id, habit_id)
      references public.habits(user_id, id)
      on delete cascade;
  end if;
end
$$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'notes_folder_id_fkey'
      and conrelid = 'public.notes'::regclass
  ) then
    alter table public.notes drop constraint notes_folder_id_fkey;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'notes_owner_folder_fkey'
      and conrelid = 'public.notes'::regclass
  ) then
    alter table public.notes
      add constraint notes_owner_folder_fkey
      foreign key (user_id, folder_id)
      references public.note_folders(user_id, id)
      on delete set null (folder_id);
  end if;
end
$$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'focus_sessions_task_id_fkey'
      and conrelid = 'public.focus_sessions'::regclass
  ) then
    alter table public.focus_sessions drop constraint focus_sessions_task_id_fkey;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'focus_sessions_owner_task_fkey'
      and conrelid = 'public.focus_sessions'::regclass
  ) then
    alter table public.focus_sessions
      add constraint focus_sessions_owner_task_fkey
      foreign key (user_id, task_id)
      references public.tasks(user_id, id)
      on delete set null (task_id);
  end if;
end
$$;
