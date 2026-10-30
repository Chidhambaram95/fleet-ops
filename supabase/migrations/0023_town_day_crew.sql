-- Town day crew: who drove and who was conductor on each Town bus each day.
-- Run after 0022. Safe to run more than once.
--
-- 1. Conductors join drivers and cleaners in the Crew list.
-- 2. day_crew: an admin or manager picks the driver and conductor (and, if
--    they like, the cleaner) for each Town bus on a day.
-- 3. A day can't be closed while a Town bus with money entries that day has
--    no driver or no conductor.

-- ---------------------------------------------------------------------------
-- Conductors
-- ---------------------------------------------------------------------------

alter table public.crew_people drop constraint if exists crew_people_job_check;
alter table public.crew_people
  add constraint crew_people_job_check check (job in ('driver', 'conductor', 'cleaner'));

-- ---------------------------------------------------------------------------
-- Day crew
-- ---------------------------------------------------------------------------

create table if not exists public.day_crew (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  day date not null,
  bus_id uuid not null references public.buses (id) on delete cascade,
  duty text not null check (duty in ('driver', 'conductor', 'cleaner')),
  person_id uuid not null references public.crew_people (id) on delete restrict,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One driver, one conductor and one cleaner per bus per day.
  unique (bus_id, day, duty)
);

create index if not exists day_crew_org_day_idx on public.day_crew (organization_id, day);
create index if not exists day_crew_person_idx on public.day_crew (person_id, day);

alter table public.day_crew enable row level security;
grant select, insert, update, delete on public.day_crew to authenticated;

-- Admins and managers keep the day crew; crew logins don't see it.
drop policy if exists "Admins and managers manage" on public.day_crew;
create policy "Admins and managers manage"
  on public.day_crew for all to authenticated
  using (public.is_trip_editor(organization_id) or public.is_super_admin())
  with check (public.is_trip_editor(organization_id));

drop policy if exists "Overdue companies are view-only" on public.day_crew;
create policy "Overdue companies are view-only"
  on public.day_crew as restrictive for all to authenticated
  using (true)
  with check (public.org_in_good_standing(organization_id));

drop policy if exists "Overdue companies are view-only (delete)" on public.day_crew;
create policy "Overdue companies are view-only (delete)"
  on public.day_crew as restrictive for delete to authenticated
  using (public.org_in_good_standing(organization_id));

drop policy if exists "Managers stay in their module" on public.day_crew;
create policy "Managers stay in their module"
  on public.day_crew as restrictive for all to authenticated
  using (public.module_allows(organization_id, public.bus_module(bus_id)))
  with check (public.module_allows(organization_id, public.bus_module(bus_id)));

-- The bus must be a Town bus of the same company, and the person a Town
-- crew member of that company who still works there.
create or replace function public.check_day_crew()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.buses as b
    where b.id = new.bus_id and b.organization_id = new.organization_id and b.bus_type = 'town'
  ) then
    raise exception 'Day crew is kept for Town buses of this company only.';
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
    raise exception 'You can set the crew for today or an earlier day.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists day_crew_check on public.day_crew;
create trigger day_crew_check
  before insert or update on public.day_crew
  for each row execute function public.check_day_crew();

-- ---------------------------------------------------------------------------
-- Day crew freezes with its day and is kept in Change history
-- ---------------------------------------------------------------------------

-- Same as 0018, plus day_crew.
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
    when 'day_crew' then
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

-- Same as 0018, plus day_crew.
create or replace function public.row_module(p_table text, p_row jsonb)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_table in ('daily_entries', 'trips', 'renewals', 'day_crew') and p_row ->> 'bus_id' is not null
      then public.bus_module((p_row ->> 'bus_id')::uuid)
    when p_table = 'renewals' then public.person_module((p_row ->> 'person_id')::uuid)
    when p_table in ('pump_statements', 'pump_payments', 'crew_people') then p_row ->> 'module'
    when p_table = 'salary_payments' then public.person_module((p_row ->> 'person_id')::uuid)
    when p_table in ('tour_bookings', 'tour_payments') then 'tour'
    when p_table = 'intercity_income' then 'omni'
    else null
  end;
$$;

revoke all on function public.row_module(text, jsonb) from public;

drop trigger if exists guard_frozen on public.day_crew;
create trigger guard_frozen before insert or update or delete on public.day_crew
  for each row execute function public.guard_frozen_rows();

drop trigger if exists record_change on public.day_crew;
create trigger record_change after insert or update or delete on public.day_crew
  for each row execute function public.record_change();

-- ---------------------------------------------------------------------------
-- Closing a day needs every working Town bus's driver and conductor
-- ---------------------------------------------------------------------------

-- Town buses with money entries on the day that are missing a driver or a
-- conductor, and which of the two are missing.
create or replace function public.town_day_crew_missing(p_org uuid, p_day date)
returns table (bus_id uuid, registration_number text, missing text[])
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.registration_number, m.missing
  from public.buses as b
  cross join lateral (
    select array_remove(array[
      case when not exists (
        select 1 from public.day_crew as c where c.bus_id = b.id and c.day = p_day and c.duty = 'driver'
      ) then 'driver' end,
      case when not exists (
        select 1 from public.day_crew as c where c.bus_id = b.id and c.day = p_day and c.duty = 'conductor'
      ) then 'conductor' end
    ], null) as missing
  ) as m
  where b.organization_id = p_org
    and b.bus_type = 'town'
    and (public.is_org_member(p_org) or public.is_super_admin())
    and exists (
      select 1 from public.daily_entries as e
      where e.bus_id = b.id and e.entry_date = p_day
    )
    and cardinality(m.missing) > 0
  order by b.registration_number;
$$;

revoke all on function public.town_day_crew_missing(uuid, date) from public;
grant execute on function public.town_day_crew_missing(uuid, date) to authenticated;

-- Same as 0018, plus the day crew check.
create or replace function public.close_day(p_org uuid, p_day date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_missing text;
begin
  if not public.is_trip_editor(p_org) then
    raise exception 'Only an admin or manager can close a day.';
  end if;
  if p_day is null or p_day > public.today_ist() then
    raise exception 'You can close today or an earlier day.';
  end if;
  select string_agg(m.registration_number || ' (' || array_to_string(m.missing, ' and ') || ')', ', ')
  into v_missing
  from public.town_day_crew_missing(p_org, p_day) as m;
  if v_missing is not null then
    raise exception 'Add the driver and conductor before closing the day: %.', v_missing;
  end if;
  insert into public.closed_days (organization_id, day)
  values (p_org, p_day)
  on conflict (organization_id, day) do nothing;
end;
$$;
