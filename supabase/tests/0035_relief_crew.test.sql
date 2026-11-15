-- Database checks for migration 0035. Runs inside one transaction and rolls
-- back, so it leaves no data behind. Run with scripts/test-db.sh against a
-- local or test database that has migrations 0001 to 0035 (never production).
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = notice;
begin;

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000035a1', 'admin@a35.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000035d1', 'omnimgr@a35.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000035c1', 'crew@a35.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000035b1', 'admin@b35.test', '{}', '{}');

insert into public.organizations (id, name, bus_types) values
  ('00000000-0000-0000-0000-00000000035a', 'Company A35', array['town', 'omni']),
  ('00000000-0000-0000-0000-00000000035b', 'Company B35', array['town']);

insert into public.buses (id, organization_id, registration_number, route_label, bus_type) values
  ('00000000-0000-0000-0000-000000350b01', '00000000-0000-0000-0000-00000000035a', 'TN 35 T 0001', 'Town 1', 'town'),
  ('00000000-0000-0000-0000-000000350b02', '00000000-0000-0000-0000-00000000035a', 'TN 35 T 0002', 'Town 2', 'town'),
  ('00000000-0000-0000-0000-000000350b03', '00000000-0000-0000-0000-00000000035a', 'TN 35 O 0003', 'Omni', 'omni');

insert into public.organization_members (organization_id, user_id, role, module) values
  ('00000000-0000-0000-0000-00000000035a', '00000000-0000-0000-0000-0000000035a1', 'admin', null),
  ('00000000-0000-0000-0000-00000000035a', '00000000-0000-0000-0000-0000000035d1', 'manager', 'omni'),
  ('00000000-0000-0000-0000-00000000035a', '00000000-0000-0000-0000-0000000035c1', 'crew', null),
  ('00000000-0000-0000-0000-00000000035b', '00000000-0000-0000-0000-0000000035b1', 'admin', null);

insert into public.crew_assignments (organization_id, user_id, bus_id) values
  ('00000000-0000-0000-0000-00000000035a', '00000000-0000-0000-0000-0000000035c1', '00000000-0000-0000-0000-000000350b01');
insert into public.crew_people (id, organization_id, name, job, module, active) values
  ('00000000-0000-0000-0000-000000350f01', '00000000-0000-0000-0000-00000000035a', 'Murugan', 'driver', 'town', true),
  ('00000000-0000-0000-0000-000000350f02', '00000000-0000-0000-0000-00000000035a', 'Arul', 'conductor', 'town', true),
  ('00000000-0000-0000-0000-000000350f03', '00000000-0000-0000-0000-00000000035a', 'Ravi', 'conductor', 'town', true),
  ('00000000-0000-0000-0000-000000350f04', '00000000-0000-0000-0000-00000000035a', 'Selvam', 'conductor', 'omni', true);

set local role authenticated;
\pset tuples_only on

select pg_temp.act_as('00000000-0000-0000-0000-0000000035a1');
do $$ declare n int; begin
  -- R1 a relief needs someone who started the duty.
  begin
    insert into public.day_crew_relief (organization_id, day, bus_id, duty, person_id)
    values ('00000000-0000-0000-0000-00000000035a', public.today_ist(), '00000000-0000-0000-0000-000000350b01', 'conductor', '00000000-0000-0000-0000-000000350f03');
    raise exception 'FAIL R1 relief without a starter';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS R1 relief needs a starter first';

  insert into public.day_crew (organization_id, day, bus_id, duty, person_id) values
    ('00000000-0000-0000-0000-00000000035a', public.today_ist(), '00000000-0000-0000-0000-000000350b01', 'driver', '00000000-0000-0000-0000-000000350f01'),
    ('00000000-0000-0000-0000-00000000035a', public.today_ist(), '00000000-0000-0000-0000-000000350b01', 'conductor', '00000000-0000-0000-0000-000000350f02');

  -- R2 a relief from trip 5 is saved; trip number is optional.
  insert into public.day_crew_relief (organization_id, day, bus_id, duty, person_id, from_trip)
  values ('00000000-0000-0000-0000-00000000035a', public.today_ist(), '00000000-0000-0000-0000-000000350b01', 'conductor', '00000000-0000-0000-0000-000000350f03', 5);
  raise notice 'PASS R2 relief saved with a trip number';

  -- R3 the relief cannot be the same person as the starter.
  begin
    insert into public.day_crew_relief (organization_id, day, bus_id, duty, person_id)
    values ('00000000-0000-0000-0000-00000000035a', public.today_ist(), '00000000-0000-0000-0000-000000350b01', 'conductor', '00000000-0000-0000-0000-000000350f02');
    raise exception 'FAIL R3 starter relieved themselves';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS R3 relief differs from the starter';

  -- R4 an Omni person cannot relieve on a Town bus; a person who has left cannot either.
  begin
    insert into public.day_crew_relief (organization_id, day, bus_id, duty, person_id)
    values ('00000000-0000-0000-0000-00000000035a', public.today_ist(), '00000000-0000-0000-0000-000000350b01', 'conductor', '00000000-0000-0000-0000-000000350f04');
    raise exception 'FAIL R4 omni person accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS R4 Town crew only';

  -- R5 nobody works two buses on one day: not as relief, not as a starter.
  begin
    insert into public.day_crew (organization_id, day, bus_id, duty, person_id)
    values ('00000000-0000-0000-0000-00000000035a', public.today_ist(), '00000000-0000-0000-0000-000000350b02', 'conductor', '00000000-0000-0000-0000-000000350f03');
    raise exception 'FAIL R5 relief put on a second bus';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    insert into public.day_crew (organization_id, day, bus_id, duty, person_id)
    values ('00000000-0000-0000-0000-00000000035a', public.today_ist(), '00000000-0000-0000-0000-000000350b02', 'driver', '00000000-0000-0000-0000-000000350f01');
    raise exception 'FAIL R5 driver put on a second bus';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS R5 one bus per person per day';

  -- R6 tomorrow is refused.
  begin
    insert into public.day_crew_relief (organization_id, day, bus_id, duty, person_id)
    values ('00000000-0000-0000-0000-00000000035a', public.today_ist() + 1, '00000000-0000-0000-0000-000000350b01', 'conductor', '00000000-0000-0000-0000-000000350f03');
    raise exception 'FAIL R6 future relief accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS R6 future days refused';

  -- R7 the day's crew lists the starter, then the relief.
  select count(*) into n from public.bus_day_crew('00000000-0000-0000-0000-00000000035a', public.today_ist()) where duty = 'conductor';
  if n <> 2 then raise exception 'FAIL R7 % conductors listed, expected 2', n; end if;
  if not exists (select 1 from public.bus_day_crew('00000000-0000-0000-0000-00000000035a', public.today_ist()) where relief and from_trip = 5) then
    raise exception 'FAIL R7 relief row missing';
  end if;
  raise notice 'PASS R7 bus_day_crew lists starter and relief';
end $$;

-- R8 crew, Omni manager and other companies are refused.
select pg_temp.act_as('00000000-0000-0000-0000-0000000035c1');
do $$ declare n int; begin
  select count(*) into n from public.day_crew_relief;
  if n <> 0 then raise exception 'FAIL R8 crew read % relief rows', n; end if;
  begin
    insert into public.day_crew_relief (organization_id, day, bus_id, duty, person_id)
    values ('00000000-0000-0000-0000-00000000035a', public.today_ist(), '00000000-0000-0000-0000-000000350b01', 'driver', '00000000-0000-0000-0000-000000350f03');
    raise exception 'FAIL R8 crew added a relief';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS R8 crew refused';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000035d1');
do $$ declare n int; begin
  select count(*) into n from public.day_crew_relief;
  if n <> 0 then raise exception 'FAIL R9 Omni manager read % Town relief rows', n; end if;
  raise notice 'PASS R9 managers stay in their module';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000035b1');
do $$ declare n int; begin
  select count(*) into n from public.day_crew_relief;
  if n <> 0 then raise exception 'FAIL R10 outsider read % rows', n; end if;
  raise notice 'PASS R10 other companies see nothing';
end $$;

-- R11 a closed day freezes its reliefs.
select pg_temp.act_as('00000000-0000-0000-0000-0000000035a1');
do $$ begin
  perform public.close_day('00000000-0000-0000-0000-00000000035a', public.today_ist());
  begin
    update public.day_crew_relief set from_trip = 6 where bus_id = '00000000-0000-0000-0000-000000350b01';
    raise exception 'FAIL R11 relief changed on a closed day';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS R11 closed days freeze reliefs';
end $$;

rollback;
