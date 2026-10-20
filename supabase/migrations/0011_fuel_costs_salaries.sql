-- Phase 4: pump credit and payments, bank and company costs, crew and their
-- salaries, Intercity income, and settling trip advances. Run after 0010.

-- Pump statements: the outstanding figure the pump sends, to compare with the
-- credit diesel on approved trip sheets.
create table if not exists public.pump_statements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  pump text not null check (length(trim(pump)) > 0),
  statement_on date not null,
  outstanding_inr integer not null check (outstanding_inr >= 0),
  note text not null default '',
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.pump_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  pump text not null check (length(trim(pump)) > 0),
  paid_on date not null,
  amount_inr integer not null check (amount_inr > 0),
  reference text not null default '',
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- Costs paid from the bank (or company-wide). bus_id null means "Company".
create table if not exists public.company_expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  bus_id uuid references public.buses (id) on delete set null,
  spent_on date not null,
  category text not null check (category in (
    'accident_repair', 'workshop', 'tyre_retread', 'new_purchase',
    'manager_salary', 'auditor', 'office', 'loan_emi', 'other'
  )),
  amount_inr integer not null check (amount_inr > 0),
  paid_via text not null default 'bank' check (paid_via in ('bank', 'upi', 'cash')),
  note text not null default '',
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- Drivers and cleaners. They don't log in; they are names with a salary.
create table if not exists public.crew_people (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  job text not null default 'driver' check (job in ('driver', 'cleaner')),
  phone text not null default '',
  monthly_salary_inr integer not null default 0 check (monthly_salary_inr >= 0),
  licence_no text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.salary_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  person_id uuid not null references public.crew_people (id) on delete cascade,
  -- First day of the month the salary is for.
  for_month date not null check (extract(day from for_month) = 1),
  paid_on date not null,
  amount_inr integer not null check (amount_inr > 0),
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (person_id, for_month)
);

-- Intercity pays fortnightly for the buses it books; the manager enters it by hand.
create table if not exists public.intercity_income (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  received_on date not null,
  amount_inr integer not null check (amount_inr > 0),
  bus_ids uuid[] not null default '{}',
  note text not null default '',
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create index if not exists pump_statements_org_idx on public.pump_statements (organization_id, statement_on desc);
create index if not exists pump_payments_org_idx on public.pump_payments (organization_id, paid_on desc);
create index if not exists company_expenses_org_idx on public.company_expenses (organization_id, spent_on desc);
create index if not exists crew_people_org_idx on public.crew_people (organization_id);
create index if not exists salary_payments_org_idx on public.salary_payments (organization_id, for_month desc);
create index if not exists intercity_income_org_idx on public.intercity_income (organization_id, received_on desc);

-- Same rules for every table above: admins and managers manage them, and an
-- overdue company becomes view-only.
do $$
declare
  t text;
begin
  foreach t in array array[
    'pump_statements', 'pump_payments', 'company_expenses',
    'crew_people', 'salary_payments', 'intercity_income'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists "Admins and managers manage" on public.%I', t);
    execute format(
      'create policy "Admins and managers manage" on public.%I for all to authenticated
         using (public.is_trip_editor(organization_id))
         with check (public.is_trip_editor(organization_id))', t);
    execute format('drop policy if exists "Overdue companies are view-only" on public.%I', t);
    execute format(
      'create policy "Overdue companies are view-only" on public.%I as restrictive for all to authenticated
         using (true)
         with check (public.org_in_good_standing(organization_id))', t);
    execute format('drop policy if exists "Overdue companies are view-only (delete)" on public.%I', t);
    execute format(
      'create policy "Overdue companies are view-only (delete)" on public.%I as restrictive for delete to authenticated
         using (public.org_in_good_standing(organization_id))', t);
  end loop;
end;
$$;

-- A salary payment must be for a person in the same company.
create or replace function public.check_salary_person()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.crew_people as p
    where p.id = new.person_id and p.organization_id = new.organization_id
  ) then
    raise exception 'That person is not in this company.';
  end if;
  return new;
end;
$$;

drop trigger if exists salary_payments_check_person on public.salary_payments;
create trigger salary_payments_check_person
  before insert or update on public.salary_payments
  for each row execute function public.check_salary_person();

-- Settling a trip advance: the day the balance was paid to or returned by the driver.
alter table public.trips add column if not exists settled_on date;

-- Approved trips stay locked for managers, except for marking the advance settled.
create or replace function public.guard_approved_trip()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_org uuid;
  v_status text;
begin
  if tg_table_name = 'trips' then
    v_trip_id := old.id;
    v_org := old.organization_id;
    v_status := old.status;
    if tg_op = 'UPDATE'
      and (to_jsonb(new) - 'settled_on' - 'updated_at')
        = (to_jsonb(old) - 'settled_on' - 'updated_at')
    then
      new.updated_at := now();
      return new;
    end if;
  else
    v_trip_id := coalesce(old.trip_id, new.trip_id);
    v_org := coalesce(old.organization_id, new.organization_id);
    select t.status into v_status from public.trips as t where t.id = v_trip_id;
  end if;

  if v_status = 'approved'
    and coalesce(public.get_user_role(v_org), '') not in ('owner', 'admin')
    and not public.is_super_admin()
  then
    raise exception 'This trip is approved. Only an admin can change it.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_table_name = 'trips' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
