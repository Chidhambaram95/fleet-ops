-- Town, Omni and Tour become separate modules of the app. Run after 0014.
-- Safe to run more than once.
--
-- bus_types (set by the super admin) are the modules a company may use;
-- enabled_modules (set by the company admin) are the ones switched on.
-- Null means every allowed module is on, so existing companies keep working.

alter table public.organizations
  add column if not exists enabled_modules text[];

alter table public.organizations drop constraint if exists organizations_enabled_modules_check;
alter table public.organizations
  add constraint organizations_enabled_modules_check
  check (enabled_modules is null or enabled_modules <@ array['town', 'omni', 'tour']::text[]);

-- Company admins switch modules on and off; the allowed list stays with the super admin.
revoke update on public.organizations from authenticated;
grant update (name, town, gstin, whatsapp_number, enabled_modules) on public.organizations to authenticated;

-- A manager can be limited to one module. Null means every module.
alter table public.organization_members
  add column if not exists module text;
alter table public.organization_members drop constraint if exists organization_members_module_check;
alter table public.organization_members
  add constraint organization_members_module_check
  check (module is null or module in ('town', 'omni', 'tour'));

-- Drivers and cleaners belong to one module.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'crew_people' and column_name = 'module'
  ) then
    alter table public.crew_people
      add column module text not null default 'town'
      check (module in ('town', 'omni', 'tour'));
    -- Someone named on a trip sheet belongs to that bus's module; anyone
    -- else to the company's first bus type. Admins can change it later.
    update public.crew_people as p
    set module = coalesce(
      (
        select b.bus_type
        from public.trips as t
        join public.buses as b on b.id = t.bus_id
        where t.organization_id = p.organization_id
          and lower(btrim(p.name)) in (lower(btrim(t.driver1)), lower(btrim(t.driver2)), lower(btrim(t.cleaner)))
        order by t.started_at desc nulls last
        limit 1
      ),
      (select o.bus_types[1] from public.organizations as o where o.id = p.organization_id),
      'town'
    );
  end if;
end;
$$;

-- Pump figures and payments belong to the module whose trips use that pump.
alter table public.pump_statements
  add column if not exists module text not null default 'omni';
alter table public.pump_payments
  add column if not exists module text not null default 'omni';
alter table public.pump_statements drop constraint if exists pump_statements_module_check;
alter table public.pump_statements
  add constraint pump_statements_module_check check (module in ('town', 'omni', 'tour'));
alter table public.pump_payments drop constraint if exists pump_payments_module_check;
alter table public.pump_payments
  add constraint pump_payments_module_check check (module in ('town', 'omni', 'tour'));

-- A company cost can be for several buses. None picked means it is shared
-- across every bus of the company.
alter table public.company_expenses
  add column if not exists bus_ids uuid[] not null default '{}';
update public.company_expenses
set bus_ids = array[bus_id]
where bus_id is not null and bus_ids = '{}';

-- Every bus listed must belong to the row's company (costs and Intercity).
create or replace function public.check_bus_ids_in_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from unnest(new.bus_ids) as b(id)
    where not exists (
      select 1 from public.buses where buses.id = b.id and organization_id = new.organization_id
    )
  ) then
    raise exception 'That bus is not in this company.';
  end if;
  return new;
end;
$$;

drop trigger if exists company_expenses_check_bus_ids on public.company_expenses;
create trigger company_expenses_check_bus_ids
  before insert or update of bus_ids, organization_id on public.company_expenses
  for each row execute function public.check_bus_ids_in_org();

-- A deleted bus drops out of the costs and Intercity payments that listed it.
create or replace function public.remove_bus_from_lists()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.company_expenses
  set bus_ids = array_remove(bus_ids, old.id)
  where organization_id = old.organization_id and old.id = any(bus_ids);
  update public.intercity_income
  set bus_ids = array_remove(bus_ids, old.id)
  where organization_id = old.organization_id and old.id = any(bus_ids);
  return old;
end;
$$;

drop trigger if exists buses_remove_from_lists on public.buses;
create trigger buses_remove_from_lists
  after delete on public.buses
  for each row execute function public.remove_bus_from_lists();
