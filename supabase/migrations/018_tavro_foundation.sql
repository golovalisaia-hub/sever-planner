-- TAVRO foundation. Additive only: no SEVER table is altered, renamed or dropped,
-- and no existing row is rewritten. Apply once, after 017, in a transaction.
--
-- Identity model: a TAVRO account is a verified Telegram user, not a Supabase Auth
-- user. Every table below is therefore service-role only — the Edge Functions hold
-- the sole connection and establish identity by verifying Telegram's signature
-- before a single row is read. RLS is enabled with no anon/authenticated policy so
-- a leaked publishable key reaches nothing.
begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- accounts ----
create table if not exists public.tavro_accounts (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null unique,
  first_name text not null default '' check (char_length(first_name) <= 128),
  username text check (char_length(username) <= 64),
  language_code text check (char_length(language_code) <= 16),
  timezone text not null default 'Europe/Moscow' check (char_length(timezone) between 1 and 64),
  timezone_source text not null default 'default' check (timezone_source in ('default', 'client', 'user')),
  -- Optional bridge to a SEVER cloud account. Null for a Telegram-only user.
  sever_user_id uuid references auth.users(id) on delete set null,
  onboarded_at timestamptz,
  reminders_enabled boolean not null default true,
  quiet_hours_start time,
  quiet_hours_end time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists tavro_accounts_sever_idx on public.tavro_accounts(sever_user_id) where sever_user_id is not null;

-- ------------------------------------------------------------------- tasks ----
create table if not exists public.tavro_tasks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.tavro_accounts(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  details text check (char_length(details) <= 2000),
  scheduled_for date,
  scheduled_time time,
  duration_minutes integer check (duration_minutes between 1 and 1440),
  category text not null default 'Личное' check (char_length(category) between 1 and 80),
  priority boolean not null default false,
  completed boolean not null default false,
  completed_at timestamptz,
  source text not null default 'text' check (source in ('text', 'voice', 'photo', 'miniapp', 'quick', 'import')),
  capture_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists tavro_tasks_account_day_idx on public.tavro_tasks(account_id, scheduled_for) where deleted_at is null;
create index if not exists tavro_tasks_account_open_idx on public.tavro_tasks(account_id, completed, scheduled_for) where deleted_at is null;

-- ------------------------------------------------------------------ events ----
-- Wall clock and resolved instant are both stored: the instant drives reminders,
-- the wall clock survives a later timezone change without shifting the meeting.
create table if not exists public.tavro_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.tavro_accounts(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  details text check (char_length(details) <= 2000),
  event_date date not null,
  event_time time,
  duration_minutes integer not null default 60 check (duration_minutes between 5 and 1440),
  timezone text not null default 'Europe/Moscow',
  starts_at timestamptz,
  ends_at timestamptz,
  location text check (char_length(location) <= 200),
  participants text[] not null default '{}',
  status text not null default 'planned' check (status in ('planned', 'done', 'cancelled')),
  source text not null default 'text' check (source in ('text', 'voice', 'photo', 'miniapp', 'quick', 'import')),
  capture_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists tavro_events_account_day_idx on public.tavro_events(account_id, event_date) where deleted_at is null;
create index if not exists tavro_events_starts_idx on public.tavro_events(starts_at) where deleted_at is null and status = 'planned';

-- ------------------------------------------------------- notes, diary, meals ----
create table if not exists public.tavro_notes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.tavro_accounts(id) on delete cascade,
  kind text not null default 'note' check (kind in ('note', 'diary', 'meal')),
  title text not null default '' check (char_length(title) <= 200),
  body text not null default '' check (char_length(body) <= 20000),
  entry_date date,
  tags text[] not null default '{}',
  -- Photo stays in Telegram storage; only its file id and an explicitly
  -- approximate description are kept here.
  photo_file_id text check (char_length(photo_file_id) <= 256),
  photo_summary text check (char_length(photo_summary) <= 1000),
  photo_summary_is_estimate boolean not null default true,
  source text not null default 'text' check (source in ('text', 'voice', 'photo', 'miniapp', 'quick', 'import')),
  capture_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists tavro_notes_account_kind_idx on public.tavro_notes(account_id, kind, entry_date desc) where deleted_at is null;
create index if not exists tavro_notes_account_updated_idx on public.tavro_notes(account_id, updated_at desc) where deleted_at is null;

-- ------------------------------------------------------------------ habits ----
create table if not exists public.tavro_habits (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.tavro_accounts(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  target_per_week integer not null default 7 check (target_per_week between 1 and 7),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.tavro_habit_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.tavro_accounts(id) on delete cascade,
  habit_id uuid not null references public.tavro_habits(id) on delete cascade,
  entry_date date not null,
  completed boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (habit_id, entry_date)
);
create index if not exists tavro_habit_entries_account_date_idx on public.tavro_habit_entries(account_id, entry_date desc);

-- ---------------------------------------------------------------- captures ----
-- One user phrase = one capture, however many records it produced. The draft is
-- held here until the user confirms it, which is what makes "save with one
-- button" and duplicate protection possible.
create table if not exists public.tavro_captures (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.tavro_accounts(id) on delete cascade,
  source text not null check (source in ('text', 'voice', 'photo', 'miniapp', 'quick')),
  raw_text text check (char_length(raw_text) <= 8000),
  transcript text check (char_length(transcript) <= 8000),
  draft jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'discarded', 'expired', 'failed')),
  chat_id bigint,
  message_id bigint,
  ai_request_id uuid,
  created_record_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  expires_at timestamptz not null default now() + interval '24 hours'
);
create index if not exists tavro_captures_account_idx on public.tavro_captures(account_id, created_at desc);
create index if not exists tavro_captures_pending_idx on public.tavro_captures(status, expires_at) where status = 'pending';

-- --------------------------------------------------------------- ai usage -----
-- Also the AI quota ledger: one row per billable AI action, claimed atomically.
create table if not exists public.tavro_ai_usage (
  request_id uuid primary key,
  account_id uuid not null references public.tavro_accounts(id) on delete cascade,
  kind text not null check (kind in ('capture', 'ask', 'transcribe', 'photo')),
  usage_date date not null,
  billable boolean not null default true,
  provider text,
  model text,
  latency_ms integer not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  audio_seconds numeric(10, 2) not null default 0,
  success boolean,
  error_code text,
  created_at timestamptz not null default now()
);
create index if not exists tavro_ai_usage_quota_idx on public.tavro_ai_usage(account_id, usage_date) where billable;

-- ----------------------------------------------------- subscriptions, money ----
create table if not exists public.tavro_subscriptions (
  account_id uuid primary key references public.tavro_accounts(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro_month', 'pro_year', 'pro_lifetime')),
  status text not null default 'active' check (status in ('active', 'cancelled', 'expired', 'refunded')),
  -- Null for free and for lifetime: lifetime access does not expire.
  current_period_end timestamptz,
  auto_renew boolean not null default false,
  telegram_charge_id text,
  -- The terms the buyer accepted, frozen at purchase time and never rewritten.
  terms_version text not null default 'v1',
  granted_at timestamptz not null default now(),
  cancelled_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.tavro_payments (
  telegram_payment_charge_id text primary key,
  account_id uuid not null references public.tavro_accounts(id) on delete cascade,
  plan text not null check (plan in ('pro_month', 'pro_year', 'pro_lifetime')),
  stars integer not null check (stars > 0),
  currency text not null default 'XTR',
  invoice_payload text not null,
  is_recurring boolean not null default false,
  is_first_recurring boolean not null default false,
  subscription_expiration_date timestamptz,
  status text not null default 'paid' check (status in ('paid', 'refunded')),
  refunded_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists tavro_payments_account_idx on public.tavro_payments(account_id, created_at desc);

-- --------------------------------------------------------------- reminders ----
create table if not exists public.tavro_reminders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.tavro_accounts(id) on delete cascade,
  target_kind text not null check (target_kind in ('task', 'event')),
  target_id uuid not null,
  kind text not null check (kind in ('day_before', 'morning', 'before', 'at_time')),
  remind_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'sent', 'cancelled', 'failed', 'skipped')),
  attempts integer not null default 0,
  sent_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A task rescheduled to the same instant must not produce a second reminder.
  unique (target_kind, target_id, kind, remind_at)
);
create index if not exists tavro_reminders_due_idx on public.tavro_reminders(remind_at) where status = 'scheduled';

-- ---------------------------------------------------- webhook idempotency -----
create table if not exists public.tavro_updates (
  update_id bigint primary key,
  received_at timestamptz not null default now()
);

-- ------------------------------------------------------------ quick tokens ----
-- Scoped tokens for phone shortcuts. Only a SHA-256 hash is stored, so a
-- database read cannot replay a token. The bot token is never exposed here.
create table if not exists public.tavro_quick_tokens (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.tavro_accounts(id) on delete cascade,
  token_hash text not null unique,
  label text not null default 'Быстрый ввод' check (char_length(label) <= 60),
  scope text not null default 'capture' check (scope in ('capture')),
  uses integer not null default 0,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz
);
create index if not exists tavro_quick_tokens_account_idx on public.tavro_quick_tokens(account_id) where revoked_at is null;

-- ------------------------------------------------------------ rate limiting ---
create table if not exists public.tavro_rate_events (
  account_id uuid not null references public.tavro_accounts(id) on delete cascade,
  bucket text not null check (char_length(bucket) <= 40),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (account_id, bucket, window_start)
);
create index if not exists tavro_rate_events_window_idx on public.tavro_rate_events(window_start);

-- ================================================================ security ====
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'tavro_accounts', 'tavro_tasks', 'tavro_events', 'tavro_notes', 'tavro_habits',
    'tavro_habit_entries', 'tavro_captures', 'tavro_ai_usage', 'tavro_subscriptions',
    'tavro_payments', 'tavro_reminders', 'tavro_updates', 'tavro_quick_tokens', 'tavro_rate_events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated, public', table_name);
    execute format('grant select, insert, update, delete on public.%I to service_role', table_name);
  end loop;
end $$;

-- ================================================================ functions ===

/*
 * Atomic AI quota claim. Returns false when the day's allowance is spent.
 * A duplicate request_id raises 23505, which is how a retried Telegram update or
 * a double tap is rejected instead of charging the user twice.
 * p_limit < 0 means "no numeric cap" (still recorded for cost accounting).
 */
create or replace function public.tavro_claim_ai_action(
  p_account uuid, p_request_id uuid, p_kind text, p_usage_date date, p_limit integer,
  p_provider text default null, p_model text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare used integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_account::text, 11));
  insert into public.tavro_ai_usage (request_id, account_id, kind, usage_date, provider, model)
  values (p_request_id, p_account, p_kind, p_usage_date, p_provider, p_model);
  if p_limit < 0 then
    return true;
  end if;
  select count(*) into used
    from public.tavro_ai_usage
   where account_id = p_account and usage_date = p_usage_date and billable
     and (success is null or success = true);
  if used > p_limit then
    delete from public.tavro_ai_usage where request_id = p_request_id;
    return false;
  end if;
  return true;
end $$;

/* A failed provider call must not consume the user's daily allowance. */
create or replace function public.tavro_release_ai_action(p_request_id uuid, p_error text)
returns void language sql security definer set search_path = public as $$
  update public.tavro_ai_usage
     set billable = false, success = false, error_code = p_error
   where request_id = p_request_id;
$$;

/* Telegram retries a webhook it believes failed; each update_id runs once. */
create or replace function public.tavro_claim_update(p_update_id bigint)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into public.tavro_updates (update_id) values (p_update_id);
  delete from public.tavro_updates where received_at < now() - interval '7 days';
  return true;
exception when unique_violation then
  return false;
end $$;

/* Fixed-window rate limit. Returns false once the window's allowance is spent. */
create or replace function public.tavro_rate_check(
  p_account uuid, p_bucket text, p_limit integer, p_window_seconds integer
) returns boolean
language plpgsql security definer set search_path = public as $$
declare window_start timestamptz; current_hits integer;
begin
  window_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.tavro_rate_events (account_id, bucket, window_start, hits)
  values (p_account, p_bucket, window_start, 1)
  on conflict (account_id, bucket, window_start)
    do update set hits = public.tavro_rate_events.hits + 1
  returning hits into current_hits;
  delete from public.tavro_rate_events where window_start < now() - interval '1 day';
  return current_hits <= p_limit;
end $$;

/* Claims a due reminder so two dispatcher runs cannot both send it. */
create or replace function public.tavro_claim_reminders(p_limit integer default 50)
returns setof public.tavro_reminders
language sql security definer set search_path = public as $$
  update public.tavro_reminders
     set status = 'sent', attempts = attempts + 1, sent_at = now(), updated_at = now()
   where id in (
     select id from public.tavro_reminders
      where status = 'scheduled' and remind_at <= now()
      order by remind_at
      limit p_limit
      for update skip locked
   )
  returning *;
$$;

revoke all on function public.tavro_claim_ai_action(uuid, uuid, text, date, integer, text, text) from public, anon, authenticated;
revoke all on function public.tavro_release_ai_action(uuid, text) from public, anon, authenticated;
revoke all on function public.tavro_claim_update(bigint) from public, anon, authenticated;
revoke all on function public.tavro_rate_check(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.tavro_claim_reminders(integer) from public, anon, authenticated;
grant execute on function public.tavro_claim_ai_action(uuid, uuid, text, date, integer, text, text) to service_role;
grant execute on function public.tavro_release_ai_action(uuid, text) to service_role;
grant execute on function public.tavro_claim_update(bigint) to service_role;
grant execute on function public.tavro_rate_check(uuid, text, integer, integer) to service_role;
grant execute on function public.tavro_claim_reminders(integer) to service_role;

commit;
