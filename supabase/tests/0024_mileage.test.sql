-- Database checks for migration 0024. Runs inside one transaction and rolls
-- back, so it leaves no data behind. Run with scripts/test-db.sh against a
-- local or test database that has migrations 0001 to 0024 (never production).
\set ON_ERROR_STOP 1
\set QUIET 1
begin;

-- Acts as a signed-in user (both claim styles that auth.uid() reads).
create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Company A: an admin, an Omni-only manager and a crew member on the town bus.
-- Company B: an admin.
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000024a1', 'admin@a24.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000024d1', 'manager@a24.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000024c1', 'crew@a24.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000024b1', 'admin@b24.test', '{}', '{}');

insert into public.organizations (id, name, bus_types) values
  ('00000000-0000-0000-0000-00000000024a', 'Company A24', array['town', 'omni']),
  ('00000000-0000-0000-0000-00000000024b', 'Company B24', array['town']);

insert into public.buses (id, organization_id, registration_number, route_label, bus_type) values
  ('00000000-0000-0000-0000-000000024b01', '00000000-0000-0000-0000-00000000024a', 'TN 24 T 0001', 'Town', 'town'),
  ('00000000-0000-0000-0000-000000024b02', '00000000-0000-0000-0000-00000000024a', 'TN 24 O 0002', 'Omni', 'omni'),
  ('00000000-0000-0000-0000-000000024b09', '00000000-0000-0000-0000-00000000024b', 'TN 24 B 0009', 'B', 'town');

insert into public.organization_members (organization_id, user_id, role, module) values
  ('00000000-0000-0000-0000-00000000024a', '00000000-0000-0000-0000-0000000024a1', 'admin', null),
  ('00000000-0000-0000-0000-00000000024a', '00000000-0000-0000-0000-0000000024d1', 'manager', 'omni'),
  ('00000000-0000-0000-0000-00000000024a', '00000000-0000-0000-0000-0000000024c1', 'crew', null),
  ('00000000-0000-0000-0000-00000000024b', '00000000-0000-0000-0000-0000000024b1', 'admin', null);

insert into public.crew_assignments (organization_id, user_id, bus_id) values
  ('00000000-0000-0000-0000-00000000024a', '00000000-0000-0000-0000-0000000024c1', '00000000-0000-0000-0000-000000024b01');

set local role authenticated;
\pset tuples_only on

-- ---------------------------------------------------------------------------
-- Town diesel: odometer, litres and full tank
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000024c1');
do $$ begin
  insert into public.daily_entries (organization_id, bus_id, entry_date, kind, category, amount_inr, litres, odometer_km, full_tank, created_by)
  values ('00000000-0000-0000-0000-00000000024a', '00000000-0000-0000-0000-000000024b01', public.today_ist(), 'expense', 'diesel', 9500, 100, 120500, true, auth.uid());
  raise notice 'PASS D1 crew add diesel with odometer, litres and full tank';

  begin
    insert into public.daily_entries (organization_id, bus_id, entry_date, kind, category, amount_inr, litres, created_by)
    values ('00000000-0000-0000-0000-00000000024a', '00000000-0000-0000-0000-000000024b01', public.today_ist(), 'expense', 'toll', 150, 20, auth.uid());
    raise exception 'FAIL D2 litres saved on a toll entry';
  exception when check_violation then raise notice 'PASS D2 litres only on diesel';
  end;

  begin
    insert into public.daily_entries (organization_id, bus_id, entry_date, kind, category, amount_inr, litres, created_by)
    values ('00000000-0000-0000-0000-00000000024a', '00000000-0000-0000-0000-000000024b01', public.today_ist(), 'expense', 'diesel', 150, 0, auth.uid());
    raise exception 'FAIL D3 zero litres saved';
  exception when check_violation then raise notice 'PASS D3 zero litres refused';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Bus targets
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000024a1');
do $$ begin
  update public.buses set target_kmpl = 4.2, tank_litres = 250
  where id = '00000000-0000-0000-0000-000000024b02';
  raise notice 'PASS B1 admin sets target and tank size';
  begin
    update public.buses set target_kmpl = 40 where id = '00000000-0000-0000-0000-000000024b02';
    raise exception 'FAIL B2 target of 40 km/L saved';
  exception when check_violation then raise notice 'PASS B2 impossible target refused';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Checked mileage alerts
-- ---------------------------------------------------------------------------
do $$ declare n int; begin
  insert into public.mileage_checks (organization_id, bus_id, alert_key, note)
  values ('00000000-0000-0000-0000-00000000024a', '00000000-0000-0000-0000-000000024b01', 'drop:fill:x1', 'Pump short');
  insert into public.mileage_checks (organization_id, bus_id, alert_key)
  values ('00000000-0000-0000-0000-00000000024a', '00000000-0000-0000-0000-000000024b02', 'drop:trip:x2');
  select count(*) into n from public.mileage_checks;
  if n <> 2 then raise exception 'FAIL M1 admin sees % checks', n; end if;
  raise notice 'PASS M1 admin marks alerts checked';

  begin
    insert into public.mileage_checks (organization_id, bus_id, alert_key)
    values ('00000000-0000-0000-0000-00000000024a', '00000000-0000-0000-0000-000000024b01', 'drop:fill:x1');
    raise exception 'FAIL M2 same alert checked twice';
  exception when unique_violation then raise notice 'PASS M2 one check per alert';
  end;
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000024d1');
do $$ declare n int; begin
  select count(*) into n from public.mileage_checks;
  if n <> 1 then raise exception 'FAIL M3 Omni manager sees % checks', n; end if;
  begin
    insert into public.mileage_checks (organization_id, bus_id, alert_key)
    values ('00000000-0000-0000-0000-00000000024a', '00000000-0000-0000-0000-000000024b01', 'jump:fill:x3');
    raise exception 'FAIL M3 Omni manager checked a town alert';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS M3 manager only sees and checks their module';
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000024c1');
do $$ declare n int; begin
  select count(*) into n from public.mileage_checks;
  if n <> 0 then raise exception 'FAIL M4 crew read % checks', n; end if;
  begin
    insert into public.mileage_checks (organization_id, bus_id, alert_key)
    values ('00000000-0000-0000-0000-00000000024a', '00000000-0000-0000-0000-000000024b01', 'jump:fill:x4');
    raise exception 'FAIL M4 crew checked an alert';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS M4 crew cannot see or check alerts';
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000024b1');
do $$ declare n int; begin
  select count(*) into n from public.mileage_checks;
  if n <> 0 then raise exception 'FAIL M5 other company read % checks', n; end if;
  begin
    insert into public.mileage_checks (organization_id, bus_id, alert_key)
    values ('00000000-0000-0000-0000-00000000024b', '00000000-0000-0000-0000-000000024b01', 'drop:fill:x5');
    raise exception 'FAIL M5 check saved on another company''s bus';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS M5 other company cannot read or add checks';
end $$;

reset role;
\echo 'All database checks passed.'
rollback;
