-- Database checks for migration 0025. Runs inside one transaction and rolls
-- back, so it leaves no data behind. Run with scripts/test-db.sh against a
-- local or test database that has migrations 0001 to 0025 (never production).
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
  ('00000000-0000-0000-0000-0000000025a1', 'admin@a25.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000025d1', 'manager@a25.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000025b1', 'admin@b25.test', '{}', '{}');

insert into public.organizations (id, name, bus_types) values
  ('00000000-0000-0000-0000-00000000025a', 'Company A25', array['town', 'omni']),
  ('00000000-0000-0000-0000-00000000025b', 'Company B25', array['town']);

insert into public.buses (id, organization_id, registration_number, route_label, bus_type) values
  ('00000000-0000-0000-0000-000000025b01', '00000000-0000-0000-0000-00000000025a', 'TN 25 T 0001', 'Town', 'town'),
  ('00000000-0000-0000-0000-000000025b02', '00000000-0000-0000-0000-00000000025a', 'TN 25 T 0002', 'Town', 'town'),
  ('00000000-0000-0000-0000-000000025b03', '00000000-0000-0000-0000-00000000025a', 'TN 25 O 0003', 'Omni', 'omni'),
  ('00000000-0000-0000-0000-000000025b09', '00000000-0000-0000-0000-00000000025b', 'TN 25 B 0009', 'B', 'town');

insert into public.organization_members (organization_id, user_id, role, module) values
  ('00000000-0000-0000-0000-00000000025a', '00000000-0000-0000-0000-0000000025a1', 'admin', null),
  ('00000000-0000-0000-0000-00000000025a', '00000000-0000-0000-0000-0000000025d1', 'manager', 'omni'),
  ('00000000-0000-0000-0000-00000000025b', '00000000-0000-0000-0000-0000000025b1', 'admin', null);

-- ---------------------------------------------------------------------------
-- Old rows move over: none picked becomes all, picked buses stay on them
-- ---------------------------------------------------------------------------
alter table public.company_expenses disable trigger company_expenses_applies_to;
alter table public.company_expenses drop constraint company_expenses_applies_to_check;
insert into public.company_expenses (id, organization_id, spent_on, category, amount_inr, bus_ids, bus_id, applies_to) values
  ('00000000-0000-0000-0000-000000025e01', '00000000-0000-0000-0000-00000000025a', '2026-11-01', 'loan_emi', 42000, '{}', null, 'all'),
  ('00000000-0000-0000-0000-000000025e02', '00000000-0000-0000-0000-00000000025a', '2026-11-02', 'workshop', 8000,
     array['00000000-0000-0000-0000-000000025b01', '00000000-0000-0000-0000-000000025b02']::uuid[], null, 'all'),
  ('00000000-0000-0000-0000-000000025e03', '00000000-0000-0000-0000-00000000025a', '2026-11-03', 'workshop', 5000,
     '{}', '00000000-0000-0000-0000-000000025b03', 'all');
alter table public.company_expenses enable trigger company_expenses_applies_to;
\i supabase/migrations/0025_cost_applies_to.sql
\i supabase/migrations/0025_cost_applies_to.sql

do $$ begin
  if (select applies_to from public.company_expenses where id = '00000000-0000-0000-0000-000000025e01') <> 'all' then
    raise exception 'FAIL A1 cost with no buses should be all';
  end if;
  if (select applies_to || cardinality(bus_ids) from public.company_expenses where id = '00000000-0000-0000-0000-000000025e02') <> 'buses2' then
    raise exception 'FAIL A1 cost on two buses should stay on them';
  end if;
  if (select applies_to || (bus_ids[1])::text from public.company_expenses where id = '00000000-0000-0000-0000-000000025e03')
     <> 'buses00000000-0000-0000-0000-000000025b03' then
    raise exception 'FAIL A1 cost on one bus (old column) should stay on that bus';
  end if;
  raise notice 'PASS A1 old costs move over, and running the migration twice is safe';
end $$;

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Saving costs
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000025a1');
do $$
declare v record;
begin
  insert into public.company_expenses (id, organization_id, spent_on, category, amount_inr, applies_to, applies_type)
  values ('00000000-0000-0000-0000-000000025e11', '00000000-0000-0000-0000-00000000025a', '2026-11-03', 'other', 18000, 'type', 'town');
  insert into public.company_expenses (id, organization_id, spent_on, category, amount_inr, applies_to, applies_type)
  values ('00000000-0000-0000-0000-000000025e12', '00000000-0000-0000-0000-00000000025a', '2026-11-03', 'auditor', 3500, 'type', 'omni');
  select * into v from public.company_expenses where id = '00000000-0000-0000-0000-000000025e11';
  if v.applies_to <> 'type' or v.applies_type <> 'town' or cardinality(v.bus_ids) <> 0 then
    raise exception 'FAIL B1 type cost saved wrong';
  end if;
  raise notice 'PASS B1 admin saves a cost for one bus type';

  -- An older app only sends bus_ids.
  insert into public.company_expenses (id, organization_id, spent_on, category, amount_inr, bus_ids)
  values ('00000000-0000-0000-0000-000000025e13', '00000000-0000-0000-0000-00000000025a', '2026-11-03', 'workshop', 1000,
          array['00000000-0000-0000-0000-000000025b01']::uuid[]);
  insert into public.company_expenses (id, organization_id, spent_on, category, amount_inr)
  values ('00000000-0000-0000-0000-000000025e14', '00000000-0000-0000-0000-00000000025a', '2026-11-03', 'office', 900);
  if (select applies_to from public.company_expenses where id = '00000000-0000-0000-0000-000000025e13') <> 'buses'
     or (select applies_to from public.company_expenses where id = '00000000-0000-0000-0000-000000025e14') <> 'all' then
    raise exception 'FAIL B2 older app saves are not sorted into buses / all';
  end if;
  raise notice 'PASS B2 saves from the older app still work';

  begin
    insert into public.company_expenses (organization_id, spent_on, category, amount_inr, applies_to)
    values ('00000000-0000-0000-0000-00000000025a', '2026-11-03', 'other', 100, 'type');
    raise exception 'FAIL B3 type cost without a type saved';
  exception when check_violation then raise notice 'PASS B3 a type cost needs a type';
  end;

  begin
    insert into public.company_expenses (organization_id, spent_on, category, amount_inr, applies_to, applies_type)
    values ('00000000-0000-0000-0000-00000000025a', '2026-11-03', 'other', 100, 'type', 'school');
    raise exception 'FAIL B4 unknown bus type saved';
  exception when check_violation then raise notice 'PASS B4 only Town, Omni or Tour';
  end;

  begin
    insert into public.company_expenses (organization_id, spent_on, category, amount_inr, bus_ids)
    values ('00000000-0000-0000-0000-00000000025a', '2026-11-03', 'other', 100,
            array['00000000-0000-0000-0000-000000025b09']::uuid[]);
    raise exception 'FAIL B5 another company''s bus accepted';
  exception when raise_exception then raise notice 'PASS B5 picked buses must be this company''s';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Who sees what
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000025d1');
do $$
declare seen uuid[];
begin
  select array_agg(id order by id) into seen from public.company_expenses
  where organization_id = '00000000-0000-0000-0000-00000000025a';
  -- All buses (e01, e14), the Omni bus (e03) and the Omni type (e12). Not Town type (e11) or Town buses (e02, e13).
  if seen <> array[
    '00000000-0000-0000-0000-000000025e01', '00000000-0000-0000-0000-000000025e03',
    '00000000-0000-0000-0000-000000025e12', '00000000-0000-0000-0000-000000025e14']::uuid[] then
    raise exception 'FAIL C1 Omni manager sees %', seen;
  end if;
  raise notice 'PASS C1 Omni manager sees costs for all buses, their buses and their bus type only';

  begin
    insert into public.company_expenses (organization_id, spent_on, category, amount_inr, applies_to, applies_type)
    values ('00000000-0000-0000-0000-00000000025a', '2026-11-03', 'other', 100, 'type', 'omni');
    raise exception 'FAIL C2 limited manager added a company cost';
  exception when insufficient_privilege then raise notice 'PASS C2 limited manager cannot add company costs';
  end;
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000025b1');
do $$ begin
  if exists (select 1 from public.company_expenses where organization_id = '00000000-0000-0000-0000-00000000025a') then
    raise exception 'FAIL C3 other company sees costs';
  end if;
  raise notice 'PASS C3 other company sees nothing';
end $$;

-- ---------------------------------------------------------------------------
-- Deleting a bus
-- ---------------------------------------------------------------------------
reset role;
delete from public.buses where id = '00000000-0000-0000-0000-000000025b03';
do $$ begin
  if (select applies_to || cardinality(bus_ids) from public.company_expenses where id = '00000000-0000-0000-0000-000000025e03') <> 'all0' then
    raise exception 'FAIL D1 cost whose only bus was deleted should fall back to all buses';
  end if;
  if (select cardinality(bus_ids) from public.company_expenses where id = '00000000-0000-0000-0000-000000025e02') <> 2 then
    raise exception 'FAIL D1 unrelated cost changed';
  end if;
  raise notice 'PASS D1 deleting a bus moves a cost left with no buses to all buses';
end $$;

-- ---------------------------------------------------------------------------
-- Days run, for splitting costs
-- ---------------------------------------------------------------------------
insert into public.buses (id, organization_id, registration_number, route_label, bus_type) values
  ('00000000-0000-0000-0000-000000025b04', '00000000-0000-0000-0000-00000000025a', 'TN 25 O 0004', 'Omni', 'omni');
set local session_replication_role = replica;
insert into public.daily_entries (organization_id, bus_id, entry_date, kind, category, amount_inr) values
  ('00000000-0000-0000-0000-00000000025a', '00000000-0000-0000-0000-000000025b01', '2026-11-01', 'income', 'ticket_collection', 100),
  ('00000000-0000-0000-0000-00000000025a', '00000000-0000-0000-0000-000000025b01', '2026-11-01', 'expense', 'diesel', 50),
  ('00000000-0000-0000-0000-00000000025a', '00000000-0000-0000-0000-000000025b01', '2026-11-02', 'income', 'ticket_collection', 100),
  ('00000000-0000-0000-0000-00000000025a', '00000000-0000-0000-0000-000000025b01', '2026-10-31', 'income', 'ticket_collection', 100);
-- 5 Nov 8 pm to 7 Nov 8 am IST: three days. A draft sheet doesn't count.
insert into public.trips (organization_id, bus_id, sheet_no, started_at, ended_at, status) values
  ('00000000-0000-0000-0000-00000000025a', '00000000-0000-0000-0000-000000025b04', '1', '2026-11-05T20:00:00+05:30', '2026-11-07T08:00:00+05:30', 'approved'),
  ('00000000-0000-0000-0000-00000000025a', '00000000-0000-0000-0000-000000025b04', '2', '2026-11-20T20:00:00+05:30', '2026-11-21T08:00:00+05:30', 'draft');
set local session_replication_role = origin;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000025a1');
do $$
declare got text;
begin
  select string_agg(b.registration_number || '=' || d.days, ' ' order by b.registration_number) into got
  from public.company_bus_days('00000000-0000-0000-0000-00000000025a', '2026-11-01', '2026-11-30') as d
  join public.buses as b on b.id = d.bus_id;
  if got <> 'TN 25 O 0004=3 TN 25 T 0001=2 TN 25 T 0002=0' then
    raise exception 'FAIL E1 days run %', got;
  end if;
  raise notice 'PASS E1 days run count entry days and approved trip days, every bus listed';
  if (select days from public.company_bus_days('00000000-0000-0000-0000-00000000025a', '2026-11-06', '2026-11-30')
      where bus_id = '00000000-0000-0000-0000-000000025b04') <> 2 then
    raise exception 'FAIL E2 a range cutting a trip';
  end if;
  raise notice 'PASS E2 a range cutting a trip counts only the days inside';
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000025d1');
do $$ begin
  if (select count(*) from public.company_bus_days('00000000-0000-0000-0000-00000000025a', '2026-11-01', '2026-11-30')) <> 3
     or (select days from public.company_bus_days('00000000-0000-0000-0000-00000000025a', '2026-11-01', '2026-11-30')
         where bus_id = '00000000-0000-0000-0000-000000025b01') <> 2 then
    raise exception 'FAIL E3 Omni manager should get every bus''s days';
  end if;
  raise notice 'PASS E3 Omni manager gets every bus''s days (no money), so shares match the admin''s';
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000025b1');
do $$ begin
  if exists (select 1 from public.company_bus_days('00000000-0000-0000-0000-00000000025a', '2026-11-01', '2026-11-30')) then
    raise exception 'FAIL E4 other company reads days run';
  end if;
  raise notice 'PASS E4 other company gets nothing';
end $$;

reset role;
\echo 'All database checks passed.'
rollback;
