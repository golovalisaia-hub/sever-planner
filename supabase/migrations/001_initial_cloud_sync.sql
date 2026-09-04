create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  scheduled_for date,
  duration_minutes integer check (duration_minutes between 1 and 600),
  category text not null default 'Личное' check (char_length(category) between 1 and 80),
  priority boolean not null default false,
  challenge boolean not null default false,
  completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists tasks_user_schedule_idx on public.tasks(user_id, scheduled_for);

create table if not exists public.habits (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.habit_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  habit_id uuid not null references public.habits(id) on delete cascade,
  entry_date date not null,
  completed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, habit_id, entry_date)
);
create index if not exists habit_entries_user_date_idx on public.habit_entries(user_id, entry_date);

create table if not exists public.note_folders (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.notes (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  folder_id uuid references public.note_folders(id) on delete set null,
  title text not null default '',
  body text not null default '',
  kind text not null default 'text',
  items jsonb not null default '[]'::jsonb,
  done boolean not null default false,
  protected boolean not null default false,
  secure jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint encrypted_notes_have_no_plaintext check (not protected or (title = '' and body = '' and items = '[]'::jsonb and secure is not null))
);
create index if not exists notes_user_updated_idx on public.notes(user_id, updated_at desc);

create table if not exists public.focus_sessions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  duration_minutes integer not null check (duration_minutes between 1 and 600),
  started_at timestamptz,
  completed_at timestamptz,
  status text not null check (status in ('completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists focus_sessions_user_completed_idx on public.focus_sessions(user_id, completed_at desc);

create table if not exists public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.habits enable row level security;
alter table public.habit_entries enable row level security;
alter table public.note_folders enable row level security;
alter table public.notes enable row level security;
alter table public.focus_sessions enable row level security;
alter table public.user_settings enable row level security;

create policy "profiles are private" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "tasks are private" on public.tasks for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "habits are private" on public.habits for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "habit entries are private" on public.habit_entries for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "folders are private" on public.note_folders for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "notes are private" on public.notes for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "focus sessions are private" on public.focus_sessions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "settings are private" on public.user_settings for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do update set email = excluded.email, updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.tasks replica identity full;
alter table public.habits replica identity full;
alter table public.habit_entries replica identity full;
alter table public.note_folders replica identity full;
alter table public.notes replica identity full;
alter table public.focus_sessions replica identity full;
alter table public.user_settings replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.tasks, public.habits, public.habit_entries, public.note_folders, public.notes, public.focus_sessions, public.user_settings;
  exception when duplicate_object then null;
  end;
end;
$$;
-- Last-write-wins guard: stale offline retries never overwrite a newer cloud edit or deletion.
create or replace function public.sever_keep_newest_update()
returns trigger
language plpgsql
as $$
begin
  if new.updated_at < old.updated_at then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array['tasks','habits','habit_entries','note_folders','notes','focus_sessions','user_settings']
  loop
    execute format('drop trigger if exists sever_keep_newest_%I on public.%I', table_name, table_name);
    execute format('create trigger sever_keep_newest_%I before update on public.%I for each row execute function public.sever_keep_newest_update()', table_name, table_name);
  end loop;
end;
$$;
