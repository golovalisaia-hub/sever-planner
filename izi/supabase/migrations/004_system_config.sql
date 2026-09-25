-- IZI Planner · 004 · environment marker.
--
-- The Supabase project is shared with other products (Academy, archived
-- SEVER), so a project ref alone does not prove where a test or script is
-- about to write. Every integration test and operator script must first read
-- this marker and stop unless product = 'izi_planner' and the environment is
-- the one it expects. The migration creates the table but inserts NO row: the
-- environment is declared once per database by an operator
-- (izi/scripts/phase3a/set-environment-marker.sql), never guessed.

create table if not exists izi.system_config (
  singleton boolean primary key default true check (singleton),
  product text not null check (product = 'izi_planner'),
  environment text not null check (environment in ('local', 'staging', 'production')),
  declared_at timestamptz not null default now(),
  declared_by text not null check (declared_by ~ '^[A-Za-z0-9:_.@-]{1,64}$')
);

-- The marker is written once; changing environment requires deliberately
-- deleting the row as the owner, never an UPDATE from application code.
create or replace function izi.system_config_guard() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  raise exception 'IMMUTABLE_FIELD' using errcode = 'IZ422';
end $$;

create or replace trigger t10_guard before update on izi.system_config
  for each row execute function izi.system_config_guard();

-- Returns the marker or raises: callers never proceed on a missing marker.
create or replace function izi.assert_environment(p_expected text)
returns text
language plpgsql stable set search_path = pg_catalog, pg_temp as $$
declare v_product text; v_environment text;
begin
  select c.product, c.environment into v_product, v_environment from izi.system_config c where c.singleton;
  if v_product is null then
    raise exception 'ENVIRONMENT_MARKER_MISSING' using errcode = 'IZ423';
  end if;
  if v_product <> 'izi_planner' or v_environment is distinct from p_expected then
    raise exception 'ENVIRONMENT_MISMATCH' using errcode = 'IZ423';
  end if;
  return v_environment;
end $$;

-- _secure_schema grants the server role SELECT only on system_config.
select izi._secure_schema();
