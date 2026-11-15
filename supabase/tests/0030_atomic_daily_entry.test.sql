-- Database checks for migration 0030. Runs inside one transaction and rolls
-- back, so it leaves no data behind. Run with scripts/test-db.sh against a
-- local or test database that has migrations 0001 to 0030 (never production).
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = notice;
begin;

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000030a1', 'admin@a30.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000030d1', 'omnimgr@a30.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000030c1', 'crew@a30.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000030b1', 'admin@b30.test', '{}', '{}');

insert into public.organizations (id, name, bus_types) values
  ('00000000-0000-0000-0000-00000000030a', 'Company A30', array['town', 'omni']),
  ('00000000-0000-0000-0000-00000000030b', 'Company B30', array['town']);

insert into public.buses (id, organization_id, registration_number, route_label, bus_type) values
  ('00000000-0000-0000-0000-000000300b01', '00000000-0000-0000-0000-00000000030a', 'TN 30 T 0001', 'Town 1', 'town'),
  ('00000000-0000-0000-0000-000000300b02', '00000000-0000-0000-0000-00000000030a', 'TN 30 T 0002', 'Town 2', 'town'),
  ('00000000-0000-0000-0000-000000300b03', '00000000-0000-0000-0000-00000000030a', 'TN 30 O 0003', 'Omni', 'omni');

insert into public.organization_members (organization_id, user_id, role, module) values
  ('00000000-0000-0000-0000-00000000030a', '00000000-0000-0000-0000-0000000030a1', 'admin', null),
  ('00000000-0000-0000-0000-00000000030a', '00000000-0000-0000-0000-0000000030d1', 'manager', 'omni'),
  ('00000000-0000-0000-0000-00000000030a', '00000000-0000-0000-0000-0000000030c1', 'crew', null),
  ('00000000-0000-0000-0000-00000000030b', '00000000-0000-0000-0000-0000000030b1', 'admin', null);

insert into public.crew_assignments (organization_id, user_id, bus_id) values
  ('00000000-0000-0000-0000-00000000030a', '00000000-0000-0000-0000-0000000030c1', '00000000-0000-0000-0000-000000300b01');

set local role authenticated;
\pset tuples_only on

-- A1 an admin saves a diesel entry with a reading: both rows exist, linked by the km.
select pg_temp.act_as('00000000-0000-0000-0000-0000000030a1');
do $$ declare n int; begin
  perform public.add_daily_entry(
    '00000000-0000-0000-0000-00000000030a', '00000000-0000-0000-0000-000000300b01', public.today_ist(),
    'expense', 'diesel', 3000, 'Pump', 40, 1000, true);
  select count(*) into n from public.daily_entries where bus_id = '00000000-0000-0000-0000-000000300b01' and odometer_km = 1000;
  if n <> 1 then raise exception 'FAIL A1 entry missing'; end if;
  select count(*) into n from public.odometer_readings where bus_id = '00000000-0000-0000-0000-000000300b01' and odometer_km = 1000;
  if n <> 1 then raise exception 'FAIL A1 reading missing'; end if;
  raise notice 'PASS A1 entry and reading saved together';
end $$;

-- A2 a km below the last reading is refused and the entry is NOT saved either.
do $$ declare n int; begin
  begin
    perform public.add_daily_entry(
      '00000000-0000-0000-0000-00000000030a', '00000000-0000-0000-0000-000000300b01', public.today_ist(),
      'expense', 'diesel', 2000, 'Pump', 30, 900, false);
    raise exception 'FAIL A2 lower km accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  select count(*) into n from public.daily_entries where bus_id = '00000000-0000-0000-0000-000000300b01' and amount_inr = 2000;
  if n <> 0 then raise exception 'FAIL A2 entry saved although the reading was refused'; end if;
  raise notice 'PASS A2 a refused reading saves nothing';
end $$;

-- A3 a refused entry leaves no reading behind (diesel litres on a non-diesel category).
do $$ declare n int; begin
  begin
    perform public.add_daily_entry(
      '00000000-0000-0000-0000-00000000030a', '00000000-0000-0000-0000-000000300b01', public.today_ist(),
      'income', 'ticket_collection', 500, '', 10, 1500, false);
    raise exception 'FAIL A3 bad diesel figures accepted';
  exception when check_violation then null;
  end;
  select count(*) into n from public.odometer_readings where bus_id = '00000000-0000-0000-0000-000000300b01' and odometer_km = 1500;
  if n <> 0 then raise exception 'FAIL A3 reading left behind'; end if;
  raise notice 'PASS A3 a refused entry leaves no reading';
end $$;

-- A4 an entry without a reading saves on its own.
do $$ begin
  perform public.add_daily_entry(
    '00000000-0000-0000-0000-00000000030a', '00000000-0000-0000-0000-000000300b01', public.today_ist(),
    'income', 'ticket_collection', 5000);
  raise notice 'PASS A4 plain entry saves';
end $$;

-- A5 crew can save for their own bus but not another bus.
select pg_temp.act_as('00000000-0000-0000-0000-0000000030c1');
do $$ begin
  perform public.add_daily_entry(
    '00000000-0000-0000-0000-00000000030a', '00000000-0000-0000-0000-000000300b01', public.today_ist(),
    'income', 'ticket_collection', 700);
  begin
    perform public.add_daily_entry(
      '00000000-0000-0000-0000-00000000030a', '00000000-0000-0000-0000-000000300b02', public.today_ist(),
      'income', 'ticket_collection', 700);
    raise exception 'FAIL A5 crew saved for another bus';
  exception when insufficient_privilege or others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS A5 crew only for their own bus';
end $$;

-- A6 a manager limited to Omni cannot save for a Town bus.
select pg_temp.act_as('00000000-0000-0000-0000-0000000030d1');
do $$ begin
  begin
    perform public.add_daily_entry(
      '00000000-0000-0000-0000-00000000030a', '00000000-0000-0000-0000-000000300b01', public.today_ist(),
      'income', 'ticket_collection', 100);
    raise exception 'FAIL A6 omni manager saved a town entry';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS A6 managers stay in their module';
end $$;

-- A7 another company's admin cannot save into this company.
select pg_temp.act_as('00000000-0000-0000-0000-0000000030b1');
do $$ begin
  begin
    perform public.add_daily_entry(
      '00000000-0000-0000-0000-00000000030a', '00000000-0000-0000-0000-000000300b01', public.today_ist(),
      'income', 'ticket_collection', 100);
    raise exception 'FAIL A7 outsider saved an entry';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS A7 other companies are refused';
end $$;

-- A8 signed-out callers (anon) cannot run it.
reset role;
set local role anon;
do $$ begin
  begin
    perform public.add_daily_entry(
      '00000000-0000-0000-0000-00000000030a', '00000000-0000-0000-0000-000000300b01', public.today_ist(),
      'income', 'ticket_collection', 100);
    raise exception 'FAIL A8 anon ran add_daily_entry';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS A8 anon cannot call it';
end $$;

rollback;
