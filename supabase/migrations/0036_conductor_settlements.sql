-- Conductor settlements (Town only).
-- Run after 0035. Safe to run more than once.
--
-- At the end of a duty a conductor hands over the day's collection for a bus.
-- The figures are typed in: expected amount, cash, UPI and the allowance the
-- conductor kept. The shortage is worked out from them. An admin or manager
-- approves the settlement. A shortage is recovered from salary: the amount and
-- the month are kept here, for the salary screen to pick up.
--
-- Who can do what (the owner's rules):
--   * An admin or manager enters or edits any Town conductor's settlement.
--   * A conductor whose login is linked to their crew person (0034) enters and
--     sees their own settlements, and nobody else's, while they are drafts.
--   * Only an admin or manager approves. Only an admin waives (below), or
--     changes figures after approval.
--   * A settlement belongs to a conductor on the bus that day: the person who
--     started (day_crew) or a relief (day_crew_relief, 0035).
--
-- Closing a day can wait for settlements. That is a company setting,
-- organizations.require_conductor_settlement, OFF until an admin turns it on,
-- so applying this migration changes nothing for a company until then. When it
-- is on, day_close_blockers (0033) lists every conductor who has not settled,
-- or whose settlement is waiting for approval, and close_day refuses.
--
-- Exceptions: when a conductor cannot settle (absent, or no collection), an
-- admin marks the settlement "waived" with a short reason. A waived settlement
-- counts as done for closing the day and recovers nothing.

alter table public.organizations
  add column if not exists require_conductor_settlement boolean not null default false;

create table if not exists public.conductor_settlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  day date not null,
  bus_id uuid not null references public.buses (id) on delete cascade,
  person_id uuid not null references public.crew_people (id) on delete restrict,
  -- Typed in, all whole rupees.
  expected_inr integer not null default 0 check (expected_inr between 0 and 10000000),
  cash_inr integer not null default 0 check (cash_inr between 0 and 10000000),
  upi_inr integer not null default 0 check (upi_inr between 0 and 10000000),
  allowance_inr integer not null default 0 check (allowance_inr between 0 and 10000000),
  -- Positive: the conductor handed over less than expected. Negative: more.
  shortage_inr integer generated always as (expected_inr - allowance_inr - cash_inr - upi_inr) stored,
  status text not null default 'draft' check (status in ('draft', 'approved', 'waived')),
  note text not null default '' check (length(note) <= 500),
  -- Recovered from salary. Null until approval; then defaults to the shortage.
  recover_inr integer check (recover_inr is null or recover_inr >= 0),
  -- First day of the salary month the recovery comes out of.
  recover_month date check (recover_month is null or extract(day from recover_month) = 1),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bus_id, day, person_id)
);

create index if not exists conductor_settlements_org_day_idx on public.conductor_settlements (organization_id, day);
create index if not exists conductor_settlements_person_idx on public.conductor_settlements (person_id, day);
create index if not exists conductor_settlements_recovery_idx
  on public.conductor_settlements (organization_id, recover_month)
  where status = 'approved' and recover_inr > 0;

alter table public.conductor_settlements enable row level security;
grant select, insert, update, delete on public.conductor_settlements to authenticated;

-- Admins and managers: everything in their company (and module, below).
drop policy if exists "Admins and managers manage" on public.conductor_settlements;
create policy "Admins and managers manage"
  on public.conductor_settlements for all to authenticated
  using (public.is_trip_editor(organization_id) or public.is_super_admin())
  with check (public.is_trip_editor(organization_id));

-- A linked conductor reads their own settlements.
drop policy if exists "Conductors read their own" on public.conductor_settlements;
create policy "Conductors read their own"
  on public.conductor_settlements for select to authenticated
  using (person_id = public.my_crew_person(organization_id));

-- A linked conductor adds their own, as a draft.
drop policy if exists "Conductors add their own" on public.conductor_settlements;
create policy "Conductors add their own"
  on public.conductor_settlements for insert to authenticated
  with check (
    person_id = public.my_crew_person(organization_id)
    and status = 'draft'
    and created_by = auth.uid()
  );

-- A linked conductor edits their own while it is still a draft, and cannot approve it.
drop policy if exists "Conductors edit their own drafts" on public.conductor_settlements;
create policy "Conductors edit their own drafts"
  on public.conductor_settlements for update to authenticated
  using (person_id = public.my_crew_person(organization_id) and status = 'draft')
  with check (person_id = public.my_crew_person(organization_id) and status = 'draft');

drop policy if exists "Overdue companies are view-only" on public.conductor_settlements;
create policy "Overdue companies are view-only"
  on public.conductor_settlements as restrictive for all to authenticated
  using (true)
  with check (public.org_in_good_standing(organization_id));

drop policy if exists "Overdue companies are view-only (delete)" on public.conductor_settlements;
create policy "Overdue companies are view-only (delete)"
  on public.conductor_settlements as restrictive for delete to authenticated
  using (public.org_in_good_standing(organization_id));

drop policy if exists "Managers stay in their module" on public.conductor_settlements;
create policy "Managers stay in their module"
  on public.conductor_settlements as restrictive for all to authenticated
  using (public.module_allows(organization_id, public.bus_module(bus_id)))
  with check (public.module_allows(organization_id, public.bus_module(bus_id)));

-- The rules that policies cannot express.
create or replace function public.check_conductor_settlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_editor boolean := public.is_trip_editor(new.organization_id);
  v_admin boolean := coalesce(public.get_user_role(new.organization_id), '') in ('owner', 'admin');
  v_system boolean := auth.uid() is null or public.is_super_admin() or pg_trigger_depth() > 1;
  v_short integer;
begin
  if not exists (
    select 1 from public.buses as b
    where b.id = new.bus_id and b.organization_id = new.organization_id and b.bus_type = 'town'
  ) then
    raise exception 'Conductor settlements are for Town buses of this company only.';
  end if;
  if not exists (
    select 1 from public.crew_people as p
    where p.id = new.person_id and p.organization_id = new.organization_id
      and p.module = 'town' and p.job = 'conductor'
  ) then
    raise exception 'That person is not a Town conductor of this company.';
  end if;
  if new.day > public.today_ist() then
    raise exception 'You can settle today or an earlier day.';
  end if;
  -- The conductor must have been on this bus that day: started, or relieved.
  if not exists (
    select 1 from public.day_crew as c
    where c.bus_id = new.bus_id and c.day = new.day and c.duty = 'conductor' and c.person_id = new.person_id
  ) and not exists (
    select 1 from public.day_crew_relief as r
    where r.bus_id = new.bus_id and r.day = new.day and r.duty = 'conductor' and r.person_id = new.person_id
  ) then
    raise exception 'That conductor was not on this bus that day. Set the day crew first.';
  end if;

  if not v_system then
    -- A conductor (not an admin or manager) only ever saves a draft.
    if not v_editor and new.status <> 'draft' then
      raise exception 'Only an admin or manager can approve a settlement.';
    end if;
    if new.status = 'waived' and not v_admin then
      raise exception 'Only an admin can waive a settlement.';
    end if;
  end if;

  if new.status = 'waived' then
    if length(trim(new.note)) < 3 then
      raise exception 'Write a short reason for waiving this settlement.';
    end if;
    new.expected_inr := 0; new.cash_inr := 0; new.upi_inr := 0; new.allowance_inr := 0;
    new.recover_inr := 0;
  end if;

  -- A stored generated column is not filled in yet inside a BEFORE trigger.
  v_short := new.expected_inr - new.allowance_inr - new.cash_inr - new.upi_inr;

  if tg_op = 'UPDATE' and old.status = 'approved' and not v_system and not v_admin then
    if (new.expected_inr, new.cash_inr, new.upi_inr, new.allowance_inr, new.status, new.recover_inr, new.recover_month, new.person_id, new.bus_id, new.day)
       is distinct from
       (old.expected_inr, old.cash_inr, old.upi_inr, old.allowance_inr, old.status, old.recover_inr, old.recover_month, old.person_id, old.bus_id, old.day)
    then
      raise exception 'This settlement is approved. Only an admin can change it.';
    end if;
  end if;

  if new.status = 'approved' and (tg_op = 'INSERT' or old.status <> 'approved') then
    new.approved_by := coalesce(auth.uid(), new.approved_by);
    new.approved_at := now();
    new.recover_inr := coalesce(new.recover_inr, greatest(v_short, 0));
    new.recover_month := coalesce(new.recover_month, (date_trunc('month', new.day) + interval '1 month')::date);
  elsif new.status = 'draft' then
    new.approved_by := null;
    new.approved_at := null;
  end if;

  if new.recover_inr is not null and new.recover_inr > greatest(v_short, 0) then
    raise exception 'The salary recovery (%) cannot be more than the shortage (%).',
      new.recover_inr, greatest(v_short, 0);
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists conductor_settlement_check on public.conductor_settlements;
create trigger conductor_settlement_check
  before insert or update on public.conductor_settlements
  for each row execute function public.check_conductor_settlement();

-- Same as 0035 (the latest copy), plus conductor_settlements.
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
    when 'day_crew', 'day_crew_relief', 'conductor_settlements' then
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

-- Same as 0035 (the latest copy), plus conductor_settlements.
create or replace function public.row_module(p_table text, p_row jsonb)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_table in ('daily_entries', 'trips', 'renewals', 'day_crew', 'day_crew_relief', 'conductor_settlements')
      and p_row ->> 'bus_id' is not null
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

drop trigger if exists guard_frozen on public.conductor_settlements;
create trigger guard_frozen before insert or update or delete on public.conductor_settlements
  for each row execute function public.guard_frozen_rows();

drop trigger if exists record_change on public.conductor_settlements;
create trigger record_change after insert or update or delete on public.conductor_settlements
  for each row execute function public.record_change();

-- ---------------------------------------------------------------------------
-- Saving, approving and waiving, each as one call
-- ---------------------------------------------------------------------------

-- Saves a settlement as a draft: creates it, or updates the figures of the
-- one that exists for this conductor, bus and day. Runs as the caller.
create or replace function public.save_conductor_settlement(
  p_org uuid,
  p_day date,
  p_bus uuid,
  p_person uuid,
  p_expected_inr integer,
  p_cash_inr integer,
  p_upi_inr integer,
  p_allowance_inr integer,
  p_note text default ''
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.conductor_settlements (
    organization_id, day, bus_id, person_id,
    expected_inr, cash_inr, upi_inr, allowance_inr, note
  )
  values (
    p_org, p_day, p_bus, p_person,
    coalesce(p_expected_inr, 0), coalesce(p_cash_inr, 0), coalesce(p_upi_inr, 0),
    coalesce(p_allowance_inr, 0), coalesce(p_note, '')
  )
  on conflict (bus_id, day, person_id) do update set
    expected_inr = excluded.expected_inr,
    cash_inr = excluded.cash_inr,
    upi_inr = excluded.upi_inr,
    allowance_inr = excluded.allowance_inr,
    note = excluded.note
  returning id into v_id;
  return v_id;
end;
$$;

-- Approves a settlement. p_recover_inr is how much to recover from salary
-- (null: the whole shortage). Admins and managers only.
create or replace function public.approve_conductor_settlement(p_id uuid, p_recover_inr integer default null)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.conductor_settlements
  set status = 'approved',
      recover_inr = p_recover_inr
  where id = p_id;
  if not found then
    raise exception 'That settlement was not found.';
  end if;
end;
$$;

-- Marks a conductor's day as settled without figures, with a reason. Admins only.
create or replace function public.waive_conductor_settlement(
  p_org uuid, p_day date, p_bus uuid, p_person uuid, p_reason text
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.conductor_settlements (organization_id, day, bus_id, person_id, status, note)
  values (p_org, p_day, p_bus, p_person, 'waived', coalesce(p_reason, ''))
  on conflict (bus_id, day, person_id) do update set status = 'waived', note = excluded.note
  returning id into v_id;
  return v_id;
end;
$$;

-- Shortages to take out of salaries for one month, per person. Approved only.
create or replace function public.conductor_recoveries(p_org uuid, p_month date)
returns table (person_id uuid, recover_inr bigint, settlements bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select s.person_id, sum(s.recover_inr)::bigint, count(*)::bigint
  from public.conductor_settlements as s
  where s.organization_id = p_org
    and s.status = 'approved'
    and s.recover_month = date_trunc('month', p_month)::date
    and s.recover_inr > 0
  group by s.person_id
  order by s.person_id;
$$;

revoke all on function public.save_conductor_settlement(uuid, date, uuid, uuid, integer, integer, integer, integer, text) from public, anon;
grant execute on function public.save_conductor_settlement(uuid, date, uuid, uuid, integer, integer, integer, integer, text) to authenticated;
revoke all on function public.approve_conductor_settlement(uuid, integer) from public, anon;
grant execute on function public.approve_conductor_settlement(uuid, integer) to authenticated;
revoke all on function public.waive_conductor_settlement(uuid, date, uuid, uuid, text) from public, anon;
grant execute on function public.waive_conductor_settlement(uuid, date, uuid, uuid, text) to authenticated;
revoke all on function public.conductor_recoveries(uuid, date) from public, anon;
grant execute on function public.conductor_recoveries(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Closing the day waits for settlements (when the company has turned it on)
-- ---------------------------------------------------------------------------

-- Same as 0033, plus one row for each conductor who has not settled, and one
-- for each settlement still waiting for approval. Each row names the bus and
-- the conductor, so the screen can say exactly what is missing.
create or replace function public.day_close_blockers(p_org uuid, p_day date)
returns table (code text, bus_id uuid, detail text)
language sql
stable
security definer
set search_path = public
as $$
  select 'crew_missing'::text,
         m.bus_id,
         m.registration_number || ' (' || array_to_string(m.missing, ' and ') || ')'
  from public.town_day_crew_missing(p_org, p_day) as m
  where public.is_trip_editor(p_org) or public.is_super_admin()
  union all
  select case when s.id is null then 'settlement_missing' else 'settlement_pending' end,
         b.id,
         b.registration_number || ': ' || p.name
           || case when s.id is null then ' has not settled' else '''s settlement is waiting for approval' end
  from public.buses as b
  join public.organizations as o on o.id = b.organization_id
  join lateral (
    select c.person_id from public.day_crew as c
    where c.bus_id = b.id and c.day = p_day and c.duty = 'conductor'
    union
    select r.person_id from public.day_crew_relief as r
    where r.bus_id = b.id and r.day = p_day and r.duty = 'conductor'
  ) as crew on true
  join public.crew_people as p on p.id = crew.person_id
  left join public.conductor_settlements as s
    on s.bus_id = b.id and s.day = p_day and s.person_id = crew.person_id
  where b.organization_id = p_org
    and b.bus_type = 'town'
    and o.require_conductor_settlement
    and (public.is_trip_editor(p_org) or public.is_super_admin())
    and exists (
      select 1 from public.daily_entries as e where e.bus_id = b.id and e.entry_date = p_day
    )
    and (s.id is null or s.status = 'draft');
$$;

revoke all on function public.day_close_blockers(uuid, date) from public, anon;
grant execute on function public.day_close_blockers(uuid, date) to authenticated;
