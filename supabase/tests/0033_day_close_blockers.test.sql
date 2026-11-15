-- Database checks for migration 0033. Runs inside one transaction and rolls
-- back, so it leaves no data behind. Run with scripts/test-db.sh against a
-- local or test database that has migrations 0001 to 0033 (never production).
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = notice;
begin;

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000033a1', 'admin@a33.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000033d1', 'omnimgr@a33.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000033c1', 'crew@a33.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000033b1', 'admin@b33.test', '{}', '{}');

insert into public.organizations (id, name, bus_types) values
  ('00000000-0000-0000-0000-00000000033a', 'Company A33', array['town', 'omni']),
  ('00000000-0000-0000-0000-00000000033b', 'Company B33', array['town']);

insert into public.buses (id, organization_id, registration_number, route_label, bus_type) values
  ('00000000-0000-0000-0000-000000330b01', '00000000-0000-0000-0000-00000000033a', 'TN 33 T 0001', 'Town 1', 'town'),
  ('00000000-0000-0000-0000-000000330b02', '00000000-0000-0000-0000-00000000033a', 'TN 33 T 0002', 'Town 2', 'town'),
  ('00000000-0000-0000-0000-000000330b03', '00000000-0000-0000-0000-00000000033a', 'TN 33 O 0003', 'Omni', 'omni');

insert into public.organization_members (organization_id, user_id, role, module) values
  ('00000000-0000-0000-0000-00000000033a', '00000000-0000-0000-0000-0000000033a1', 'admin', null),
  ('00000000-0000-0000-0000-00000000033a', '00000000-0000-0000-0000-0000000033d1', 'manager', 'omni'),
  ('00000000-0000-0000-0000-00000000033a', '00000000-0000-0000-0000-0000000033c1', 'crew', null),
  ('00000000-0000-0000-0000-00000000033b', '00000000-0000-0000-0000-0000000033b1', 'admin', null);

insert into public.crew_assignments (organization_id, user_id, bus_id) values
  ('00000000-0000-0000-0000-00000000033a', '00000000-0000-0000-0000-0000000033c1', '00000000-0000-0000-0000-000000330b01');

insert into public.crew_people (id, organization_id, name, job, module, active) values
  ('00000000-0000-0000-0000-000000330f01', '00000000-0000-0000-0000-00000000033a', 'Murugan', 'driver', 'town', true),
  ('00000000-0000-0000-0000-000000330f02', '00000000-0000-0000-0000-00000000033a', 'Arul', 'conductor', 'town', true);

-- Today's money on Town bus 1 only.
insert into public.daily_entries (organization_id, bus_id, entry_date, kind, category, amount_inr) values
  ('00000000-0000-0000-0000-00000000033a', '00000000-0000-0000-0000-000000330b01', public.today_ist(), 'income', 'ticket_collection', 5000);

set local role authenticated;
\pset tuples_only on

-- K1 bus 1 has money but no crew: one blocker, with a code, the bus and a sentence.
select pg_temp.act_as('00000000-0000-0000-0000-0000000033a1');
do $$ declare r record; n int; begin
  select count(*) into n from public.day_close_blockers('00000000-0000-0000-0000-00000000033a', public.today_ist());
  if n <> 1 then raise exception 'FAIL K1 % blockers, expected 1', n; end if;
  select * into r from public.day_close_blockers('00000000-0000-0000-0000-00000000033a', public.today_ist());
  if r.code <> 'crew_missing' or r.bus_id <> '00000000-0000-0000-0000-000000330b01'::uuid or r.detail not like '%TN 33 T 0001 (driver and conductor)%' then
    raise exception 'FAIL K1 got %, %, %', r.code, r.bus_id, r.detail;
  end if;
  raise notice 'PASS K1 blocker lists the bus and what is missing';
end $$;

-- K2 close_day refuses, with the same bus and jobs named as before.
do $$ begin
  begin
    perform public.close_day('00000000-0000-0000-0000-00000000033a', public.today_ist());
    raise exception 'FAIL K2 day closed with a blocker';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like '%TN 33 T 0001 (driver and conductor)%' then raise exception 'FAIL K2 message: %', sqlerrm; end if;
    raise notice 'PASS K2 close refused: %', sqlerrm;
  end;
end $$;

-- K3 once the crew is in, there are no blockers and the day closes.
do $$ declare n int; begin
  insert into public.day_crew (organization_id, day, bus_id, duty, person_id) values
    ('00000000-0000-0000-0000-00000000033a', public.today_ist(), '00000000-0000-0000-0000-000000330b01', 'driver', '00000000-0000-0000-0000-000000330f01'),
    ('00000000-0000-0000-0000-00000000033a', public.today_ist(), '00000000-0000-0000-0000-000000330b01', 'conductor', '00000000-0000-0000-0000-000000330f02');
  select count(*) into n from public.day_close_blockers('00000000-0000-0000-0000-00000000033a', public.today_ist());
  if n <> 0 then raise exception 'FAIL K3 % blockers left', n; end if;
  perform public.close_day('00000000-0000-0000-0000-00000000033a', public.today_ist());
  if not exists (select 1 from public.closed_days where organization_id = '00000000-0000-0000-0000-00000000033a' and day = public.today_ist()) then
    raise exception 'FAIL K3 day not closed';
  end if;
  raise notice 'PASS K3 day closes when nothing blocks it';
end $$;

-- K4 crew and other companies get no blockers; crew cannot close.
select pg_temp.act_as('00000000-0000-0000-0000-0000000033c1');
do $$ declare n int; begin
  select count(*) into n from public.day_close_blockers('00000000-0000-0000-0000-00000000033a', public.today_ist() - 1);
  if n <> 0 then raise exception 'FAIL K4 crew saw blockers'; end if;
  begin
    perform public.close_day('00000000-0000-0000-0000-00000000033a', public.today_ist() - 1);
    raise exception 'FAIL K4 crew closed a day';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS K4 crew cannot see or close';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000033b1');
do $$ declare n int; begin
  select count(*) into n from public.day_close_blockers('00000000-0000-0000-0000-00000000033a', public.today_ist());
  if n <> 0 then raise exception 'FAIL K4 outsider saw blockers'; end if;
  raise notice 'PASS K4 other companies see nothing';
end $$;

rollback;
