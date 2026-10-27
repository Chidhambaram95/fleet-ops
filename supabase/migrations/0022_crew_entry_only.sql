-- Crew only enter money and odometer readings. Run after 0021. Safe to run more than once.
--
-- 1. Crew no longer read or change day-book entries. They can still add money
--    in and money out for their own bus; admins and managers see the totals.
-- 2. Odometer readings: crew (and admins and managers) note the km on a bus.
--    A reading can't be lower than the last one known for that bus.

-- ---------------------------------------------------------------------------
-- Day book: crew add only
-- ---------------------------------------------------------------------------

drop policy if exists "Crew read assigned entries" on public.daily_entries;
drop policy if exists "Crew update assigned entries" on public.daily_entries;
drop policy if exists "Crew delete assigned entries" on public.daily_entries;

-- ---------------------------------------------------------------------------
-- Odometer readings
-- ---------------------------------------------------------------------------

create table if not exists public.odometer_readings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bus_id uuid not null references public.buses(id) on delete cascade,
  reading_date date not null default public.today_ist(),
  odometer_km integer not null check (odometer_km >= 0 and odometer_km <= 9999999),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists odometer_readings_bus_idx
  on public.odometer_readings (organization_id, bus_id, odometer_km desc);

alter table public.odometer_readings enable row level security;

grant select, insert, delete on public.odometer_readings to authenticated;

-- The highest km known for a bus: trip sheets, tyre moves and readings.
create or replace function public.bus_latest_odometer(p_bus uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select max(km) from (
    select max(end_km) as km from public.trips where bus_id = p_bus
    union all
    select max(odometer_km) from public.tyre_events where bus_id = p_bus
    union all
    select max(odometer_km) from public.odometer_readings where bus_id = p_bus
  ) as readings;
$$;

revoke all on function public.bus_latest_odometer(uuid) from public;
grant execute on function public.bus_latest_odometer(uuid) to authenticated;

create or replace function public.check_odometer_reading()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last integer;
begin
  if not exists (
    select 1 from public.buses
    where id = new.bus_id and organization_id = new.organization_id
  ) then
    raise exception 'That bus is not in this company.';
  end if;
  v_last := public.bus_latest_odometer(new.bus_id);
  if v_last is not null and new.odometer_km < v_last then
    raise exception 'The odometer (% km) is less than the last reading on this bus (% km).',
      new.odometer_km, v_last;
  end if;
  return new;
end;
$$;

drop trigger if exists odometer_readings_check on public.odometer_readings;
create trigger odometer_readings_check
  before insert on public.odometer_readings
  for each row execute function public.check_odometer_reading();

drop policy if exists "Admins and managers read odometer" on public.odometer_readings;
create policy "Admins and managers read odometer"
  on public.odometer_readings for select to authenticated
  using (
    public.get_user_role(organization_id) in ('owner', 'admin', 'manager', 'fleet_manager', 'member')
    or public.is_super_admin()
  );

drop policy if exists "Admins and managers add odometer" on public.odometer_readings;
create policy "Admins and managers add odometer"
  on public.odometer_readings for insert to authenticated
  with check (
    public.get_user_role(organization_id) in ('owner', 'admin', 'manager', 'fleet_manager', 'member')
    and created_by = auth.uid()
  );

drop policy if exists "Crew add odometer for their bus" on public.odometer_readings;
create policy "Crew add odometer for their bus"
  on public.odometer_readings for insert to authenticated
  with check (
    public.get_user_role(organization_id) = 'crew'
    and public.is_assigned_to_bus(bus_id)
    and created_by = auth.uid()
  );

drop policy if exists "Admins delete odometer" on public.odometer_readings;
create policy "Admins delete odometer"
  on public.odometer_readings for delete to authenticated
  using (public.get_user_role(organization_id) in ('owner', 'admin'));

drop policy if exists "Overdue companies are view-only (insert)" on public.odometer_readings;
create policy "Overdue companies are view-only (insert)"
  on public.odometer_readings as restrictive
  for insert
  to authenticated
  with check (public.org_in_good_standing(organization_id));

drop policy if exists "Managers stay in their module" on public.odometer_readings;
create policy "Managers stay in their module"
  on public.odometer_readings as restrictive
  for all
  to authenticated
  using (public.module_allows(organization_id, public.bus_module(bus_id)))
  with check (public.module_allows(organization_id, public.bus_module(bus_id)));
