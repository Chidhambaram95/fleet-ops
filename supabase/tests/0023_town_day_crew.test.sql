-- Database checks for migration 0023. Runs inside one transaction and rolls
-- back, so it leaves no data behind. Run with scripts/test-db.sh against a
-- local or test database that has migrations 0001 to 0023 (never production).
\set ON_ERROR_STOP 1
\set QUIET 1
begin;

-- Acts as a signed-in user (both claim styles that auth.uid() reads).
create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Company A: an admin, an Omni-only manager and a crew member on town bus 1.
-- Company B: an admin.
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000023a1', 'admin@a23.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000023d1', 'manager@a23.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000023c1', 'crew@a23.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000023b1', 'admin@b23.test', '{}', '{}');

insert into public.organizations (id, name, bus_types) values
  ('00000000-0000-0000-0000-00000000023a', 'Company A23', array['town', 'omni']),
  ('00000000-0000-0000-0000-00000000023b', 'Company B23', array['town']);

insert into public.buses (id, organization_id, registration_number, route_label, bus_type) values
  ('00000000-0000-0000-0000-000000023b01', '00000000-0000-0000-0000-00000000023a', 'TN 23 T 0001', 'Town 1', 'town'),
  ('00000000-0000-0000-0000-000000023b03', '00000000-0000-0000-0000-00000000023a', 'TN 23 T 0003', 'Town 3', 'town'),
  ('00000000-0000-0000-0000-000000023b02', '00000000-0000-0000-0000-00000000023a', 'TN 23 O 0002', 'Omni', 'omni'),
  ('00000000-0000-0000-0000-000000023b09', '00000000-0000-0000-0000-00000000023b', 'TN 23 B 0009', 'B', 'town');

insert into public.organization_members (organization_id, user_id, role, module) values
  ('00000000-0000-0000-0000-00000000023a', '00000000-0000-0000-0000-0000000023a1', 'admin', null),
  ('00000000-0000-0000-0000-00000000023a', '00000000-0000-0000-0000-0000000023d1', 'manager', 'omni'),
  ('00000000-0000-0000-0000-00000000023a', '00000000-0000-0000-0000-0000000023c1', 'crew', null),
  ('00000000-0000-0000-0000-00000000023b', '00000000-0000-0000-0000-0000000023b1', 'admin', null);

insert into public.crew_assignments (organization_id, user_id, bus_id) values
  ('00000000-0000-0000-0000-00000000023a', '00000000-0000-0000-0000-0000000023c1', '00000000-0000-0000-0000-000000023b01');

insert into public.crew_people (id, organization_id, name, job, module, active) values
  ('00000000-0000-0000-0000-000000023f01', '00000000-0000-0000-0000-00000000023a', 'Murugan', 'driver', 'town', true),
  ('00000000-0000-0000-0000-000000023f02', '00000000-0000-0000-0000-00000000023a', 'Selvam', 'driver', 'omni', true),
  ('00000000-0000-0000-0000-000000023f03', '00000000-0000-0000-0000-00000000023a', 'Ravi', 'driver', 'town', false),
  ('00000000-0000-0000-0000-000000023f09', '00000000-0000-0000-0000-00000000023b', 'Kumar', 'driver', 'town', true);

-- Today's ticket money on town bus 1 only. Town bus 3 has no entries.
insert into public.daily_entries (organization_id, bus_id, entry_date, kind, category, amount_inr) values
  ('00000000-0000-0000-0000-00000000023a', '00000000-0000-0000-0000-000000023b01', public.today_ist(), 'income', 'ticket_collection', 5000);

set local role authenticated;
\pset tuples_only on

-- ---------------------------------------------------------------------------
-- Admin: conductors and the day crew
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000023a1');
do $$ declare n int; begin
  insert into public.crew_people (id, organization_id, name, job, module)
  values ('00000000-0000-0000-0000-000000023f04', '00000000-0000-0000-0000-00000000023a', 'Arul', 'conductor', 'town');
  raise notice 'PASS D1 admin adds a conductor';

  insert into public.day_crew (organization_id, day, bus_id, duty, person_id)
  values ('00000000-0000-0000-0000-00000000023a', public.today_ist(), '00000000-0000-0000-0000-000000023b01', 'driver', '00000000-0000-0000-0000-000000023f01');
  raise notice 'PASS D2 admin sets the driver for a town bus';

  begin
    insert into public.day_crew (organization_id, day, bus_id, duty, person_id)
    values ('00000000-0000-0000-0000-00000000023a', public.today_ist(), '00000000-0000-0000-0000-000000023b01', 'driver', '00000000-0000-0000-0000-000000023f01');
    raise exception 'FAIL D3 two drivers saved for one bus and day';
  exception when unique_violation then raise notice 'PASS D3 one driver per bus per day';
  end;

  begin
    insert into public.day_crew (organization_id, day, bus_id, duty, person_id)
    values ('00000000-0000-0000-0000-00000000023a', public.today_ist(), '00000000-0000-0000-0000-000000023b02', 'driver', '00000000-0000-0000-0000-000000023f01');
    raise exception 'FAIL D4 day crew saved on an omni bus';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS D4 omni bus refused: %', sqlerrm;
  end;

  begin
    insert into public.day_crew (organization_id, day, bus_id, duty, person_id)
    values ('00000000-0000-0000-0000-00000000023a', public.today_ist(), '00000000-0000-0000-0000-000000023b03', 'driver', '00000000-0000-0000-0000-000000023f02');
    raise exception 'FAIL D5 omni driver saved on a town bus';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS D5 person outside Town crew refused: %', sqlerrm;
  end;

  begin
    insert into public.day_crew (organization_id, day, bus_id, duty, person_id)
    values ('00000000-0000-0000-0000-00000000023a', public.today_ist(), '00000000-0000-0000-0000-000000023b03', 'driver', '00000000-0000-0000-0000-000000023f03');
    raise exception 'FAIL D6 someone who left was saved';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS D6 person who left refused: %', sqlerrm;
  end;

  begin
    insert into public.day_crew (organization_id, day, bus_id, duty, person_id)
    values ('00000000-0000-0000-0000-00000000023a', public.today_ist(), '00000000-0000-0000-0000-000000023b03', 'driver', '00000000-0000-0000-0000-000000023f09');
    raise exception 'FAIL D7 another company''s driver saved';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS D7 another company''s driver refused: %', sqlerrm;
  end;

  begin
    insert into public.day_crew (organization_id, day, bus_id, duty, person_id)
    values ('00000000-0000-0000-0000-00000000023a', public.today_ist() + 1, '00000000-0000-0000-0000-000000023b03', 'driver', '00000000-0000-0000-0000-000000023f01');
    raise exception 'FAIL D8 crew saved for tomorrow';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS D8 future day refused: %', sqlerrm;
  end;

  -- Bus 1 has money but no conductor; bus 3 has no money, so it doesn't count.
  select count(*) into n from public.town_day_crew_missing('00000000-0000-0000-0000-00000000023a', public.today_ist());
  if n <> 1 then raise exception 'FAIL D9 % buses missing crew, expected 1', n; end if;
  raise notice 'PASS D9 only the town bus with money counts';

  begin
    perform public.close_day('00000000-0000-0000-0000-00000000023a', public.today_ist());
    raise exception 'FAIL D10 day closed without a conductor';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like '%TN 23 T 0001 (conductor)%' then raise exception 'FAIL D10 message: %', sqlerrm; end if;
    raise notice 'PASS D10 close refused: %', sqlerrm;
  end;

  insert into public.day_crew (organization_id, day, bus_id, duty, person_id)
  values ('00000000-0000-0000-0000-00000000023a', public.today_ist(), '00000000-0000-0000-0000-000000023b01', 'conductor', '00000000-0000-0000-0000-000000023f04');
  perform public.close_day('00000000-0000-0000-0000-00000000023a', public.today_ist());
  raise notice 'PASS D11 day closes once driver and conductor are in';

  begin
    update public.day_crew set person_id = '00000000-0000-0000-0000-000000023f04'
    where duty = 'driver' and bus_id = '00000000-0000-0000-0000-000000023b01';
    raise exception 'FAIL D12 closed day crew was changed';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS D12 closed day crew is locked: %', sqlerrm;
  end;

  perform public.open_for_edit('00000000-0000-0000-0000-00000000023a', public.today_ist(), null, 'Wrong driver picked');
  update public.day_crew set person_id = '00000000-0000-0000-0000-000000023f04'
  where duty = 'driver' and bus_id = '00000000-0000-0000-0000-000000023b01';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL D13 opened day not changed'; end if;
  raise notice 'PASS D13 opened day can be changed with a comment';

  select count(*) into n from public.audit_log
  where table_name = 'day_crew' and module = 'town' and reason = 'Wrong driver picked';
  if n <> 1 then raise exception 'FAIL D14 % history rows with the comment', n; end if;
  raise notice 'PASS D14 change history keeps the day crew change and comment';
end $$;

-- ---------------------------------------------------------------------------
-- Others
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000023c1');
do $$ declare n int; begin
  select count(*) into n from public.day_crew;
  if n <> 0 then raise exception 'FAIL D15 crew login read % day crew rows', n; end if;
  begin
    insert into public.day_crew (organization_id, day, bus_id, duty, person_id)
    values ('00000000-0000-0000-0000-00000000023a', public.today_ist() - 1, '00000000-0000-0000-0000-000000023b01', 'driver', '00000000-0000-0000-0000-000000023f01');
    raise exception 'FAIL D15 crew login set the day crew';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS D15 crew logins can''t see or set the day crew';
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000023d1');
do $$ declare n int; begin
  select count(*) into n from public.day_crew;
  if n <> 0 then raise exception 'FAIL D16 omni manager read % town rows', n; end if;
  begin
    insert into public.day_crew (organization_id, day, bus_id, duty, person_id)
    values ('00000000-0000-0000-0000-00000000023a', public.today_ist() - 1, '00000000-0000-0000-0000-000000023b01', 'driver', '00000000-0000-0000-0000-000000023f01');
    raise exception 'FAIL D16 omni manager set town day crew';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS D16 an Omni-only manager can''t see or set Town day crew';
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000023b1');
do $$ declare n int; begin
  select count(*) into n from public.day_crew;
  if n <> 0 then raise exception 'FAIL D17 other company read % rows', n; end if;
  select count(*) into n from public.town_day_crew_missing('00000000-0000-0000-0000-00000000023a', public.today_ist());
  if n <> 0 then raise exception 'FAIL D17 other company saw % missing buses', n; end if;
  raise notice 'PASS D17 another company sees nothing';
end $$;

-- Deleting the company removes its day crew too.
reset role;
do $$ declare n int; begin
  delete from public.organizations where id = '00000000-0000-0000-0000-00000000023a';
  select count(*) into n from public.day_crew where organization_id = '00000000-0000-0000-0000-00000000023a';
  if n <> 0 then raise exception 'FAIL D18 % day crew rows left', n; end if;
  raise notice 'PASS D18 deleting the company removes its day crew';
end $$;

\echo 'All database checks passed.'
rollback;
