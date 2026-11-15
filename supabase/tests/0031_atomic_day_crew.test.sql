-- Database checks for migration 0031. Runs inside one transaction and rolls
-- back, so it leaves no data behind. Run with scripts/test-db.sh against a
-- local or test database that has migrations 0001 to 0031 (never production).
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = notice;
begin;

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000031a1', 'admin@a31.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000031d1', 'omnimgr@a31.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000031c1', 'crew@a31.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000031b1', 'admin@b31.test', '{}', '{}');

insert into public.organizations (id, name, bus_types) values
  ('00000000-0000-0000-0000-00000000031a', 'Company A31', array['town', 'omni']),
  ('00000000-0000-0000-0000-00000000031b', 'Company B31', array['town']);

insert into public.buses (id, organization_id, registration_number, route_label, bus_type) values
  ('00000000-0000-0000-0000-000000310b01', '00000000-0000-0000-0000-00000000031a', 'TN 31 T 0001', 'Town 1', 'town'),
  ('00000000-0000-0000-0000-000000310b02', '00000000-0000-0000-0000-00000000031a', 'TN 31 T 0002', 'Town 2', 'town'),
  ('00000000-0000-0000-0000-000000310b03', '00000000-0000-0000-0000-00000000031a', 'TN 31 O 0003', 'Omni', 'omni');

insert into public.organization_members (organization_id, user_id, role, module) values
  ('00000000-0000-0000-0000-00000000031a', '00000000-0000-0000-0000-0000000031a1', 'admin', null),
  ('00000000-0000-0000-0000-00000000031a', '00000000-0000-0000-0000-0000000031d1', 'manager', 'omni'),
  ('00000000-0000-0000-0000-00000000031a', '00000000-0000-0000-0000-0000000031c1', 'crew', null),
  ('00000000-0000-0000-0000-00000000031b', '00000000-0000-0000-0000-0000000031b1', 'admin', null);

insert into public.crew_assignments (organization_id, user_id, bus_id) values
  ('00000000-0000-0000-0000-00000000031a', '00000000-0000-0000-0000-0000000031c1', '00000000-0000-0000-0000-000000310b01');

insert into public.crew_people (id, organization_id, name, job, module, active) values
  ('00000000-0000-0000-0000-000000310f01', '00000000-0000-0000-0000-00000000031a', 'Murugan', 'driver', 'town', true),
  ('00000000-0000-0000-0000-000000310f02', '00000000-0000-0000-0000-00000000031a', 'Arul', 'conductor', 'town', true),
  ('00000000-0000-0000-0000-000000310f03', '00000000-0000-0000-0000-00000000031a', 'Selvam', 'driver', 'omni', true);

set local role authenticated;
\pset tuples_only on

-- B1 an admin sets the crew for two buses in one call.
select pg_temp.act_as('00000000-0000-0000-0000-0000000031a1');
do $$ declare n int; begin
  n := public.set_day_crew('00000000-0000-0000-0000-00000000031a', public.today_ist(), jsonb_build_array(
    jsonb_build_object('bus_id', '00000000-0000-0000-0000-000000310b01', 'duty', 'driver', 'person_id', '00000000-0000-0000-0000-000000310f01'),
    jsonb_build_object('bus_id', '00000000-0000-0000-0000-000000310b01', 'duty', 'conductor', 'person_id', '00000000-0000-0000-0000-000000310f02'),
    jsonb_build_object('bus_id', '00000000-0000-0000-0000-000000310b02', 'duty', 'driver', 'person_id', '00000000-0000-0000-0000-000000310f01')));
  if n <> 3 then raise exception 'FAIL B1 saved % rows, expected 3', n; end if;
  select count(*) into n from public.day_crew where day = public.today_ist();
  if n <> 3 then raise exception 'FAIL B1 found % rows', n; end if;
  raise notice 'PASS B1 whole day saved in one call';
end $$;

-- B2 calling it again with a different driver replaces the person; an empty person clears the job.
do $$ declare who uuid; n int; begin
  perform public.set_day_crew('00000000-0000-0000-0000-00000000031a', public.today_ist(), jsonb_build_array(
    jsonb_build_object('bus_id', '00000000-0000-0000-0000-000000310b02', 'duty', 'driver', 'person_id', '00000000-0000-0000-0000-000000310f02'),
    jsonb_build_object('bus_id', '00000000-0000-0000-0000-000000310b01', 'duty', 'conductor', 'person_id', '')));
  select person_id into who from public.day_crew where bus_id = '00000000-0000-0000-0000-000000310b02' and duty = 'driver' and day = public.today_ist();
  if who is distinct from '00000000-0000-0000-0000-000000310f02'::uuid then raise exception 'FAIL B2 driver not replaced'; end if;
  select count(*) into n from public.day_crew where bus_id = '00000000-0000-0000-0000-000000310b01' and duty = 'conductor' and day = public.today_ist();
  if n <> 0 then raise exception 'FAIL B2 job not cleared'; end if;
  raise notice 'PASS B2 replace and clear work';
end $$;

-- B3 one bad row (an Omni person on a Town bus) refuses the whole list; nothing from it is kept.
do $$ declare n int; begin
  begin
    perform public.set_day_crew('00000000-0000-0000-0000-00000000031a', public.today_ist() - 1, jsonb_build_array(
      jsonb_build_object('bus_id', '00000000-0000-0000-0000-000000310b01', 'duty', 'driver', 'person_id', '00000000-0000-0000-0000-000000310f01'),
      jsonb_build_object('bus_id', '00000000-0000-0000-0000-000000310b02', 'duty', 'driver', 'person_id', '00000000-0000-0000-0000-000000310f03')));
    raise exception 'FAIL B3 bad list accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  select count(*) into n from public.day_crew where day = public.today_ist() - 1;
  if n <> 0 then raise exception 'FAIL B3 % rows kept from a refused list', n; end if;
  raise notice 'PASS B3 a failed list saves nothing';
end $$;

-- B4 tomorrow is refused, and a list that is not a list is refused.
do $$ begin
  begin
    perform public.set_day_crew('00000000-0000-0000-0000-00000000031a', public.today_ist() + 1, jsonb_build_array(
      jsonb_build_object('bus_id', '00000000-0000-0000-0000-000000310b01', 'duty', 'driver', 'person_id', '00000000-0000-0000-0000-000000310f01')));
    raise exception 'FAIL B4 future day accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.set_day_crew('00000000-0000-0000-0000-00000000031a', public.today_ist(), '{}'::jsonb);
    raise exception 'FAIL B4 object accepted as a list';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS B4 future days and bad input refused';
end $$;

-- B5 crew logins, the Omni-only manager and another company are all refused.
select pg_temp.act_as('00000000-0000-0000-0000-0000000031c1');
do $$ begin
  begin
    perform public.set_day_crew('00000000-0000-0000-0000-00000000031a', public.today_ist(), jsonb_build_array(
      jsonb_build_object('bus_id', '00000000-0000-0000-0000-000000310b01', 'duty', 'driver', 'person_id', '00000000-0000-0000-0000-000000310f01')));
    raise exception 'FAIL B5 crew set the day crew';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS B5 crew refused';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000031d1');
do $$ begin
  begin
    perform public.set_day_crew('00000000-0000-0000-0000-00000000031a', public.today_ist(), jsonb_build_array(
      jsonb_build_object('bus_id', '00000000-0000-0000-0000-000000310b01', 'duty', 'driver', 'person_id', '00000000-0000-0000-0000-000000310f01')));
    raise exception 'FAIL B5 omni manager set Town crew';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS B5 managers stay in their module';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000031b1');
do $$ begin
  begin
    perform public.set_day_crew('00000000-0000-0000-0000-00000000031a', public.today_ist(), jsonb_build_array(
      jsonb_build_object('bus_id', '00000000-0000-0000-0000-000000310b01', 'duty', 'driver', 'person_id', '00000000-0000-0000-0000-000000310f01')));
    raise exception 'FAIL B5 outsider set the day crew';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS B5 other companies refused';
end $$;

-- B6 a closed day is frozen.
select pg_temp.act_as('00000000-0000-0000-0000-0000000031a1');
do $$ begin
  perform public.close_day('00000000-0000-0000-0000-00000000031a', public.today_ist() - 2);
  begin
    perform public.set_day_crew('00000000-0000-0000-0000-00000000031a', public.today_ist() - 2, jsonb_build_array(
      jsonb_build_object('bus_id', '00000000-0000-0000-0000-000000310b01', 'duty', 'driver', 'person_id', '00000000-0000-0000-0000-000000310f01')));
    raise exception 'FAIL B6 closed day changed';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS B6 closed days stay frozen';
end $$;

rollback;
