-- Run ONCE per database, as the owner, after migrations 001-004.
-- Replace nothing else. For the shared Supabase project use 'staging'.
insert into izi.system_config (product, environment, declared_by)
values ('izi_planner', 'staging', 'owner-phase3a');
select izi.assert_environment('staging');
