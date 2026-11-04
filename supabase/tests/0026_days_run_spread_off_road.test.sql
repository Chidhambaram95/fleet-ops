-- Database checks for migration 0026. Runs inside one transaction and rolls
-- back, so it leaves no data behind. Run with scripts/test-db.sh against a
-- local or test database that has migrations 0001 to 0026 (never production).
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = notice;
begin;

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Company A: an admin and an Omni-only manager, two Town buses and one Omni bus.
-- Company B: an admin.
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000026a1', 'admin@a26.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000026d1', 'manager@a26.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000026b1', 'admin@b26.test', '{}', '{}');

insert into public.organizations (id, name, bus_types) values
  ('00000000-0000-0000-0000-00000000026a', 'Company A26', array['town', 'omni']),
  ('00000000-0000-0000-0000-00000000026b', 'Company B26', array['town']);

insert into public.buses (id, organization_id, registration_number, route_label, bus_type) values
  ('00000000-0000-0000-0000-000000026b01', '00000000-0000-0000-0000-00000000026a', 'TN 26 T 0001', 'Town', 'town'),
  ('00000000-0000-0000-0000-000000026b02', '00000000-0000-0000-0000-00000000026a', 'TN 26 T 0002', 'Town', 'town'),
  ('00000000-0000-0000-0000-000000026b03', '00000000-0000-0000-0000-00000000026a', 'TN 26 O 0003', 'Omni', 'omni');

insert into public.organization_members (organization_id, user_id, role, module) values
  ('00000000-0000-0000-0000-00000000026a', '00000000-0000-0000-0000-0000000026a1', 'admin', null),
  ('00000000-0000-0000-0000-00000000026a', '00000000-0000-0000-0000-0000000026d1', 'manager', 'omni'),
  ('00000000-0000-0000-0000-00000000026b', '00000000-0000-0000-0000-0000000026b1', 'admin', null);

-- T1: money in on the 1st, a repair bill alone on the 2nd, diesel on the 3rd,
-- a higher odometer reading on the 5th, and money in on the 4th (marked off road below).
insert into public.daily_entries (organization_id, bus_id, entry_date, kind, category, amount_inr) values
  ('00000000-0000-0000-0000-00000000026a', '00000000-0000-0000-0000-000000026b01', '2026-11-01', 'income', 'ticket_collection', 9000),
  ('00000000-0000-0000-0000-00000000026a', '00000000-0000-0000-0000-000000026b01', '2026-11-02', 'expense', 'repair', 4000),
  ('00000000-0000-0000-0000-00000000026a', '00000000-0000-0000-0000-000000026b01', '2026-11-03', 'expense', 'diesel', 3000),
  ('00000000-0000-0000-0000-00000000026a', '00000000-0000-0000-0000-000000026b01', '2026-11-04', 'income', 'ticket_collection', 9000);
insert into public.odometer_readings (organization_id, bus_id, reading_date, odometer_km, created_by) values
  ('00000000-0000-0000-0000-00000000026a', '00000000-0000-0000-0000-000000026b01', '2026-10-31', 1000, '00000000-0000-0000-0000-0000000026a1'),
  ('00000000-0000-0000-0000-00000000026a', '00000000-0000-0000-0000-000000026b01', '2026-11-05', 1200, '00000000-0000-0000-0000-0000000026a1'),
  -- T2: the same reading twice is not a day run.
  ('00000000-0000-0000-0000-00000000026a', '00000000-0000-0000-0000-000000026b02', '2026-11-01', 500, '00000000-0000-0000-0000-0000000026a1'),
  ('00000000-0000-0000-0000-00000000026a', '00000000-0000-0000-0000-000000026b02', '2026-11-02', 500, '00000000-0000-0000-0000-0000000026a1');

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Off-road days
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000026a1');
insert into public.bus_off_road (organization_id, bus_id, day, reason)
values ('00000000-0000-0000-0000-00000000026a', '00000000-0000-0000-0000-000000026b01', '2026-11-04', 'breakdown');

do $$ begin
  begin
    insert into public.bus_off_road (organization_id, bus_id, day, reason)
    values ('00000000-0000-0000-0000-00000000026a', '00000000-0000-0000-0000-000000026b01', '2026-11-04', 'other');
    raise exception 'FAIL C1 the same bus and day should not be marked twice';
  exception when unique_violation then null;
  end;
  begin
    insert into public.bus_off_road (organization_id, bus_id, day, reason)
    values ('00000000-0000-0000-0000-00000000026a', '00000000-0000-0000-0000-000000026b02', '2026-11-04', 'holiday');
    raise exception 'FAIL C1 an unknown reason should be refused';
  exception when check_violation then null;
  end;
  raise notice 'PASS C1 admin marks a day off road; duplicates and unknown reasons are refused';
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000026d1');
do $$ begin
  begin
    insert into public.bus_off_road (organization_id, bus_id, day, reason)
    values ('00000000-0000-0000-0000-00000000026a', '00000000-0000-0000-0000-000000026b02', '2026-11-06', 'breakdown');
    raise exception 'FAIL C2 Omni manager should not mark a Town bus';
  exception when insufficient_privilege then null;
  end;
  insert into public.bus_off_road (organization_id, bus_id, day, reason)
  values ('00000000-0000-0000-0000-00000000026a', '00000000-0000-0000-0000-000000026b03', '2026-11-06', 'no_crew');
  if exists (select 1 from public.bus_off_road where bus_id = '00000000-0000-0000-0000-000000026b01') then
    raise exception 'FAIL C2 Omni manager should not see Town off-road days';
  end if;
  raise notice 'PASS C2 a manager marks and sees only their own module''s buses';
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000026b1');
do $$ begin
  begin
    insert into public.bus_off_road (organization_id, bus_id, day, reason)
    values ('00000000-0000-0000-0000-00000000026a', '00000000-0000-0000-0000-000000026b01', '2026-11-07', 'breakdown');
    raise exception 'FAIL C3 another company should not mark this company''s bus';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.bus_off_road (organization_id, bus_id, day, reason)
    values ('00000000-0000-0000-0000-00000000026b', '00000000-0000-0000-0000-000000026b01', '2026-11-07', 'breakdown');
    raise exception 'FAIL C3 a bus of another company should be refused';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  if exists (select 1 from public.bus_off_road where organization_id = '00000000-0000-0000-0000-00000000026a') then
    raise exception 'FAIL C3 another company should not see these off-road days';
  end if;
  if exists (select 1 from public.company_bus_days('00000000-0000-0000-0000-00000000026a', '2026-11-01', '2026-11-30')) then
    raise exception 'FAIL C3 another company should get no days run';
  end if;
  raise notice 'PASS C3 other companies can''t mark, see or count these buses';
end $$;

-- ---------------------------------------------------------------------------
-- Days run
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000026d1');
do $$
declare t1 int; t2 int; o1 int; n int;
begin
  select count(*) into n from public.company_bus_days('00000000-0000-0000-0000-00000000026a', '2026-11-01', '2026-11-30');
  select days into t1 from public.company_bus_days('00000000-0000-0000-0000-00000000026a', '2026-11-01', '2026-11-30')
    where bus_id = '00000000-0000-0000-0000-000000026b01';
  select days into t2 from public.company_bus_days('00000000-0000-0000-0000-00000000026a', '2026-11-01', '2026-11-30')
    where bus_id = '00000000-0000-0000-0000-000000026b02';
  select days into o1 from public.company_bus_days('00000000-0000-0000-0000-00000000026a', '2026-11-01', '2026-11-30')
    where bus_id = '00000000-0000-0000-0000-000000026b03';
  -- T1: 1st (money in), 3rd (diesel), 5th (odometer up). Not the 2nd (repair only) or the 4th (off road).
  if n <> 3 then raise exception 'FAIL D1 every bus should be listed, got %', n; end if;
  if t1 <> 3 then raise exception 'FAIL D1 T1 should have 3 days run, got %', t1; end if;
  if t2 <> 0 then raise exception 'FAIL D1 T2 should have 0 days run, got %', t2; end if;
  if o1 <> 0 then raise exception 'FAIL D1 O1 should have 0 days run, got %', o1; end if;
  raise notice 'PASS D1 days run follow the rule, and a one-module manager gets every bus';
end $$;

-- ---------------------------------------------------------------------------
-- Spreading and repeating costs
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000026a1');
do $$
declare v record;
begin
  insert into public.company_expenses (id, organization_id, spent_on, category, amount_inr, applies_to)
  values ('00000000-0000-0000-0000-000000026e01', '00000000-0000-0000-0000-00000000026a', '2026-11-03', 'insurance', 36000, 'all');
  select * into v from public.company_expenses where id = '00000000-0000-0000-0000-000000026e01';
  if v.spread_months <> 1 or v.repeat_monthly then raise exception 'FAIL E1 defaults should be 1 month, no repeat'; end if;
  update public.company_expenses set spread_months = 12, repeat_monthly = true
    where id = '00000000-0000-0000-0000-000000026e01';
  begin
    update public.company_expenses set spread_months = 2 where id = '00000000-0000-0000-0000-000000026e01';
    raise exception 'FAIL E1 spread over 2 months should be refused';
  exception when check_violation then null;
  end;
  insert into public.company_expenses (organization_id, spent_on, category, amount_inr, applies_to)
  values ('00000000-0000-0000-0000-00000000026a', '2026-11-03', 'permit_tax', 5000, 'all');
  raise notice 'PASS E1 costs spread over 1, 3, 6 or 12 months, and Insurance and Permit / FC / tax are saved';
end $$;

rollback;
