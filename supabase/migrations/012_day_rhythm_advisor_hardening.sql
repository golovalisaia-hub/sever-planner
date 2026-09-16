-- SEVER v115.1: close the two advisor findings introduced by day rhythm.
begin;

create index if not exists push_rhythm_deliveries_user_id_idx
  on public.push_rhythm_deliveries(user_id);

drop policy if exists "rhythm deliveries deny browser access" on public.push_rhythm_deliveries;
create policy "rhythm deliveries deny browser access"
  on public.push_rhythm_deliveries
  for all
  to anon, authenticated
  using (false)
  with check (false);

commit;
