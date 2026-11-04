-- Days run, cost spreading and off-road days. Run after 0025. Safe to run
-- more than once.
--
-- 1. A day counts as a day the bus ran only if it had an approved trip on the
--    road, money in, a running cost (diesel, AdBlue, toll, crew bata, police,
--    parking), an odometer reading higher than the one before, or a driver or
--    conductor on the Town day crew. A repair or "other" bill alone, or an
--    odometer that hasn't moved, no longer counts. A day marked off road never
--    counts.
-- 2. Company costs can be spread over 1, 3, 6 or 12 months (old costs stay at
--    1 month), can repeat every month, and have two new categories: insurance
--    and permit / FC / tax.
-- 3. bus_off_road: the days a bus stood off the road (breakdown, FC, no permit).

-- ---------------------------------------------------------------------------
-- Company costs: spread, repeat and new categories
-- ---------------------------------------------------------------------------

alter table public.company_expenses
  add column if not exists spread_months integer not null default 1;
alter table public.company_expenses
  add column if not exists repeat_monthly boolean not null default false;

alter table public.company_expenses drop constraint if exists company_expenses_spread_months_check;
alter table public.company_expenses
  add constraint company_expenses_spread_months_check check (spread_months in (1, 3, 6, 12));

alter table public.company_expenses drop constraint if exists company_expenses_category_check;
alter table public.company_expenses
  add constraint company_expenses_category_check check (category in (
    'accident_repair', 'workshop', 'tyre_retread', 'new_purchase',
    'manager_salary', 'auditor', 'office', 'loan_emi', 'insurance', 'permit_tax', 'other'
  ));

-- ---------------------------------------------------------------------------
-- Off-road days
-- ---------------------------------------------------------------------------

create table if not exists public.bus_off_road (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  bus_id uuid not null references public.buses (id) on delete cascade,
  day date not null,
  reason text not null default 'breakdown' check (reason in ('breakdown', 'fc_permit', 'no_crew', 'other')),
  note text not null default '' check (length(note) <= 300),
  created_by uuid default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  unique (bus_id, day)
);

create index if not exists bus_off_road_org_day_idx
  on public.bus_off_road (organization_id, day);

alter table public.bus_off_road enable row level security;

grant select, insert, delete on public.bus_off_road to authenticated;

create or replace function public.check_bus_off_road_bus()
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

drop trigger if exists bus_off_road_check_bus on public.bus_off_road;
create trigger bus_off_road_check_bus
  before insert on public.bus_off_road
  for each row execute function public.check_bus_off_road_bus();

drop policy if exists "Admins and managers read off-road days" on public.bus_off_road;
create policy "Admins and managers read off-road days"
  on public.bus_off_road for select to authenticated
  using (public.is_trip_editor(organization_id) or public.is_super_admin());

drop policy if exists "Admins and managers mark off-road days" on public.bus_off_road;
create policy "Admins and managers mark off-road days"
  on public.bus_off_road for insert to authenticated
  with check (public.is_trip_editor(organization_id));

drop policy if exists "Admins and managers remove off-road days" on public.bus_off_road;
create policy "Admins and managers remove off-road days"
  on public.bus_off_road for delete to authenticated
  using (public.is_trip_editor(organization_id));

drop policy if exists "Overdue companies are view-only (insert)" on public.bus_off_road;
create policy "Overdue companies are view-only (insert)"
  on public.bus_off_road as restrictive
  for insert
  to authenticated
  with check (public.org_in_good_standing(organization_id));

drop policy if exists "Overdue companies are view-only (delete)" on public.bus_off_road;
create policy "Overdue companies are view-only (delete)"
  on public.bus_off_road as restrictive
  for delete
  to authenticated
  using (public.org_in_good_standing(organization_id));

drop policy if exists "Managers stay in their module" on public.bus_off_road;
create policy "Managers stay in their module"
  on public.bus_off_road as restrictive
  for all
  to authenticated
  using (public.module_allows(organization_id, public.bus_module(bus_id)))
  with check (public.module_allows(organization_id, public.bus_module(bus_id)));

-- ---------------------------------------------------------------------------
-- Days run
-- ---------------------------------------------------------------------------

-- Days each bus of the company ran between two dates (see the rule at the
-- top). Security definer so a manager limited to one module still gets every
-- bus's days (only ids, types and day counts, no money), and their buses'
-- shares match the admin's.
create or replace function public.company_bus_days(p_org uuid, p_from date, p_to date)
returns table (bus_id uuid, bus_type text, days integer)
language sql
stable
security definer
set search_path = public
as $$
  with readings as (
    select o.bus_id, o.reading_date as day, o.odometer_km,
      lag(o.odometer_km) over (partition by o.bus_id order by o.reading_date, o.created_at) as previous_km
    from public.odometer_readings as o
    where o.organization_id = p_org and o.reading_date <= p_to
  ),
  ran as (
    select e.bus_id, e.entry_date as day
    from public.daily_entries as e
    where e.organization_id = p_org
      and e.entry_date between p_from and p_to
      and (e.kind = 'income' or e.category in ('diesel', 'adblue', 'toll', 'crew_bata', 'police', 'parking'))
    union
    select r.bus_id, r.day
    from readings as r
    where r.day between p_from and p_to and r.previous_km is not null and r.odometer_km > r.previous_km
    union
    select c.bus_id, c.day
    from public.day_crew as c
    where c.organization_id = p_org and c.day between p_from and p_to
    union
    select t.bus_id, g.day::date
    from public.trips as t
    cross join lateral generate_series(
      greatest((t.started_at at time zone 'Asia/Kolkata')::date, p_from),
      least(coalesce((t.ended_at at time zone 'Asia/Kolkata')::date, (t.started_at at time zone 'Asia/Kolkata')::date), p_to),
      interval '1 day'
    ) as g(day)
    where t.organization_id = p_org
      and t.status = 'approved'
      and t.started_at is not null
      and (t.started_at at time zone 'Asia/Kolkata')::date <= p_to
      and coalesce(t.ended_at, t.started_at) >= (p_from::timestamp at time zone 'Asia/Kolkata')
  ),
  counted as (
    select ran.bus_id, ran.day
    from ran
    where not exists (
      select 1 from public.bus_off_road as f
      where f.bus_id = ran.bus_id and f.day = ran.day
    )
  )
  select b.id, b.bus_type, count(counted.day)::integer
  from public.buses as b
  left join counted on counted.bus_id = b.id
  where b.organization_id = p_org
    and public.is_trip_editor(p_org)
  group by b.id, b.bus_type;
$$;

revoke all on function public.company_bus_days(uuid, date, date) from public, anon;
grant execute on function public.company_bus_days(uuid, date, date) to authenticated;
