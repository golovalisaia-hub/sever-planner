-- IZI Planner · 001 · core: identity, settings, inbound queue, captures, AI runs, rate limits.
--
-- Scope rules for every IZI migration:
--   * only the `izi` schema is created or changed; nothing in `public`,
--     no SEVER or TAVRO object is referenced, altered or dropped;
--   * idempotent: `if not exists`, `create or replace`, so a re-run is harmless;
--   * server-only data: no client role (anon/authenticated) gets any privilege,
--     RLS is enabled with no policies (deny-all). The server connects as the
--     table owner or as `service_role` (BYPASSRLS). RLS is intentionally not
--     FORCEd: FORCE only affects the table owner, which is the server itself.
--
-- Custom errors use SQLSTATE class "IZ" with the public error code as message
-- (see src/core/errors.ts): IZ404 not found, IZ409 conflict, IZ410 expired,
-- IZ422 validation, IZ423 invalid state.

create schema if not exists izi;
comment on schema izi is 'IZI Planner. Server-only; not exposed through the Data API.';

-- Functions are executable by PUBLIC by default; never in this schema.
alter default privileges in schema izi revoke execute on functions from public;

-- ------------------------------------------------------------- helpers ------

create or replace function izi.touch_versioned() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if to_jsonb(new)->'id' is distinct from to_jsonb(old)->'id'
     or to_jsonb(new)->'account_id' is distinct from to_jsonb(old)->'account_id'
     or new.created_at is distinct from old.created_at then
    raise exception 'IMMUTABLE_FIELD' using errcode = 'IZ422';
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$;

create or replace function izi.touch_unversioned() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if to_jsonb(new)->'id' is distinct from to_jsonb(old)->'id'
     or to_jsonb(new)->'account_id' is distinct from to_jsonb(old)->'account_id'
     or new.created_at is distinct from old.created_at then
    raise exception 'IMMUTABLE_FIELD' using errcode = 'IZ422';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- IANA names only. PostgreSQL would also accept "UTC+3" with an inverted sign.
create or replace function izi.assert_timezone(p_timezone text) returns void
language plpgsql stable set search_path = pg_catalog, pg_temp as $$
begin
  if p_timezone is null then return; end if;
  if p_timezone !~ '^(UTC|[A-Z][A-Za-z_]+(/[A-Za-z0-9_+-]+){1,2})$'
     or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'INVALID_TIMEZONE' using errcode = 'IZ422';
  end if;
end $$;

-- ------------------------------------------------------------- accounts -----
-- One person = one account. Channels (Telegram, email, web, SEVER import) are
-- identities attached to it; the account is never "a Telegram user".

create table if not exists izi.accounts (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'active' check (status in ('active', 'suspended')),
  locale text not null default 'ru' check (locale in ('ru')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace trigger t10_touch before update on izi.accounts
  for each row execute function izi.touch_unversioned();

create table if not exists izi.identities (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references izi.accounts(id) on delete cascade,
  provider text not null check (provider in ('telegram', 'email', 'web', 'imported_sever')),
  subject text not null,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint identities_subject_format check (
    (provider = 'telegram' and subject ~ '^[1-9][0-9]{0,19}$')
    or (provider = 'email' and subject ~ '^[^@[:space:]]{1,64}@[^@[:space:]]{1,189}$' and subject = lower(subject))
    or (provider in ('web', 'imported_sever') and subject ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  ),
  -- One external identity can never belong to two accounts.
  constraint identities_provider_subject_key unique (provider, subject),
  constraint identities_account_id_key unique (account_id, id)
);
-- An account has at most one Telegram identity.
create unique index if not exists identities_one_telegram_per_account
  on izi.identities(account_id) where provider = 'telegram';

create or replace trigger t10_touch before update on izi.identities
  for each row execute function izi.touch_unversioned();

create table if not exists izi.account_settings (
  account_id uuid primary key references izi.accounts(id) on delete cascade,
  -- Unknown until the user confirms it; never defaulted to a guessed zone.
  timezone text check (char_length(timezone) between 1 and 64),
  timezone_source text not null default 'unknown' check (timezone_source in ('unknown', 'client_hint', 'user')),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_settings_timezone_source check ((timezone is null) = (timezone_source = 'unknown'))
);

create or replace function izi.account_settings_before_write() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if tg_op = 'INSERT' or new.timezone is distinct from old.timezone then
    perform izi.assert_timezone(new.timezone);
  end if;
  return new;
end $$;

create or replace trigger t10_touch before update on izi.account_settings
  for each row execute function izi.touch_versioned();
create or replace trigger t20_rules before insert or update on izi.account_settings
  for each row execute function izi.account_settings_before_write();

create table if not exists izi.telegram_chats (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references izi.accounts(id) on delete cascade,
  chat_id bigint not null,
  chat_type text not null default 'private' check (chat_type in ('private')),
  blocked_at timestamptz,
  last_error_code text check (last_error_code ~ '^[A-Z0-9_]{1,64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telegram_chats_chat_id_key unique (chat_id),
  constraint telegram_chats_account_id_key unique (account_id, id)
);
create unique index if not exists telegram_chats_one_private_per_account
  on izi.telegram_chats(account_id) where chat_type = 'private';

-- A private chat id equals the Telegram user id: it may only be attached to
-- the account that owns that Telegram identity.
create or replace function izi.telegram_chats_before_write() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if new.chat_type = 'private' and not exists (
    select 1 from izi.identities i
     where i.account_id = new.account_id and i.provider = 'telegram' and i.subject = new.chat_id::text
  ) then
    raise exception 'VALIDATION' using errcode = 'IZ422';
  end if;
  return new;
end $$;

create or replace trigger t10_touch before update on izi.telegram_chats
  for each row execute function izi.touch_unversioned();
create or replace trigger t20_rules before insert or update on izi.telegram_chats
  for each row execute function izi.telegram_chats_before_write();

-- Atomic, race-safe "find or create" for a verified identity.
create or replace function izi.resolve_or_create_account(p_provider text, p_subject text)
returns table (account_id uuid, identity_id uuid, created boolean)
language plpgsql set search_path = pg_catalog, pg_temp as $$
#variable_conflict use_column
declare v_account uuid; v_identity uuid;
begin
  select i.account_id, i.id into v_account, v_identity
    from izi.identities i where i.provider = p_provider and i.subject = p_subject;
  if found then
    return query select v_account, v_identity, false;
    return;
  end if;

  insert into izi.accounts default values returning id into v_account;
  insert into izi.identities (account_id, provider, subject) values (v_account, p_provider, p_subject)
    on conflict (provider, subject) do nothing
    returning id into v_identity;

  if v_identity is null then
    -- A concurrent request won the race: discard our empty account, use theirs.
    delete from izi.accounts a where a.id = v_account;
    select i.account_id, i.id into v_account, v_identity
      from izi.identities i where i.provider = p_provider and i.subject = p_subject;
    return query select v_account, v_identity, false;
    return;
  end if;

  insert into izi.account_settings (account_id) values (v_account);
  return query select v_account, v_identity, true;
end $$;

-- Attaches another identity to an existing account. Never moves an identity
-- away from the account that already owns it.
create or replace function izi.link_identity(p_account uuid, p_provider text, p_subject text)
returns uuid
language plpgsql set search_path = pg_catalog, pg_temp as $$
#variable_conflict use_column
declare v_identity uuid; v_owner uuid;
begin
  insert into izi.identities (account_id, provider, subject) values (p_account, p_provider, p_subject)
    on conflict (provider, subject) do nothing
    returning id into v_identity;
  if v_identity is not null then return v_identity; end if;
  select i.account_id, i.id into v_owner, v_identity
    from izi.identities i where i.provider = p_provider and i.subject = p_subject;
  if v_owner is distinct from p_account then
    raise exception 'IDENTITY_TAKEN' using errcode = 'IZ409';
  end if;
  return v_identity;
end $$;

-- ------------------------------------------------------------- captures -----
-- Every piece of user input. The raw text is personal data kept at most
-- 30 days (D4): the retention bound is a table constraint, and purging it
-- leaves the capture and everything created from it intact.

create table if not exists izi.captures (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references izi.accounts(id) on delete cascade,
  source text not null check (source in ('telegram_text', 'telegram_voice', 'miniapp_text', 'quick_capture', 'image')),
  -- Channel-side identity of the input (e.g. "<chat>:<message>") for idempotency.
  external_ref text check (external_ref ~ '^[A-Za-z0-9:_.-]{1,128}$'),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'needs_clarification', 'preview', 'confirmed', 'discarded', 'failed', 'expired')),
  raw_text text check (char_length(raw_text) between 1 and 8000),
  raw_text_kind text check (raw_text_kind in ('typed', 'transcript', 'caption')),
  raw_text_length integer check (raw_text_length between 1 and 8000),
  raw_text_expires_at timestamptz,
  raw_text_purged_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count between 0 and 100),
  locked_at timestamptz,
  error_code text check (error_code ~ '^[A-Z0-9_]{1,64}$'),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint captures_account_id_key unique (account_id, id),
  constraint captures_external_ref_key unique (account_id, source, external_ref),
  constraint captures_raw_text_kind check (raw_text is null or raw_text_kind is not null),
  constraint captures_raw_text_retention check (
    raw_text is null or (raw_text_expires_at is not null and raw_text_expires_at <= created_at + interval '30 days')
  ),
  constraint captures_processing_lock check ((status = 'processing') = (locked_at is not null))
);
create index if not exists captures_account_created_idx on izi.captures(account_id, created_at desc);
create index if not exists captures_raw_text_expiry_idx on izi.captures(raw_text_expires_at) where raw_text is not null;
create index if not exists captures_processing_idx on izi.captures(locked_at) where status = 'processing';

-- Every non-terminal state has a way forward and a way out; nothing gets stuck.
create or replace function izi.capture_transition_allowed(p_from text, p_to text) returns boolean
language sql immutable set search_path = pg_catalog, pg_temp as $$
  select case p_from
    when 'pending' then p_to in ('processing', 'discarded', 'expired')
    when 'processing' then p_to in ('preview', 'needs_clarification', 'failed', 'discarded')
    when 'needs_clarification' then p_to in ('processing', 'discarded', 'expired')
    when 'preview' then p_to in ('confirmed', 'discarded', 'expired', 'processing')
    when 'failed' then p_to in ('processing', 'discarded', 'expired')
    else false
  end
$$;

create or replace function izi.captures_before_write() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then raise exception 'INVALID_STATE' using errcode = 'IZ423'; end if;
    new.attempt_count := 0;
    new.locked_at := null;
    new.raw_text_purged_at := null;
  else
    if new.status is distinct from old.status then
      if not izi.capture_transition_allowed(old.status, new.status) then
        raise exception 'INVALID_STATE' using errcode = 'IZ423';
      end if;
      if new.status = 'processing' then
        new.locked_at := now();
        new.attempt_count := old.attempt_count + 1;
      else
        new.locked_at := null;
      end if;
    end if;
    if old.raw_text_purged_at is not null and new.raw_text is not null then
      raise exception 'IMMUTABLE_FIELD' using errcode = 'IZ422';
    end if;
  end if;

  if new.raw_text is not null and (tg_op = 'INSERT' or old.raw_text is null or new.raw_text is distinct from old.raw_text) then
    new.raw_text_length := char_length(new.raw_text);
    new.raw_text_expires_at := least(
      coalesce(new.raw_text_expires_at, new.created_at + interval '30 days'),
      new.created_at + interval '30 days');
  end if;
  return new;
end $$;

create or replace trigger t10_touch before update on izi.captures
  for each row execute function izi.touch_versioned();
create or replace trigger t20_rules before insert or update on izi.captures
  for each row execute function izi.captures_before_write();

-- Housekeeping (scheduled in a later phase): drop raw text past retention.
create or replace function izi.purge_expired_raw_text(p_now timestamptz default now(), p_limit integer default 5000)
returns integer
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare v_count integer;
begin
  with due as (
    select c.id from izi.captures c
     where c.raw_text is not null and c.raw_text_expires_at <= p_now
     order by c.raw_text_expires_at
     limit greatest(1, least(coalesce(p_limit, 5000), 50000))
     for update skip locked
  )
  update izi.captures c set raw_text = null, raw_text_purged_at = p_now
    from due where c.id = due.id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Workers that died mid-processing: move to `failed`, which can be retried.
create or replace function izi.reap_stale_captures(p_stale_after interval default interval '5 minutes')
returns integer
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare v_count integer;
begin
  update izi.captures set status = 'failed', error_code = 'WORKER_TIMEOUT'
   where status = 'processing' and locked_at < now() - p_stale_after;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ------------------------------------------------------- inbound updates ----
-- Webhook (Phase 3): insert, answer 200 at once. Worker: claim -> process ->
-- complete, or fail -> retry/dead. An accepted update is never silently lost
-- (fixes TAVRO audit findings T1/T2). The payload is personal data: it is
-- dropped on success and never kept beyond 30 days.

create table if not exists izi.inbound_updates (
  id bigint generated always as identity primary key,
  provider text not null check (provider in ('telegram')),
  provider_update_id text not null check (provider_update_id ~ '^[A-Za-z0-9:_.-]{1,64}$'),
  -- Ordering key (e.g. the Telegram chat): updates of one chat run in order.
  chat_key text check (chat_key ~ '^[A-Za-z0-9:_.-]{1,64}$'),
  account_id uuid references izi.accounts(id) on delete cascade,
  status text not null default 'received' check (status in ('received', 'processing', 'retry', 'done', 'dead')),
  payload jsonb,
  payload_expires_at timestamptz not null default now() + interval '30 days',
  attempt_count integer not null default 0 check (attempt_count between 0 and 1000),
  max_attempts integer not null default 8 check (max_attempts between 1 and 50),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text check (locked_by ~ '^[A-Za-z0-9:_.-]{1,64}$'),
  last_error_code text check (last_error_code ~ '^[A-Z0-9_]{1,64}$'),
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint inbound_updates_provider_update_key unique (provider, provider_update_id),
  constraint inbound_updates_payload_retention check (payload_expires_at <= received_at + interval '30 days'),
  constraint inbound_updates_active_has_payload check (status not in ('received', 'processing', 'retry') or payload is not null),
  constraint inbound_updates_lock check ((status = 'processing') = (locked_at is not null and locked_by is not null))
);
create index if not exists inbound_updates_ready_idx
  on izi.inbound_updates(next_attempt_at, id) where status in ('received', 'retry');
create index if not exists inbound_updates_chat_active_idx
  on izi.inbound_updates(chat_key, id) where status in ('received', 'retry', 'processing');
create index if not exists inbound_updates_processing_idx
  on izi.inbound_updates(locked_at) where status = 'processing';
create index if not exists inbound_updates_account_idx
  on izi.inbound_updates(account_id) where account_id is not null;
create index if not exists inbound_updates_payload_expiry_idx
  on izi.inbound_updates(payload_expires_at) where payload is not null;

create or replace function izi.inbound_updates_before_update() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if new.provider is distinct from old.provider or new.provider_update_id is distinct from old.provider_update_id
     or new.received_at is distinct from old.received_at then
    raise exception 'IMMUTABLE_FIELD' using errcode = 'IZ422';
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace trigger t10_touch before update on izi.inbound_updates
  for each row execute function izi.inbound_updates_before_update();

-- Returns true when the update is new, false for a duplicate delivery.
create or replace function izi.enqueue_inbound_update(p_provider text, p_update_id text, p_chat_key text, p_payload jsonb)
returns boolean
language sql set search_path = pg_catalog, pg_temp as $$
  with inserted as (
    insert into izi.inbound_updates (provider, provider_update_id, chat_key, payload)
    values (p_provider, p_update_id, p_chat_key, p_payload)
    on conflict (provider, provider_update_id) do nothing
    returning 1
  )
  select exists (select 1 from inserted)
$$;

-- Claims ready updates. An update waits while an earlier update of the same
-- chat is still unfinished, so a user's messages are processed in order.
create or replace function izi.claim_inbound_updates(p_worker text, p_limit integer default 10)
returns setof izi.inbound_updates
language sql set search_path = pg_catalog, pg_temp as $$
  with candidates as (
    select u.id from izi.inbound_updates u
     where u.status in ('received', 'retry') and u.next_attempt_at <= now()
       and not exists (
         select 1 from izi.inbound_updates earlier
          where u.chat_key is not null and earlier.chat_key = u.chat_key and earlier.id < u.id
            and earlier.status in ('received', 'retry', 'processing'))
     order by u.id
     limit greatest(1, least(coalesce(p_limit, 10), 100))
     for update skip locked
  )
  update izi.inbound_updates u
     set status = 'processing', locked_at = now(), locked_by = p_worker, attempt_count = u.attempt_count + 1
    from candidates c
   where u.id = c.id
  returning u.*
$$;

create or replace function izi.complete_inbound_update(p_id bigint, p_worker text, p_account uuid default null)
returns boolean
language sql set search_path = pg_catalog, pg_temp as $$
  with done as (
    update izi.inbound_updates
       set status = 'done', payload = null, processed_at = now(), locked_at = null, locked_by = null,
           last_error_code = null, account_id = coalesce(p_account, account_id)
     where id = p_id and status = 'processing' and locked_by = p_worker
    returning 1
  )
  select exists (select 1 from done)
$$;

-- A failure keeps the payload for another attempt; after max_attempts the
-- update becomes `dead` (still visible, never silently dropped).
create or replace function izi.fail_inbound_update(p_id bigint, p_worker text, p_error_code text, p_retry_after_seconds integer default 30)
returns text
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare v_status text;
begin
  update izi.inbound_updates
     set status = case when attempt_count >= max_attempts then 'dead' else 'retry' end,
         next_attempt_at = now() + make_interval(secs => greatest(1, least(coalesce(p_retry_after_seconds, 30), 86400))),
         last_error_code = p_error_code, locked_at = null, locked_by = null
   where id = p_id and status = 'processing' and locked_by = p_worker
  returning status into v_status;
  if v_status is null then raise exception 'INVALID_STATE' using errcode = 'IZ423'; end if;
  return v_status;
end $$;

create or replace function izi.reap_stale_inbound_updates(p_stale_after interval default interval '5 minutes')
returns integer
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare v_count integer;
begin
  update izi.inbound_updates
     set status = case when attempt_count >= max_attempts then 'dead' else 'retry' end,
         last_error_code = 'WORKER_TIMEOUT', locked_at = null, locked_by = null, next_attempt_at = now()
   where status = 'processing' and locked_at < now() - p_stale_after;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Retention: payloads past 30 days are dropped (an unprocessed one becomes
-- `dead`), finished rows are removed after `p_keep_finished`.
create or replace function izi.purge_inbound_updates(p_now timestamptz default now(), p_keep_finished interval default interval '30 days')
returns integer
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare v_expired integer; v_deleted integer;
begin
  update izi.inbound_updates
     set status = case when status in ('received', 'retry') then 'dead' else status end,
         last_error_code = case when status in ('received', 'retry') then 'RETENTION_EXPIRED' else last_error_code end,
         payload = null
   where payload is not null and payload_expires_at <= p_now and status <> 'processing';
  get diagnostics v_expired = row_count;
  delete from izi.inbound_updates where status in ('done', 'dead') and received_at < p_now - p_keep_finished;
  get diagnostics v_deleted = row_count;
  return v_expired + v_deleted;
end $$;

-- ----------------------------------------------------------- rate limits ----
-- Per account and bucket; no global lock; cleanup is a separate job, never on
-- the user's hot path (fixes TAVRO audit finding T10 and SEVER's global lock).

create table if not exists izi.rate_limits (
  account_id uuid not null references izi.accounts(id) on delete cascade,
  bucket text not null check (bucket ~ '^[a-z][a-z0-9_.:-]{0,47}$'),
  window_start timestamptz not null,
  hits integer not null default 0 check (hits >= 0),
  primary key (account_id, bucket, window_start)
);
create index if not exists rate_limits_window_idx on izi.rate_limits(window_start);

create or replace function izi.rate_limit_hit(p_account uuid, p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare v_window timestamptz; v_hits integer;
begin
  if p_limit is null or p_limit < 1 or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'VALIDATION' using errcode = 'IZ422';
  end if;
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into izi.rate_limits as r (account_id, bucket, window_start, hits)
  values (p_account, p_bucket, v_window, 1)
  on conflict (account_id, bucket, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;
  return v_hits <= p_limit;
end $$;

create or replace function izi.cleanup_rate_limits(p_before timestamptz)
returns integer
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare v_count integer;
begin
  delete from izi.rate_limits where window_start < p_before;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------- ai runs ---
-- Cost and quality accounting for AI calls (Phase 6+). Deliberately has no
-- column for prompts, phrases, transcripts or model output.

create table if not exists izi.ai_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references izi.accounts(id) on delete cascade,
  capture_id uuid,
  request_key text not null check (request_key ~ '^[A-Za-z0-9:_.-]{1,128}$'),
  purpose text not null check (purpose in ('interpret', 'transcribe', 'answer', 'vision')),
  provider text not null check (provider ~ '^[a-z0-9_.-]{1,40}$'),
  model text not null check (model ~ '^[A-Za-z0-9_.:/-]{1,100}$'),
  prompt_version text check (prompt_version ~ '^[A-Za-z0-9_.-]{1,40}$'),
  schema_version text check (schema_version ~ '^[A-Za-z0-9_.-]{1,40}$'),
  status text not null default 'started' check (status in ('started', 'succeeded', 'failed')),
  error_code text check (error_code ~ '^[A-Z0-9_]{1,64}$'),
  billable boolean not null default true,
  usage_date date not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  audio_seconds numeric(8, 2) not null default 0 check (audio_seconds >= 0),
  latency_ms integer not null default 0 check (latency_ms >= 0),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint ai_runs_request_key unique (account_id, request_key),
  constraint ai_runs_account_id_key unique (account_id, id),
  constraint ai_runs_capture_fk foreign key (account_id, capture_id) references izi.captures(account_id, id)
);
create index if not exists ai_runs_usage_idx on izi.ai_runs(account_id, usage_date) where billable;
create index if not exists ai_runs_capture_idx on izi.ai_runs(account_id, capture_id) where capture_id is not null;

-- ------------------------------------------------------------ privileges ----
-- Re-run at the end of every migration. Append-only tables get no UPDATE/DELETE.

create or replace function izi._secure_schema() returns void
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare t record; client text;
begin
  for t in select tablename from pg_catalog.pg_tables where schemaname = 'izi' loop
    execute format('alter table izi.%I enable row level security', t.tablename);
    execute format('revoke all on table izi.%I from public', t.tablename);
    foreach client in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_catalog.pg_roles where rolname = client) then
        execute format('revoke all on table izi.%I from %I', t.tablename, client);
      end if;
    end loop;
    if exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
      execute format('revoke all on table izi.%I from service_role', t.tablename);
      if t.tablename = 'system_config' then
        execute format('grant select on table izi.%I to service_role', t.tablename);
      elsif t.tablename in ('activity_log') then
        execute format('grant select, insert on table izi.%I to service_role', t.tablename);
      else
        execute format('grant select, insert, update, delete on table izi.%I to service_role', t.tablename);
      end if;
    end if;
  end loop;

  revoke all on all functions in schema izi from public;
  revoke all on all sequences in schema izi from public;
  revoke all on schema izi from public;
  foreach client in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_catalog.pg_roles where rolname = client) then
      execute format('revoke all on all functions in schema izi from %I', client);
      execute format('revoke all on all sequences in schema izi from %I', client);
      execute format('revoke all on schema izi from %I', client);
    end if;
  end loop;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    grant usage on schema izi to service_role;
    grant execute on all functions in schema izi to service_role;
    grant usage, select on all sequences in schema izi to service_role;
    revoke execute on function izi._secure_schema() from service_role;
  end if;
end $$;

select izi._secure_schema();
