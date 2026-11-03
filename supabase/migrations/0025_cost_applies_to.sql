-- Company costs: "Applies to" all buses, one bus type, or picked buses.
--
-- Before this, a cost listed the buses it was for in bus_ids, and an empty
-- list meant every bus. Now each cost says what it applies to:
--   all    every bus of the company (bus_ids empty)
--   type   every bus of one type, Town, Omni or Tour, including buses added
--          later (applies_type set, bus_ids empty)
--   buses  the buses listed in bus_ids (at least one)
--
-- Existing costs with no buses become "all"; costs tied to one or more buses
-- stay on those buses. Safe to run more than once.

alter table public.company_expenses
  add column if not exists applies_to text not null default 'all';
alter table public.company_expenses
  add column if not exists applies_type text;

-- Older rows that only had the single bus column.
update public.company_expenses
set bus_ids = array[bus_id]
where bus_id is not null and cardinality(bus_ids) = 0;

update public.company_expenses
set applies_to = 'buses'
where applies_to = 'all' and cardinality(bus_ids) > 0;

-- Keeps the three fields in step, so older app versions (which only send
-- bus_ids) and the "bus deleted" cleanup keep working:
--   * all with buses listed becomes buses
--   * buses with none left (every listed bus deleted) becomes all
--   * a type cost lists no buses; other costs carry no type
create or replace function public.company_expense_applies_to()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.bus_ids := coalesce(new.bus_ids, '{}');
  if new.applies_to = 'type' then
    new.bus_ids := '{}';
  else
    new.applies_type := null;
    if new.applies_to = 'all' and cardinality(new.bus_ids) > 0 then
      new.applies_to := 'buses';
    elsif new.applies_to = 'buses' and cardinality(new.bus_ids) = 0 then
      new.applies_to := 'all';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists company_expenses_applies_to on public.company_expenses;
create trigger company_expenses_applies_to
  before insert or update on public.company_expenses
  for each row execute function public.company_expense_applies_to();

alter table public.company_expenses drop constraint if exists company_expenses_applies_to_check;
alter table public.company_expenses
  add constraint company_expenses_applies_to_check check (
    (applies_to = 'all' and applies_type is null and cardinality(bus_ids) = 0)
    or (applies_to = 'type' and applies_type is not null and applies_type in ('town', 'omni', 'tour') and cardinality(bus_ids) = 0)
    or (applies_to = 'buses' and applies_type is null and cardinality(bus_ids) > 0)
  );

-- Same visibility as before for a manager limited to one module: they see
-- costs for all buses and costs touching their buses, and now also costs for
-- their own bus type. They still can't add, change or delete any.
drop policy if exists "Managers stay in their module" on public.company_expenses;
create policy "Managers stay in their module"
  on public.company_expenses as restrictive
  for all
  to authenticated
  using (
    public.my_module(organization_id) is null
    or applies_to = 'all'
    or (applies_to = 'type' and applies_type = public.my_module(organization_id))
    or (applies_to = 'buses' and public.module_allows_buses(organization_id, bus_ids, true))
  )
  with check (public.my_module(organization_id) is null);

-- Days each bus of the company ran between two dates: a day with a ledger
-- entry, or a day inside the range an approved trip sheet was on the road. Reports split company costs by these days. Security definer so a
-- manager limited to one module still gets every bus's days (only ids, types
-- and day counts, no money), and their buses' shares match the admin's.
create or replace function public.company_bus_days(p_org uuid, p_from date, p_to date)
returns table (bus_id uuid, bus_type text, days integer)
language sql
stable
security definer
set search_path = public
as $$
  with ran as (
    select e.bus_id, e.entry_date as day
    from public.daily_entries as e
    where e.organization_id = p_org and e.entry_date between p_from and p_to
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
  )
  select b.id, b.bus_type, count(ran.day)::integer
  from public.buses as b
  left join ran on ran.bus_id = b.id
  where b.organization_id = p_org
    and public.is_trip_editor(p_org)
  group by b.id, b.bus_type;
$$;

revoke all on function public.company_bus_days(uuid, date, date) from public, anon;
grant execute on function public.company_bus_days(uuid, date, date) to authenticated;
