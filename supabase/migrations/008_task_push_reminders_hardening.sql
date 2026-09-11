-- SEVER task reminder hardening v82.
-- The delivery ledger is server-only; indexes keep cascades predictable as it grows.
begin;

create index if not exists push_deliveries_subscription_id_idx
  on public.push_deliveries(subscription_id);
create index if not exists push_deliveries_user_id_idx
  on public.push_deliveries(user_id);

drop policy if exists "push deliveries are server only" on public.push_deliveries;
create policy "push deliveries are server only" on public.push_deliveries
  for all to authenticated
  using (false)
  with check (false);

commit;
