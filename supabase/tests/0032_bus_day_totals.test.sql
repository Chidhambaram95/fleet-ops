-- Database checks for migration 0032. Runs inside one transaction and rolls
-- back, so it leaves no data behind. Run with scripts/test-db.sh against a
-- local or test database that has migrations 0001 to 0032 (never production).
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = notice;
begin;

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000032a1', 'admin@a32.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000032d1', 'omnimgr@a32.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000032c1', 'crew@a32.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000032b1', 'admin@b32.test', '{}', '{}');

insert into public.organizations (id, name, bus_types) values
  ('00000000-0000-0000-0000-00000000032a', 'Company A32', array['town', 'omni']),
  ('00000000-0000-0000-0000-00000000032b', 'Company B32', array['town']);

insert into public.buses (id, organization_id, registration_number, route_label, bus_type) values
  ('00000000-0000-0000-0000-000000320b01', '00000000-0000-0000-0000-00000000032a', 'TN 32 T 0001', 'Town 1', 'town'),
  ('00000000-0000-0000-0000-000000320b02', '00000000-0000-0000-0000-00000000032a', 'TN 32 T 0002', 'Town 2', 'town'),
  ('00000000-0000-0000-0000-000000320b03', '00000000-0000-0000-0000-00000000032a', 'TN 32 O 0003', 'Omni', 'omni');

insert into public.organization_members (organization_id, user_id, role, module) values
  ('00000000-0000-0000-0000-00000000032a', '00000000-0000-0000-0000-0000000032a1', 'admin', null),
  ('00000000-0000-0000-0000-00000000032a', '00000000-0000-0000-0000-0000000032d1', 'manager', 'omni'),
  ('00000000-0000-0000-0000-00000000032a', '00000000-0000-0000-0000-0000000032c1', 'crew', null),
  ('00000000-0000-0000-0000-00000000032b', '00000000-0000-0000-0000-0000000032b1', 'admin', null);

insert into public.crew_assignments (organization_id, user_id, bus_id) values
  ('00000000-0000-0000-0000-00000000032a', '00000000-0000-0000-0000-0000000032c1', '00000000-0000-0000-0000-000000320b01');

-- Entries over two days on both Town buses, and one on the Omni bus.
insert into public.daily_entries (organization_id, bus_id, entry_date, kind, category, amount_inr) values
  ('00000000-0000-0000-0000-00000000032a', '00000000-0000-0000-0000-000000320b01', public.today_ist(), 'income', 'ticket_collection', 5000),
  ('00000000-0000-0000-0000-00000000032a', '00000000-0000-0000-0000-000000320b01', public.today_ist(), 'income', 'parcel', 300),
  ('00000000-0000-0000-0000-00000000032a', '00000000-0000-0000-0000-000000320b01', public.today_ist(), 'expense', 'diesel', 2000),
  ('00000000-0000-0000-0000-00000000032a', '00000000-0000-0000-0000-000000320b02', public.today_ist(), 'income', 'ticket_collection', 4000),
  ('00000000-0000-0000-0000-00000000032a', '00000000-0000-0000-0000-000000320b01', public.today_ist() - 1, 'income', 'ticket_collection', 1000),
  ('00000000-0000-0000-0000-00000000032a', '00000000-0000-0000-0000-000000320b03', public.today_ist(), 'income', 'private_hire', 9000);

set local role authenticated;
\pset tuples_only on

-- T1 the admin gets one row per bus per day, added up.
select pg_temp.act_as('00000000-0000-0000-0000-0000000032a1');
do $$ declare r record; begin
  select * into r from public.bus_day_totals('00000000-0000-0000-0000-00000000032a', 'town', public.today_ist(), public.today_ist())
  where bus_id = '00000000-0000-0000-0000-000000320b01';
  if r.income_inr <> 5300 or r.expense_inr <> 2000 or r.entries <> 3 then
    raise exception 'FAIL T1 got in %, out %, entries %', r.income_inr, r.expense_inr, r.entries;
  end if;
  raise notice 'PASS T1 totals add up per bus and day';
end $$;

-- T2 the module filter leaves out the Omni bus; a null module includes it.
do $$ declare n int; begin
  select count(*) into n from public.bus_day_totals('00000000-0000-0000-0000-00000000032a', 'town', public.today_ist() - 1, public.today_ist());
  if n <> 3 then raise exception 'FAIL T2 town rows %, expected 3', n; end if;
  select count(*) into n from public.bus_day_totals('00000000-0000-0000-0000-00000000032a', null, public.today_ist() - 1, public.today_ist());
  if n <> 4 then raise exception 'FAIL T2 all rows %, expected 4', n; end if;
  raise notice 'PASS T2 module filter works';
end $$;

-- T3 the date range is respected.
do $$ declare n int; begin
  select count(*) into n from public.bus_day_totals('00000000-0000-0000-0000-00000000032a', 'town', public.today_ist() - 1, public.today_ist() - 1);
  if n <> 1 then raise exception 'FAIL T3 yesterday rows %, expected 1', n; end if;
  raise notice 'PASS T3 dates respected';
end $$;

-- T4 bad ranges are refused.
do $$ begin
  begin
    perform * from public.bus_day_totals('00000000-0000-0000-0000-00000000032a', 'town', public.today_ist(), public.today_ist() - 1);
    raise exception 'FAIL T4 reversed range accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform * from public.bus_day_totals('00000000-0000-0000-0000-00000000032a', 'town', public.today_ist() - 800, public.today_ist());
    raise exception 'FAIL T4 huge range accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS T4 bad ranges refused';
end $$;

-- T5 an Omni-only manager sees no Town totals.
select pg_temp.act_as('00000000-0000-0000-0000-0000000032d1');
do $$ declare n int; begin
  select count(*) into n from public.bus_day_totals('00000000-0000-0000-0000-00000000032a', 'town', public.today_ist() - 1, public.today_ist());
  if n <> 0 then raise exception 'FAIL T5 omni manager saw % Town rows', n; end if;
  select count(*) into n from public.bus_day_totals('00000000-0000-0000-0000-00000000032a', 'omni', public.today_ist(), public.today_ist());
  if n <> 1 then raise exception 'FAIL T5 omni manager saw % Omni rows, expected 1', n; end if;
  raise notice 'PASS T5 managers see only their module';
end $$;

-- T6 crew see nothing, and another company's admin sees nothing.
select pg_temp.act_as('00000000-0000-0000-0000-0000000032c1');
do $$ declare n int; begin
  select count(*) into n from public.bus_day_totals('00000000-0000-0000-0000-00000000032a', null, public.today_ist() - 1, public.today_ist());
  if n <> 0 then raise exception 'FAIL T6 crew saw % rows', n; end if;
  raise notice 'PASS T6 crew see nothing';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000032b1');
do $$ declare n int; begin
  select count(*) into n from public.bus_day_totals('00000000-0000-0000-0000-00000000032a', null, public.today_ist() - 1, public.today_ist());
  if n <> 0 then raise exception 'FAIL T6 outsider saw % rows', n; end if;
  raise notice 'PASS T6 other companies see nothing';
end $$;

rollback;
