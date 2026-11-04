-- Database checks for migration 0027. Runs inside one transaction and rolls
-- back, so it leaves no data behind. Run with scripts/test-db.sh against a
-- local or test database that has migrations 0001 to 0027 (never production).
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = notice;
begin;

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Company A: an admin, an Omni-only manager and a crew login; two Town buses and one Omni bus.
-- Company B: an admin.
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000027a1', 'admin@a27.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000027d1', 'manager@a27.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000027c1', 'crew@a27.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000027b1', 'admin@b27.test', '{}', '{}');

insert into public.organizations (id, name, bus_types) values
  ('00000000-0000-0000-0000-00000000027a', 'Company A27', array['town', 'omni']),
  ('00000000-0000-0000-0000-00000000027b', 'Company B27', array['town']);

insert into public.buses (id, organization_id, registration_number, route_label, bus_type) values
  ('00000000-0000-0000-0000-000000027b01', '00000000-0000-0000-0000-00000000027a', 'TN 27 T 0001', 'Town', 'town'),
  ('00000000-0000-0000-0000-000000027b02', '00000000-0000-0000-0000-00000000027a', 'TN 27 T 0002', 'Town', 'town'),
  ('00000000-0000-0000-0000-000000027b03', '00000000-0000-0000-0000-00000000027a', 'TN 27 O 0003', 'Omni', 'omni');

insert into public.organization_members (organization_id, user_id, role, module) values
  ('00000000-0000-0000-0000-00000000027a', '00000000-0000-0000-0000-0000000027a1', 'admin', null),
  ('00000000-0000-0000-0000-00000000027a', '00000000-0000-0000-0000-0000000027d1', 'manager', 'omni'),
  ('00000000-0000-0000-0000-00000000027a', '00000000-0000-0000-0000-0000000027c1', 'crew', null),
  ('00000000-0000-0000-0000-00000000027b', '00000000-0000-0000-0000-0000000027b1', 'admin', null);

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Loans
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000027a1');
do $$ begin
  -- One loan on both Town buses, one on the Omni bus.
  insert into public.bus_loans (id, organization_id, bus_ids, lender, debit_account, emi_inr, sweep_day, first_month, last_month)
  values
    ('00000000-0000-0000-0000-000000027101', '00000000-0000-0000-0000-00000000027a',
     array['00000000-0000-0000-0000-000000027b01', '00000000-0000-0000-0000-000000027b02']::uuid[],
     'HDFC', 'Current account', 60000, 5, '2026-12-01', '2029-03-01'),
    ('00000000-0000-0000-0000-000000027102', '00000000-0000-0000-0000-00000000027a',
     array['00000000-0000-0000-0000-000000027b03']::uuid[], 'SBI', 'Current account', 25000, 10, '2026-12-01', '2027-11-01');
  begin
    insert into public.bus_loans (organization_id, bus_ids, lender, emi_inr, sweep_day, first_month, last_month)
    values ('00000000-0000-0000-0000-00000000027a', array['00000000-0000-0000-0000-000000027b01']::uuid[], 'X', 100, 32, '2026-12-01', '2027-01-01');
    raise exception 'FAIL L1 sweep day 32 should be refused';
  exception when check_violation then null;
  end;
  begin
    insert into public.bus_loans (organization_id, bus_ids, lender, emi_inr, sweep_day, first_month, last_month)
    values ('00000000-0000-0000-0000-00000000027a', array['00000000-0000-0000-0000-000000027b01']::uuid[], 'X', 100, 5, '2027-01-01', '2026-12-01');
    raise exception 'FAIL L1 a last EMI before the first should be refused';
  exception when check_violation then null;
  end;
  begin
    insert into public.organizations (id, name) values ('00000000-0000-0000-0000-00000000027c', 'nope');
  exception when others then null;
  end;
  update public.organizations set emi_reminder_days = 5 where id = '00000000-0000-0000-0000-00000000027a';
  if (select emi_reminder_days from public.organizations where id = '00000000-0000-0000-0000-00000000027a') <> 5 then
    raise exception 'FAIL L1 admin should set the reminder days';
  end if;
  raise notice 'PASS L1 admin adds loans (one on two buses), bad dates refused, reminder days set';
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000027b1');
do $$ begin
  begin
    insert into public.bus_loans (organization_id, bus_ids, lender, emi_inr, sweep_day, first_month, last_month)
    values ('00000000-0000-0000-0000-00000000027b', array['00000000-0000-0000-0000-000000027b01']::uuid[], 'X', 100, 5, '2026-12-01', '2027-01-01');
    raise exception 'FAIL L2 a loan on another company''s bus should be refused';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  if exists (select 1 from public.bus_loans where organization_id = '00000000-0000-0000-0000-00000000027a') then
    raise exception 'FAIL L2 another company should not see these loans';
  end if;
  raise notice 'PASS L2 other companies can''t see loans or put one on these buses';
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000027c1');
do $$ begin
  if exists (select 1 from public.bus_loans) or exists (select 1 from public.loan_emis) then
    raise exception 'FAIL L3 crew should not see loans or EMIs';
  end if;
  raise notice 'PASS L3 crew can''t see loans or EMIs';
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000027d1');
do $$ begin
  if (select count(*) from public.bus_loans) <> 1 then
    raise exception 'FAIL L4 Omni manager should see only the Omni loan';
  end if;
  begin
    insert into public.bus_loans (organization_id, bus_ids, lender, emi_inr, sweep_day, first_month, last_month)
    values ('00000000-0000-0000-0000-00000000027a', array['00000000-0000-0000-0000-000000027b01']::uuid[], 'X', 100, 5, '2026-12-01', '2027-01-01');
    raise exception 'FAIL L4 Omni manager should not add a Town loan';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.loan_emis (organization_id, loan_id, due_month, amount_inr, status, cleared_on)
    values ('00000000-0000-0000-0000-00000000027a', '00000000-0000-0000-0000-000000027101', '2026-12-01', 60000, 'cleared', '2026-12-05');
    raise exception 'FAIL L4 Omni manager should not clear a Town EMI';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS L4 a one-type manager sees and changes only their type''s loans';
end $$;

-- ---------------------------------------------------------------------------
-- EMIs and their company costs
-- ---------------------------------------------------------------------------
do $$
declare v record; c record;
begin
  -- The Omni manager pays December's EMI early: one tap, cleared.
  insert into public.loan_emis (id, organization_id, loan_id, due_month, amount_inr, status, cleared_on)
  values ('00000000-0000-0000-0000-000000027e01', '00000000-0000-0000-0000-00000000027a',
          '00000000-0000-0000-0000-000000027102', '2026-12-01', 25000, 'cleared', '2026-12-08');
  select * into v from public.loan_emis where id = '00000000-0000-0000-0000-000000027e01';
  select * into c from public.company_expenses where id = v.expense_id;
  if c.id is null or c.category <> 'loan_emi' or c.amount_inr <> 25000 or c.spent_on <> '2026-12-08'
     or c.applies_to <> 'buses' or c.bus_ids <> array['00000000-0000-0000-0000-000000027b03']::uuid[] then
    raise exception 'FAIL E1 cleared EMI should add a Loan EMI cost on the bus';
  end if;
  raise notice 'PASS E1 a manager marks their EMI paid and it becomes a Loan EMI cost on that bus';
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000027a1');
do $$
declare v record; n int;
begin
  begin
    insert into public.loan_emis (organization_id, loan_id, due_month, amount_inr, status)
    values ('00000000-0000-0000-0000-00000000027a', '00000000-0000-0000-0000-000000027101', '2026-12-01', 60000, 'missed');
    raise exception 'FAIL E2 a miss needs a reason';
  exception when check_violation then null;
  end;
  insert into public.loan_emis (id, organization_id, loan_id, due_month, amount_inr, status, note)
  values ('00000000-0000-0000-0000-000000027e02', '00000000-0000-0000-0000-00000000027a',
          '00000000-0000-0000-0000-000000027101', '2026-12-01', 60000, 'missed', 'Low balance');
  if (select expense_id from public.loan_emis where id = '00000000-0000-0000-0000-000000027e02') is not null then
    raise exception 'FAIL E2 a missed EMI should not be a cost';
  end if;
  update public.loan_emis set status = 'funds_added', funds_added_on = '2026-12-07', retry_on = '2026-12-09'
    where id = '00000000-0000-0000-0000-000000027e02';
  update public.loan_emis set status = 'cleared', cleared_on = '2026-12-09', fee_inr = 590, fine_inr = 1200, note = 'Bounce charge and penal interest'
    where id = '00000000-0000-0000-0000-000000027e02';
  select * into v from public.loan_emis where id = '00000000-0000-0000-0000-000000027e02';
  if (select amount_inr from public.company_expenses where id = v.expense_id) <> 60000 then
    raise exception 'FAIL E2 cleared EMI cost missing';
  end if;
  if (select amount_inr || category || cardinality(bus_ids) from public.company_expenses where id = v.fee_expense_id) <> '1790bank_fees2' then
    raise exception 'FAIL E2 fees and fines should be one Bank fees cost on both buses';
  end if;
  raise notice 'PASS E2 missed, funds added, then cleared with fee and fine: EMI and fees costs on both buses';

  -- Edit the fee: the cost follows. Un-clear: both costs go.
  update public.loan_emis set fee_inr = 0, fine_inr = 0 where id = '00000000-0000-0000-0000-000000027e02';
  if (select fee_expense_id from public.loan_emis where id = '00000000-0000-0000-0000-000000027e02') is not null
     or exists (select 1 from public.company_expenses where id = v.fee_expense_id) then
    raise exception 'FAIL E3 removing the fees should remove their cost';
  end if;
  update public.loan_emis set status = 'due' where id = '00000000-0000-0000-0000-000000027e02';
  if exists (select 1 from public.company_expenses where id = v.expense_id) then
    raise exception 'FAIL E3 un-clearing should remove the EMI cost';
  end if;
  update public.loan_emis set status = 'cleared', cleared_on = '2026-12-09' where id = '00000000-0000-0000-0000-000000027e02';
  select * into v from public.loan_emis where id = '00000000-0000-0000-0000-000000027e02';
  -- The admin edits the cost in Company costs: allowed, and it isn't put back.
  update public.company_expenses set note = 'HDFC EMI Dec 2026 (edited)', amount_inr = 59000 where id = v.expense_id;
  update public.loan_emis set note = 'Paid late' where id = '00000000-0000-0000-0000-000000027e02';
  if (select amount_inr from public.company_expenses where id = v.expense_id) <> 59000 then
    raise exception 'FAIL E3 an edited cost should keep the edit';
  end if;
  -- Deleted by hand: it stays deleted.
  delete from public.company_expenses where id = v.expense_id;
  if exists (select 1 from public.company_expenses where note like 'HDFC EMI Dec 2026%') then
    raise exception 'FAIL E3 a cost deleted by hand should not come back';
  end if;
  update public.loan_emis set note = 'Checked' where id = '00000000-0000-0000-0000-000000027e02';
  if exists (select 1 from public.company_expenses where note like 'HDFC EMI Dec 2026%') then
    raise exception 'FAIL E3 a cost deleted by hand should not come back on a note change';
  end if;
  update public.loan_emis set status = 'due' where id = '00000000-0000-0000-0000-000000027e02';
  update public.loan_emis set status = 'cleared', cleared_on = '2026-12-09' where id = '00000000-0000-0000-0000-000000027e02';
  select * into v from public.loan_emis where id = '00000000-0000-0000-0000-000000027e02';
  delete from public.loan_emis where id = '00000000-0000-0000-0000-000000027e02';
  if exists (select 1 from public.company_expenses where id = v.expense_id) then
    raise exception 'FAIL E3 deleting the EMI should remove its cost';
  end if;
  select count(*) into n from public.audit_log where table_name = 'loan_emis' and row_id = '00000000-0000-0000-0000-000000027e02';
  if n < 5 then raise exception 'FAIL E3 history should keep each change, got %', n; end if;
  raise notice 'PASS E3 costs follow edits, un-clearing and deleting; history keeps every change';
end $$;

-- Deleting a loan keeps what was already paid in Company costs.
do $$
declare v_cost uuid;
begin
  select expense_id into v_cost from public.loan_emis where id = '00000000-0000-0000-0000-000000027e01';
  delete from public.bus_loans where id = '00000000-0000-0000-0000-000000027102';
  if not exists (select 1 from public.company_expenses where id = v_cost) then
    raise exception 'FAIL E5 deleting a loan should keep its paid EMIs in Company costs';
  end if;
  raise notice 'PASS E5 deleting a loan keeps paid EMIs in Company costs';
end $$;

-- Deleting a bus takes it off its loans.
do $$ begin
  delete from public.buses where id = '00000000-0000-0000-0000-000000027b02';
  if (select cardinality(bus_ids) from public.bus_loans where id = '00000000-0000-0000-0000-000000027101') <> 1 then
    raise exception 'FAIL E4 deleted bus should leave the loan';
  end if;
  raise notice 'PASS E4 a deleted bus leaves its loan';
end $$;

rollback;
