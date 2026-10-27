-- Database checks for migration 0022. Runs inside one transaction and rolls
-- back, so it leaves no data behind. Run with scripts/test-db.sh against a
-- local or test database that has migrations 0001 to 0022 (never production).
\set ON_ERROR_STOP 1
\set QUIET 1
begin;

-- Acts as a signed-in user (both claim styles that auth.uid() reads).
create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Company A: an admin, a manager and a crew member on the town bus.
-- Company B: an admin.
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000002a1', 'admin@a22.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000002d1', 'manager@a22.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000002c1', 'crew@a22.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000002b1', 'admin@b22.test', '{}', '{}');

insert into public.organizations (id, name, bus_types) values
  ('00000000-0000-0000-0000-00000000022a', 'Company A22', array['town', 'omni']),
  ('00000000-0000-0000-0000-00000000022b', 'Company B22', array['town']);

insert into public.buses (id, organization_id, registration_number, route_label, bus_type) values
  ('00000000-0000-0000-0000-000000022b01', '00000000-0000-0000-0000-00000000022a', 'TN 22 T 0001', 'Town', 'town'),
  ('00000000-0000-0000-0000-000000022b02', '00000000-0000-0000-0000-00000000022a', 'TN 22 O 0002', 'Omni', 'omni'),
  ('00000000-0000-0000-0000-000000022b09', '00000000-0000-0000-0000-00000000022b', 'TN 22 B 0009', 'B', 'town');

insert into public.organization_members (organization_id, user_id, role, module) values
  ('00000000-0000-0000-0000-00000000022a', '00000000-0000-0000-0000-0000000002a1', 'admin', null),
  ('00000000-0000-0000-0000-00000000022a', '00000000-0000-0000-0000-0000000002d1', 'manager', null),
  ('00000000-0000-0000-0000-00000000022a', '00000000-0000-0000-0000-0000000002c1', 'crew', null),
  ('00000000-0000-0000-0000-00000000022b', '00000000-0000-0000-0000-0000000002b1', 'admin', null);

insert into public.crew_assignments (organization_id, user_id, bus_id) values
  ('00000000-0000-0000-0000-00000000022a', '00000000-0000-0000-0000-0000000002c1', '00000000-0000-0000-0000-000000022b01');

-- Today's ticket money on the town bus, added by the admin.
insert into public.daily_entries (organization_id, bus_id, entry_date, kind, category, amount_inr) values
  ('00000000-0000-0000-0000-00000000022a', '00000000-0000-0000-0000-000000022b01', public.today_ist(), 'income', 'ticket_collection', 5000);

set local role authenticated;
\pset tuples_only on

-- ---------------------------------------------------------------------------
-- Day book: crew add, but can't read or change
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000002c1');
do $$ declare n int; begin
  insert into public.daily_entries (organization_id, bus_id, entry_date, kind, category, amount_inr, created_by)
  values ('00000000-0000-0000-0000-00000000022a', '00000000-0000-0000-0000-000000022b01', public.today_ist(), 'expense', 'toll', 150, auth.uid());
  raise notice 'PASS C1 crew add money out for their bus';

  select count(*) into n from public.daily_entries;
  if n <> 0 then raise exception 'FAIL C2 crew read % entries', n; end if;
  raise notice 'PASS C2 crew cannot read entries';

  update public.daily_entries set amount_inr = 1;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL C3 crew changed % entries', n; end if;
  delete from public.daily_entries;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL C3 crew deleted % entries', n; end if;
  raise notice 'PASS C3 crew cannot change or delete entries';

  begin
    insert into public.daily_entries (organization_id, bus_id, entry_date, kind, category, amount_inr, created_by)
    values ('00000000-0000-0000-0000-00000000022a', '00000000-0000-0000-0000-000000022b02', public.today_ist(), 'expense', 'toll', 150, auth.uid());
    raise exception 'FAIL C4 crew added money for another bus';
  exception when insufficient_privilege then raise notice 'PASS C4 crew refused on another bus';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Odometer readings
-- ---------------------------------------------------------------------------
do $$ declare n int; begin
  insert into public.odometer_readings (organization_id, bus_id, odometer_km)
  values ('00000000-0000-0000-0000-00000000022a', '00000000-0000-0000-0000-000000022b01', 120500);
  raise notice 'PASS O1 crew note the odometer for their bus';

  select count(*) into n from public.odometer_readings;
  if n <> 0 then raise exception 'FAIL O2 crew read % readings', n; end if;
  raise notice 'PASS O2 crew cannot read past readings';

  begin
    insert into public.odometer_readings (organization_id, bus_id, odometer_km)
    values ('00000000-0000-0000-0000-00000000022a', '00000000-0000-0000-0000-000000022b01', 120000);
    raise exception 'FAIL O3 a lower reading was saved';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS O3 lower reading refused: %', sqlerrm;
  end;

  begin
    insert into public.odometer_readings (organization_id, bus_id, odometer_km)
    values ('00000000-0000-0000-0000-00000000022a', '00000000-0000-0000-0000-000000022b02', 5000);
    raise exception 'FAIL O4 crew noted km for another bus';
  exception when insufficient_privilege then raise notice 'PASS O4 crew refused on another bus';
  end;
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000002d1');
do $$ declare n int; begin
  select count(*) into n from public.odometer_readings;
  if n <> 1 then raise exception 'FAIL O5 manager sees % readings', n; end if;
  select count(*) into n from public.daily_entries;
  if n <> 2 then raise exception 'FAIL O5 manager sees % entries', n; end if;
  if public.bus_latest_odometer('00000000-0000-0000-0000-000000022b01') <> 120500 then
    raise exception 'FAIL O5 latest odometer is wrong';
  end if;
  raise notice 'PASS O5 manager sees the crew reading and entries';
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000002b1');
do $$ declare n int; begin
  select count(*) into n from public.odometer_readings;
  if n <> 0 then raise exception 'FAIL O6 other company read % readings', n; end if;
  begin
    insert into public.odometer_readings (organization_id, bus_id, odometer_km)
    values ('00000000-0000-0000-0000-00000000022b', '00000000-0000-0000-0000-000000022b01', 999999);
    raise exception 'FAIL O7 reading saved on another company''s bus';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS O7 refused: %', sqlerrm;
  end;
  raise notice 'PASS O6 other company cannot read readings';
end $$;

reset role;
\echo 'All database checks passed.'
rollback;
