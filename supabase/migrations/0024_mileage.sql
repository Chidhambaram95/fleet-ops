-- Mileage: town diesel litres, bus targets, and alerts the office has checked.
-- Run after 0022 (and 0023 if you have it). Safe to run more than once.
--
-- 1. A town diesel entry can carry the odometer, the litres and whether the
--    tank was filled to full. Mileage is worked out from one full tank to the
--    next: km between the two readings divided by the litres put in.
-- 2. Each bus can have its own expected km per litre and its tank size.
-- 3. mileage_checks records each mileage alert someone marked as checked, so
--    it stops showing as open. The alerts themselves are worked out by the app.

-- ---------------------------------------------------------------------------
-- Town diesel: odometer, litres and full tank
-- ---------------------------------------------------------------------------

alter table public.daily_entries
  add column if not exists litres numeric(8, 2),
  add column if not exists odometer_km integer,
  add column if not exists full_tank boolean not null default false;

alter table public.daily_entries drop constraint if exists daily_entries_diesel_figures_check;
alter table public.daily_entries
  add constraint daily_entries_diesel_figures_check check (
    (litres is null or (litres > 0 and litres <= 2000 and category = 'diesel'))
    and (odometer_km is null or (odometer_km >= 0 and odometer_km <= 9999999 and category = 'diesel'))
    and (not full_tank or category = 'diesel')
  );

create index if not exists daily_entries_diesel_idx
  on public.daily_entries (organization_id, bus_id, entry_date)
  where category = 'diesel' and litres is not null;

-- ---------------------------------------------------------------------------
-- Bus targets
-- ---------------------------------------------------------------------------

alter table public.buses
  add column if not exists target_kmpl numeric(4, 2),
  add column if not exists tank_litres integer;

alter table public.buses drop constraint if exists buses_mileage_targets_check;
alter table public.buses
  add constraint buses_mileage_targets_check check (
    (target_kmpl is null or (target_kmpl >= 1 and target_kmpl <= 15))
    and (tank_litres is null or (tank_litres >= 20 and tank_litres <= 1000))
  );

-- ---------------------------------------------------------------------------
-- Checked mileage alerts
-- ---------------------------------------------------------------------------

create table if not exists public.mileage_checks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  bus_id uuid not null references public.buses (id) on delete cascade,
  -- Which alert: its rule and the trip or fill it is about, e.g. "drop:trip:<id>".
  alert_key text not null check (length(alert_key) between 3 and 200),
  note text not null default '' check (length(note) <= 500),
  checked_by uuid not null default auth.uid() references auth.users (id),
  checked_at timestamptz not null default now(),
  unique (organization_id, alert_key)
);

create index if not exists mileage_checks_bus_idx
  on public.mileage_checks (organization_id, bus_id);

alter table public.mileage_checks enable row level security;

grant select, insert, delete on public.mileage_checks to authenticated;

create or replace function public.check_mileage_check_bus()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.buses
    where id = new.bus_id and organization_id = new.organization_id
  ) then
    raise exception 'That bus is not in this company.';
  end if;
  return new;
end;
$$;

drop trigger if exists mileage_checks_check_bus on public.mileage_checks;
create trigger mileage_checks_check_bus
  before insert on public.mileage_checks
  for each row execute function public.check_mileage_check_bus();

drop policy if exists "Admins and managers read mileage checks" on public.mileage_checks;
create policy "Admins and managers read mileage checks"
  on public.mileage_checks for select to authenticated
  using (public.is_trip_editor(organization_id) or public.is_super_admin());

drop policy if exists "Admins and managers check mileage" on public.mileage_checks;
create policy "Admins and managers check mileage"
  on public.mileage_checks for insert to authenticated
  with check (public.is_trip_editor(organization_id) and checked_by = auth.uid());

drop policy if exists "Admins and managers undo mileage checks" on public.mileage_checks;
create policy "Admins and managers undo mileage checks"
  on public.mileage_checks for delete to authenticated
  using (public.is_trip_editor(organization_id));

drop policy if exists "Overdue companies are view-only (insert)" on public.mileage_checks;
create policy "Overdue companies are view-only (insert)"
  on public.mileage_checks as restrictive
  for insert
  to authenticated
  with check (public.org_in_good_standing(organization_id));

drop policy if exists "Managers stay in their module" on public.mileage_checks;
create policy "Managers stay in their module"
  on public.mileage_checks as restrictive
  for all
  to authenticated
  using (public.module_allows(organization_id, public.bus_module(bus_id)))
  with check (public.module_allows(organization_id, public.bus_module(bus_id)));
