-- SEVER Security Hardening v1. Apply after 001_initial_cloud_sync.sql.
-- This migration is idempotent and preserves existing rows and delete behavior.

create or replace function public.sever_check_owned_relations()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_table_name = 'habit_entries' and not exists (
    select 1 from public.habits where id = new.habit_id and user_id = new.user_id
  ) then
    raise exception 'habit ownership mismatch' using errcode = '42501';
  end if;
  if tg_table_name = 'notes' and new.folder_id is not null and not exists (
    select 1 from public.note_folders where id = new.folder_id and user_id = new.user_id
  ) then
    raise exception 'folder ownership mismatch' using errcode = '42501';
  end if;
  if tg_table_name = 'focus_sessions' and new.task_id is not null and not exists (
    select 1 from public.tasks where id = new.task_id and user_id = new.user_id
  ) then
    raise exception 'task ownership mismatch' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists sever_check_habit_entry_owner on public.habit_entries;
create trigger sever_check_habit_entry_owner before insert or update on public.habit_entries
for each row execute function public.sever_check_owned_relations();
drop trigger if exists sever_check_note_folder_owner on public.notes;
create trigger sever_check_note_folder_owner before insert or update on public.notes
for each row execute function public.sever_check_owned_relations();
drop trigger if exists sever_check_focus_task_owner on public.focus_sessions;
create trigger sever_check_focus_task_owner before insert or update on public.focus_sessions
for each row execute function public.sever_check_owned_relations();

alter table public.notes drop constraint if exists encrypted_notes_have_no_plaintext;
alter table public.notes add constraint encrypted_notes_have_no_plaintext check (
  not protected or (
    title = '' and body = '' and items = '[]'::jsonb and kind = 'protected' and
    secure is not null and jsonb_typeof(secure) = 'object' and secure->>'algorithm' = 'AES-GCM' and (
      (
        ((secure->>'version') is null or secure->>'version' = '1') and
        secure->>'kdf' = 'PBKDF2-SHA256' and secure ? 'iterations' and
        secure ? 'salt' and secure ? 'iv' and secure ? 'cipher'
      ) or (
        secure->>'version' = '2' and secure->'kdf'->>'name' = 'PBKDF2' and
        secure->'kdf'->>'hash' = 'SHA-256' and secure->'kdf' ? 'iterations' and
        secure->'kdf' ? 'salt' and secure ? 'iv' and secure ? 'ciphertext'
      )
    )
  )
);

-- RLS remains enabled with the private policies created in migration 001.
-- Do not FORCE RLS: handle_new_user is a SECURITY DEFINER trigger and must be
-- able to create the user's profile without exposing privileged credentials.
