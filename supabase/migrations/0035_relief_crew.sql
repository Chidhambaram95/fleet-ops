-- Relief crew: someone takes over part-way through a day.
-- Run after 0034. Safe to run more than once.
--
-- day_crew keeps one driver, one conductor and one cleaner per bus per day:
-- the person who started the duty. If a conductor falls sick and leaves half
-- way, the office adds a relief row here. The first person stays in day_crew;
-- the relief is added with the trip number they took over from. The trip
-- number is optional, because not every day is counted in trips.
--
-- day_crew itself is unchanged, so the app keeps working before and after
-- this migration. Nobody works two buses on one day (the owner's answer), so a
-- person can appear once per day across day_crew and day_crew_relief.

create table if not exists public.day_crew_relief (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  day date not null,
  bus_id uuid not null references public.buses (id) on delete cascade,
  duty text not null check (duty in ('driver', 'conductor', 'cleaner')),
  person_id uuid not null references public.crew_people (id) on delete restrict,
  -- The trip number the relief took over from (optional).
  from_trip integer check (from_trip is null or (from_trip >= 1 and from_trip <= 99)),
  note text not null default '' check (length(note) <= 300),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A person relieves on a bus and duty once a day.
  unique (bus_id, day, duty, person_id)
);

create index if not exists day_crew_relief_org_day_idx on public.day_crew_relief (organization_id, day);
create index if not exists day_crew_relief_person_idx on public.day_crew_relief (person_id, day);

alter table public.day_crew_relief enable row level security;
grant select, insert, update, delete on public.day_crew_relief to authenticated;

drop policy if exists "Admins and managers manage" on public.day_crew_relief;
create policy "Admins and managers manage"
  on public.day_crew_relief for all to authenticated
  using (public.is_trip_editor(organization_id) or public.is_super_admin())
  with check (public.is_trip_editor(organization_id));

drop policy if exists "Overdue companies are view-only" on public.day_crew_relief;
create policy "Overdue companies are view-only"
  on public.day_crew_relief as restrictive for all to authenticated
  using (true)
  with check (public.org_in_good_standing(organization_id));

drop policy if exists "Overdue companies are view-only (delete)" on public.day_crew_relief;
create policy "Overdue companies are view-only (delete)"
  on public.day_crew_relief as restrictive for delete to authenticated
  using (public.org_in_good_standing(organization_id));

drop policy if exists "Managers stay in their module" on public.day_crew_relief;
create policy "Managers stay in their module"
  on public.day_crew_relief as restrictive for all to authenticated
  using (public.module_allows(organization_id, public.bus_module(bus_id)))
  with check (public.module_allows(organization_id, public.bus_module(bus_id)));

create or replace function public.check_day_crew_relief()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_primary uuid;
begin
  if not exists (
    select 1 from public.buses as b
    where b.id = new.bus_id and b.organization_id = new.organization_id and b.bus_type = 'town'
  ) then
    raise exception 'Relief crew is kept for Town buses of this company only.';
  end if;
  if not exists (
    select 1 from public.crew_people as p
    where p.id = new.person_id and p.organization_id = new.organization_id and p.module = 'town'
  ) then
    raise exception 'That person is not in this company''s Town crew.';
  end if;
  if tg_op = 'INSERT' or new.person_id <> old.person_id then
    if not exists (select 1 from public.crew_people where id = new.person_id and active) then
      raise exception 'That person has left. Pick someone who still works here.';
    end if;
  end if;
  if new.day > public.today_ist() then
    raise exception 'You can set relief crew for today or an earlier day.';
  end if;

  -- There must be someone to relieve.
  select c.person_id into v_primary
  from public.day_crew as c
  where c.bus_id = new.bus_id and c.day = new.day and c.duty = new.duty;
  if v_primary is null then
    raise exception 'Set who started this duty on the bus first, then add the relief.';
  end if;
  if v_primary = new.person_id then
    raise exception 'The relief must be a different person from the one who started.';
  end if;

  -- Nobody works two buses on one day (a bus change counts as the same day).
  if exists (
    select 1 from public.day_crew as c
    where c.day = new.day and c.person_id = new.person_id and c.bus_id <> new.bus_id
  ) or exists (
    select 1 from public.day_crew_relief as r
    where r.day = new.day and r.person_id = new.person_id and r.bus_id <> new.bus_id
      and r.id is distinct from new.id
  ) then
    raise exception 'That person is already on another bus today.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists day_crew_relief_check on public.day_crew_relief;
create trigger day_crew_relief_check
  before insert or update on public.day_crew_relief
  for each row execute function public.check_day_crew_relief();

-- day_crew itself must not put a person on two buses either. The check lives
-- here, as a separate trigger, so check_day_crew from 0023 stays as it is.
create or replace function public.check_day_crew_one_bus()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.day_crew as c
    where c.day = new.day and c.person_id = new.person_id and c.bus_id <> new.bus_id
      and c.id is distinct from new.id
  ) or exists (
    select 1 from public.day_crew_relief as r
    where r.day = new.day and r.person_id = new.person_id and r.bus_id <> new.bus_id
  ) then
    raise exception 'That person is already on another bus today.';
  end if;
  return new;
end;
$$;

drop trigger if exists day_crew_one_bus on public.day_crew;
create trigger day_crew_one_bus
  before insert or update on public.day_crew
  for each row execute function public.check_day_crew_one_bus();

-- Same as 0023 (the latest copy), plus day_crew_relief, so a relief freezes with its day.
create or replace function public.freeze_key(p_table text, p_row jsonb, out k_day date, out k_trip uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_trip public.trips;
begin
  if p_row is null then
    return;
  end if;
  case p_table
    when 'daily_entries' then
      if coalesce(public.bus_module((p_row ->> 'bus_id')::uuid), '') <> 'tour' then
        k_day := (p_row ->> 'entry_date')::date;
      end if;
    when 'day_crew', 'day_crew_relief' then
      k_day := (p_row ->> 'day')::date;
    when 'trips', 'trip_items' then
      if p_table = 'trips' then
        v_trip := jsonb_populate_record(null::public.trips, p_row);
      else
        select * into v_trip from public.trips where id = (p_row ->> 'trip_id')::uuid;
      end if;
      if v_trip.status = 'approved'
        and v_trip.approved_at is not null
        and coalesce(public.bus_module(v_trip.bus_id), '') <> 'tour'
      then
        k_day := (v_trip.approved_at at time zone 'Asia/Kolkata')::date;
        k_trip := v_trip.id;
      end if;
    when 'pump_statements' then
      if p_row ->> 'module' <> 'tour' then k_day := (p_row ->> 'statement_on')::date; end if;
    when 'pump_payments' then
      if p_row ->> 'module' <> 'tour' then k_day := (p_row ->> 'paid_on')::date; end if;
    when 'company_expenses' then
      k_day := (p_row ->> 'spent_on')::date;
    when 'salary_payments' then
      k_day := (p_row ->> 'paid_on')::date;
    when 'intercity_income' then
      k_day := (p_row ->> 'received_on')::date;
    else
      null;
  end case;
end;
$$;

-- Same as 0029 (the latest copy), plus day_crew_relief.
create or replace function public.row_module(p_table text, p_row jsonb)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_table in ('daily_entries', 'trips', 'renewals', 'day_crew', 'day_crew_relief') and p_row ->> 'bus_id' is not null
      then public.bus_module((p_row ->> 'bus_id')::uuid)
    when p_table = 'renewals' then public.person_module((p_row ->> 'person_id')::uuid)
    when p_table in ('pump_statements', 'pump_payments', 'crew_people') then p_row ->> 'module'
    when p_table = 'salary_payments' then public.person_module((p_row ->> 'person_id')::uuid)
    when p_table in ('tour_bookings', 'tour_payments') then 'tour'
    when p_table = 'intercity_income' then 'omni'
    when p_table = 'bus_loans' then (
      select min(public.bus_module(x.id::uuid)) from jsonb_array_elements_text(p_row -> 'bus_ids') as x(id)
      having count(distinct public.bus_module(x.id::uuid)) = 1
    )
    when p_table = 'loan_emis' then (
      select min(public.bus_module(x.id)) from unnest(public.loan_bus_ids((p_row ->> 'loan_id')::uuid)) as x(id)
      having count(distinct public.bus_module(x.id)) = 1
    )
    else null
  end;
$$;

drop trigger if exists guard_frozen on public.day_crew_relief;
create trigger guard_frozen before insert or update or delete on public.day_crew_relief
  for each row execute function public.guard_frozen_rows();

drop trigger if exists record_change on public.day_crew_relief;
create trigger record_change after insert or update or delete on public.day_crew_relief
  for each row execute function public.record_change();

-- Closing a day: a relief counts as crew too, so the "missing" check is unchanged.
-- (A bus needs a driver and a conductor; the one who started satisfies that.)

-- The crew on a bus for a day, in order: who started, then reliefs by trip.
create or replace function public.bus_day_crew(p_org uuid, p_day date)
returns table (bus_id uuid, duty text, person_id uuid, relief boolean, from_trip integer)
language sql
stable
security invoker
set search_path = public
as $$
  select c.bus_id, c.duty, c.person_id, false, null::integer
  from public.day_crew as c
  where c.organization_id = p_org and c.day = p_day
  union all
  select r.bus_id, r.duty, r.person_id, true, r.from_trip
  from public.day_crew_relief as r
  where r.organization_id = p_org and r.day = p_day
  order by 1, 2, 4, 5 nulls last;
$$;

revoke all on function public.bus_day_crew(uuid, date) from public, anon;
grant execute on function public.bus_day_crew(uuid, date) to authenticated;
