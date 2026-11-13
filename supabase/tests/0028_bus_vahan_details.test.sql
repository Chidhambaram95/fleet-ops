-- Database checks for migration 0028. Runs inside one transaction and rolls
-- back, so it leaves no data behind. Run with scripts/test-db.sh against a
-- local or test database that has migrations 0001 to 0028 (never production).
\set ON_ERROR_STOP 1
\set QUIET 1
begin;

-- Acts as a signed-in user (both claim styles that auth.uid() reads).
create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- Company A: an admin and a manager. Company B: an admin.
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000028a1', 'admin@a28.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000028d1', 'manager@a28.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000028b1', 'admin@b28.test', '{}', '{}');

insert into public.organizations (id, name, bus_types) values
  ('00000000-0000-0000-0000-00000000028a', 'Company A28', array['town']),
  ('00000000-0000-0000-0000-00000000028b', 'Company B28', array['town']);

insert into public.buses (id, organization_id, registration_number, route_label, bus_type) values
  ('00000000-0000-0000-0000-000000028b01', '00000000-0000-0000-0000-00000000028a', 'TN 28 T 0001', 'Town', 'town'),
  ('00000000-0000-0000-0000-000000028b09', '00000000-0000-0000-0000-00000000028b', 'TN 28 B 0009', 'B', 'town');

insert into public.organization_members (organization_id, user_id, role, module) values
  ('00000000-0000-0000-0000-00000000028a', '00000000-0000-0000-0000-0000000028a1', 'admin', null),
  ('00000000-0000-0000-0000-00000000028a', '00000000-0000-0000-0000-0000000028d1', 'manager', null),
  ('00000000-0000-0000-0000-00000000028b', '00000000-0000-0000-0000-0000000028b1', 'admin', null);

set local role authenticated;
\pset tuples_only on

-- Existing buses start empty.
select pg_temp.act_as('00000000-0000-0000-0000-0000000028a1');
do $$ declare o text; c text; begin
  select owner_name, chassis_last5 into o, c from public.buses where id = '00000000-0000-0000-0000-000000028b01';
  if o <> '' or c <> '' then raise exception 'FAIL V1 new columns not empty: % %', o, c; end if;
  raise notice 'PASS V1 owner and chassis start empty';
end $$;

-- Admin saves the owner and chassis last 5.
do $$ declare n int; begin
  update public.buses set owner_name = 'S KUMAR', chassis_last5 = '50181'
  where id = '00000000-0000-0000-0000-000000028b01';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL V2 admin update changed % rows', n; end if;
  raise notice 'PASS V2 admin saves owner and chassis last 5';
end $$;

-- Chassis must be exactly 5 capital letters or digits.
do $$ begin
  begin
    update public.buses set chassis_last5 = '5018' where id = '00000000-0000-0000-0000-000000028b01';
    raise exception 'FAIL V3 four characters saved';
  exception when check_violation then raise notice 'PASS V3 four characters refused'; end;
  begin
    update public.buses set chassis_last5 = 'ab12c' where id = '00000000-0000-0000-0000-000000028b01';
    raise exception 'FAIL V4 lower case saved';
  exception when check_violation then raise notice 'PASS V4 lower case refused'; end;
  begin
    update public.buses set owner_name = ' S KUMAR' where id = '00000000-0000-0000-0000-000000028b01';
    raise exception 'FAIL V5 owner with leading space saved';
  exception when check_violation then raise notice 'PASS V5 untrimmed owner refused'; end;
  begin
    update public.buses set owner_name = repeat('A', 121) where id = '00000000-0000-0000-0000-000000028b01';
    raise exception 'FAIL V6 121-character owner saved';
  exception when check_violation then raise notice 'PASS V6 long owner refused'; end;
end $$;

-- A manager reads them but cannot change them.
select pg_temp.act_as('00000000-0000-0000-0000-0000000028d1');
do $$ declare o text; n int; begin
  select owner_name into o from public.buses where id = '00000000-0000-0000-0000-000000028b01';
  if o is distinct from 'S KUMAR' then raise exception 'FAIL V7 manager reads owner %', o; end if;
  update public.buses set owner_name = 'R MURUGAN' where id = '00000000-0000-0000-0000-000000028b01';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL V8 manager changed the owner'; end if;
  raise notice 'PASS V7 manager reads owner; PASS V8 manager cannot change it';
end $$;

-- Another company's admin cannot see or change them.
select pg_temp.act_as('00000000-0000-0000-0000-0000000028b1');
do $$ declare n int; begin
  select count(*) into n from public.buses where id = '00000000-0000-0000-0000-000000028b01';
  if n <> 0 then raise exception 'FAIL V9 other company sees the bus'; end if;
  update public.buses set owner_name = 'X' where id = '00000000-0000-0000-0000-000000028b01';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL V10 other company changed the owner'; end if;
  raise notice 'PASS V9 and V10 other company is kept out';
end $$;

reset role;
\echo 'All database checks passed.'
rollback;
