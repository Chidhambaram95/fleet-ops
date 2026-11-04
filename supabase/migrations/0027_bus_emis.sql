-- Bus loans and their monthly EMIs. Run after 0026. Safe to run more than once.
--
-- 1. bus_loans: one row per loan: the buses it covers, lender, the bank account
--    it sweeps from, the EMI, the sweep day of the month, the first EMI month
--    tracked and the last EMI month.
-- 2. loan_emis: one row per month that someone has acted on (paid, missed,
--    funds added, cleared). A month with no row is simply due. When an EMI is
--    marked cleared, a Loan EMI company cost is added on the loan's buses, and
--    any fee or fine as a "Bank fees & fines" cost; un-clearing removes them.
-- 3. organizations.emi_reminder_days: how many days before the sweep the first
--    reminder shows (1 to 10, 3 by default).

-- ---------------------------------------------------------------------------
-- Company setting and the new cost category
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column if not exists emi_reminder_days integer not null default 3;
alter table public.organizations drop constraint if exists organizations_emi_reminder_days_check;
alter table public.organizations
  add constraint organizations_emi_reminder_days_check check (emi_reminder_days between 1 and 10);
grant update (emi_reminder_days) on public.organizations to authenticated;

alter table public.company_expenses drop constraint if exists company_expenses_category_check;
alter table public.company_expenses
  add constraint company_expenses_category_check check (category in (
    'accident_repair', 'workshop', 'tyre_retread', 'new_purchase',
    'manager_salary', 'auditor', 'office', 'loan_emi', 'insurance', 'permit_tax',
    'bank_fees', 'other'
  ));

-- ---------------------------------------------------------------------------
-- Loans
-- ---------------------------------------------------------------------------

create table if not exists public.bus_loans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  bus_ids uuid[] not null check (cardinality(bus_ids) between 1 and 20),
  lender text not null check (length(trim(lender)) between 1 and 80),
  loan_ref text not null default '' check (length(loan_ref) <= 40),
  debit_account text not null default '' check (length(debit_account) <= 80),
  emi_inr integer not null check (emi_inr > 0 and emi_inr <= 100000000),
  sweep_day integer not null check (sweep_day between 1 and 31),
  -- Both are the first day of a month.
  first_month date not null check (extract(day from first_month) = 1),
  last_month date not null check (extract(day from last_month) = 1),
  note text not null default '' check (length(note) <= 300),
  created_by uuid default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (last_month >= first_month)
);

create index if not exists bus_loans_org_idx on public.bus_loans (organization_id);

create table if not exists public.loan_emis (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  loan_id uuid not null references public.bus_loans (id) on delete cascade,
  -- The EMI's month (first day of the month).
  due_month date not null check (extract(day from due_month) = 1),
  status text not null default 'due' check (status in ('due', 'missed', 'funds_added', 'cleared')),
  amount_inr integer not null check (amount_inr > 0 and amount_inr <= 100000000),
  funds_added_on date,
  -- When the bank will try again after a miss, if known.
  retry_on date,
  cleared_on date,
  fee_inr integer not null default 0 check (fee_inr >= 0 and fee_inr <= 10000000),
  fine_inr integer not null default 0 check (fine_inr >= 0 and fine_inr <= 10000000),
  note text not null default '' check (length(note) <= 300),
  -- The company costs this EMI added once cleared.
  expense_id uuid references public.company_expenses (id) on delete set null,
  fee_expense_id uuid references public.company_expenses (id) on delete set null,
  updated_by uuid default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (loan_id, due_month),
  check (status <> 'cleared' or cleared_on is not null),
  check (status <> 'funds_added' or funds_added_on is not null),
  check (status <> 'missed' or length(trim(note)) > 0)
);

create index if not exists loan_emis_org_idx on public.loan_emis (organization_id, due_month);

alter table public.bus_loans enable row level security;
alter table public.loan_emis enable row level security;
grant select, insert, update, delete on public.bus_loans to authenticated;
grant select, insert, update, delete on public.loan_emis to authenticated;

-- The loan's buses must be this company's; the EMI's loan too.
create or replace function public.check_bus_loan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from unnest(new.bus_ids) as x(id)
    where not exists (select 1 from public.buses as b where b.id = x.id and b.organization_id = new.organization_id)
  ) then
    raise exception 'Pick buses of this company.';
  end if;
  new.bus_ids := array(select distinct unnest(new.bus_ids));
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists bus_loans_check on public.bus_loans;
create trigger bus_loans_check
  before insert or update on public.bus_loans
  for each row execute function public.check_bus_loan();

-- A deleted bus leaves its loans; a loan left with no buses goes too.
create or replace function public.bus_loans_drop_bus()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.bus_loans
    set bus_ids = array_remove(bus_ids, old.id)
    where organization_id = old.organization_id and old.id = any(bus_ids) and cardinality(bus_ids) > 1;
  delete from public.bus_loans
    where organization_id = old.organization_id and bus_ids = array[old.id];
  return old;
end;
$$;

drop trigger if exists buses_drop_from_loans on public.buses;
create trigger buses_drop_from_loans
  before delete on public.buses
  for each row execute function public.bus_loans_drop_bus();

-- The buses of a loan, for module checks on its EMIs.
create or replace function public.loan_bus_ids(p_loan uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select bus_ids from public.bus_loans where id = p_loan), '{}');
$$;

revoke all on function public.loan_bus_ids(uuid) from public, anon;
grant execute on function public.loan_bus_ids(uuid) to authenticated;

-- Keeps an EMI's company costs in step with it: added when cleared and
-- changed with it. When it is no longer cleared, the links are cleared here and
-- the costs removed by remove_loan_emi_costs below.
create or replace function public.sync_loan_emi_costs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan public.bus_loans;
  v_label text;
  v_fees integer;
  v_fresh boolean;
begin
  if tg_op = 'UPDATE' and new.loan_id <> old.loan_id then
    raise exception 'An EMI can''t move to another loan.';
  end if;
  select * into v_loan from public.bus_loans where id = new.loan_id and organization_id = new.organization_id;
  if v_loan.id is null then
    raise exception 'That loan is not in this company.';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  v_label := left(trim(v_loan.lender || ' EMI ' || to_char(new.due_month, 'Mon YYYY')), 300);
  v_fees := new.fee_inr + new.fine_inr;
  -- Newly cleared (or saved cleared for the first time).
  v_fresh := tg_op = 'INSERT' or old.status <> 'cleared';

  if new.status = 'cleared' then
    if new.expense_id is not null and exists (select 1 from public.company_expenses where id = new.expense_id) then
      update public.company_expenses
        set amount_inr = new.amount_inr, spent_on = new.cleared_on, bus_ids = v_loan.bus_ids, applies_to = 'buses'
        where id = new.expense_id
          -- Only when the EMI itself changed, so an edit made in Company costs stays.
          and (v_fresh or old.amount_inr <> new.amount_inr or old.cleared_on is distinct from new.cleared_on);
    elsif v_fresh or old.amount_inr <> new.amount_inr or old.cleared_on is distinct from new.cleared_on then
      -- A cost deleted by hand in Company costs stays deleted until the EMI changes.
      insert into public.company_expenses (organization_id, spent_on, category, amount_inr, paid_via, note, applies_to, bus_ids)
      values (new.organization_id, new.cleared_on, 'loan_emi', new.amount_inr, 'bank', v_label, 'buses', v_loan.bus_ids)
      returning id into new.expense_id;
    end if;
    if v_fees > 0 then
      if new.fee_expense_id is not null and exists (select 1 from public.company_expenses where id = new.fee_expense_id) then
        update public.company_expenses
          set amount_inr = v_fees, spent_on = new.cleared_on, bus_ids = v_loan.bus_ids, applies_to = 'buses'
          where id = new.fee_expense_id
            and (v_fresh or old.fee_inr + old.fine_inr <> v_fees or old.cleared_on is distinct from new.cleared_on);
      elsif v_fresh or old.fee_inr + old.fine_inr <> v_fees or old.cleared_on is distinct from new.cleared_on then
        insert into public.company_expenses (organization_id, spent_on, category, amount_inr, paid_via, note, applies_to, bus_ids)
        values (new.organization_id, new.cleared_on, 'bank_fees', v_fees, 'bank', left('Fees and fines · ' || v_label, 300), 'buses', v_loan.bus_ids)
        returning id into new.fee_expense_id;
      end if;
    else
      new.fee_expense_id := null;
    end if;
  else
    new.expense_id := null;
    new.fee_expense_id := null;
    new.cleared_on := null;
  end if;
  return new;
end;
$$;

drop trigger if exists loan_emis_sync_costs on public.loan_emis;
create trigger loan_emis_sync_costs
  before insert or update on public.loan_emis
  for each row execute function public.sync_loan_emi_costs();

-- Costs the EMI no longer points at (un-cleared, fees removed, deleted) go,
-- after the row is saved so the link to them is already gone.
create or replace function public.remove_loan_emi_costs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    -- A month set back to due loses its costs; deleting the whole loan keeps
    -- what was already paid in Company costs.
    if exists (select 1 from public.bus_loans where id = old.loan_id) then
      delete from public.company_expenses where id in (old.expense_id, old.fee_expense_id);
    end if;
  else
    delete from public.company_expenses
      where id in (old.expense_id, old.fee_expense_id)
        and id is distinct from new.expense_id
        and id is distinct from new.fee_expense_id;
  end if;
  return null;
end;
$$;

drop trigger if exists loan_emis_remove_costs on public.loan_emis;
create trigger loan_emis_remove_costs
  after update or delete on public.loan_emis
  for each row execute function public.remove_loan_emi_costs();

-- Loan changes: the buses or EMI of cleared months follow on their costs only
-- when the EMI is saved again, so past months keep what was paid.

-- ---------------------------------------------------------------------------
-- Who can see and change loans and EMIs
-- ---------------------------------------------------------------------------

drop policy if exists "Admins and managers manage loans" on public.bus_loans;
create policy "Admins and managers manage loans"
  on public.bus_loans for all to authenticated
  using (public.is_trip_editor(organization_id) or public.is_super_admin())
  with check (public.is_trip_editor(organization_id));

drop policy if exists "Admins and managers manage EMIs" on public.loan_emis;
create policy "Admins and managers manage EMIs"
  on public.loan_emis for all to authenticated
  using (public.is_trip_editor(organization_id) or public.is_super_admin())
  with check (public.is_trip_editor(organization_id));

do $$
declare
  t text;
begin
  foreach t in array array['bus_loans', 'loan_emis']
  loop
    execute format('drop policy if exists "Overdue companies are view-only" on public.%I', t);
    execute format(
      'create policy "Overdue companies are view-only" on public.%I as restrictive for all to authenticated
         using (true) with check (public.org_in_good_standing(organization_id))', t
    );
    execute format('drop policy if exists "Overdue companies are view-only (delete)" on public.%I', t);
    execute format(
      'create policy "Overdue companies are view-only (delete)" on public.%I as restrictive for delete to authenticated
         using (public.org_in_good_standing(organization_id))', t
    );
  end loop;
end;
$$;

-- A manager limited to one bus type sees and changes only loans whose buses
-- are all of their type.
drop policy if exists "Managers stay in their module" on public.bus_loans;
create policy "Managers stay in their module"
  on public.bus_loans as restrictive
  for all
  to authenticated
  using (public.module_allows_buses(organization_id, bus_ids, false))
  with check (public.module_allows_buses(organization_id, bus_ids, false));

drop policy if exists "Managers stay in their module" on public.loan_emis;
create policy "Managers stay in their module"
  on public.loan_emis as restrictive
  for all
  to authenticated
  using (public.module_allows_buses(organization_id, public.loan_bus_ids(loan_id), false))
  with check (public.module_allows_buses(organization_id, public.loan_bus_ids(loan_id), false));

-- ---------------------------------------------------------------------------
-- Change history
-- ---------------------------------------------------------------------------

create or replace function public.row_module(p_table text, p_row jsonb)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_table in ('daily_entries', 'trips', 'renewals') and p_row ->> 'bus_id' is not null
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

do $$
declare
  t text;
begin
  foreach t in array array['bus_loans', 'loan_emis']
  loop
    execute format('drop trigger if exists record_change on public.%I', t);
    execute format(
      'create trigger record_change after insert or update or delete on public.%I
         for each row execute function public.record_change()', t
    );
  end loop;
end;
$$;
