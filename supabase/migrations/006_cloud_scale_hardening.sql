-- SEVER cloud scale hardening.
-- Additive/idempotent: no planner rows are deleted or rewritten.
begin;

-- Foreign-key indexes keep deletes, folder moves and relation checks predictable
-- as each user's planner grows.
create index if not exists focus_sessions_task_id_idx on public.focus_sessions(task_id);
create index if not exists habit_entries_habit_id_idx on public.habit_entries(habit_id);
create index if not exists habits_user_id_idx on public.habits(user_id);
create index if not exists note_folders_user_id_idx on public.note_folders(user_id);
create index if not exists notes_folder_id_idx on public.notes(folder_id);

-- Evaluate auth.uid() once per statement instead of once per candidate row.
-- The policies keep the exact same ownership boundary while explicitly limiting
-- client access to authenticated users.
drop policy if exists "tasks are private" on public.tasks;
create policy "tasks are private" on public.tasks
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "habits are private" on public.habits;
create policy "habits are private" on public.habits
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "habit entries are private" on public.habit_entries;
create policy "habit entries are private" on public.habit_entries
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "folders are private" on public.note_folders;
create policy "folders are private" on public.note_folders
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "notes are private" on public.notes;
create policy "notes are private" on public.notes
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "focus sessions are private" on public.focus_sessions;
create policy "focus sessions are private" on public.focus_sessions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "settings are private" on public.user_settings;
create policy "settings are private" on public.user_settings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "profiles are readable by self" on public.profiles;
create policy "profiles are readable by self" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists "ai memories are private" on public.ai_memories;
create policy "ai memories are private" on public.ai_memories
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "ai plans are private" on public.ai_plans;
create policy "ai plans are private" on public.ai_plans
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "ai usage is readable by self" on public.ai_usage;
create policy "ai usage is readable by self" on public.ai_usage
  for select to authenticated
  using (user_id = (select auth.uid()));

-- This SECURITY DEFINER function exists only as an auth.users trigger target.
-- End-user/API roles never need to execute it directly.
revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant execute on function public.handle_new_user() to supabase_auth_admin;
  end if;
end $$;

commit;
