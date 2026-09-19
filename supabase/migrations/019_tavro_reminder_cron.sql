-- TAVRO reminder dispatch schedule. Apply after 018.
--
-- Secrets live in Supabase Vault and are provisioned out of band; nothing here
-- stores a token, and the job is independent of SEVER's own push schedule.
--
-- Required Vault secrets:
--   tavro_project_url  — https://<project-ref>.supabase.co
--   tavro_cron_secret  — same value as the TAVRO_CRON_SECRET function secret
begin;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'tavro-reminder-dispatch' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;

  -- Every minute: a reminder is only useful when it is on time, and the claim
  -- function makes overlapping runs safe.
  perform cron.schedule('tavro-reminder-dispatch', '* * * * *', $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'tavro_project_url' limit 1) || '/functions/v1/tavro-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'tavro_cron_secret' limit 1)
      ),
      body := jsonb_build_object('source', 'cron', 'at', now()),
      timeout_milliseconds := 20000
    );
  $cron$);
end $$;

-- Housekeeping: pending drafts older than their expiry stop being offered, and
-- stale rate-limit windows are dropped. Records themselves are never deleted.
create or replace function public.tavro_expire_captures()
returns integer language sql security definer set search_path = public as $$
  with expired as (
    update public.tavro_captures set status = 'expired', updated_at = now()
     where status = 'pending' and expires_at < now()
    returning 1
  )
  select count(*)::integer from expired;
$$;

revoke all on function public.tavro_expire_captures() from public, anon, authenticated;
grant execute on function public.tavro_expire_captures() to service_role;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'tavro-housekeeping' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule('tavro-housekeeping', '17 * * * *', $cron$
    select public.tavro_expire_captures();
  $cron$);
end $$;

commit;
