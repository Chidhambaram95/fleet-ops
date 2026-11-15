-- Database checks for migration 0029. Runs inside one transaction and rolls
-- back, so it leaves no data behind. Run with scripts/test-db.sh against a
-- local or test database that has migrations 0001 to 0029 (never production).
\set ON_ERROR_STOP 1
\set QUIET 1
begin;

-- Acts as a signed-in user (both claim styles that auth.uid() reads).
create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- P1 anon can run get_invite and nothing else in public.
do $$ declare v text; begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.proname) into v
  from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and has_function_privilege('anon', p.oid, 'execute')
    and p.proname <> 'get_invite';
  if v is not null then raise exception 'FAIL P1 anon can run: %', v; end if;
  if not has_function_privilege('anon', 'public.get_invite(text)', 'execute') then
    raise exception 'FAIL P1 anon cannot run get_invite';
  end if;
  raise notice 'PASS P1 anon can run get_invite only';
end $$;

-- P2 internal helpers and trigger functions cannot be called by signed-in users.
do $$ declare v text; begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.proname) into v
  from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and has_function_privilege('authenticated', p.oid, 'execute')
    and (
      p.prorettype = 'trigger'::regtype
      or p.proname in ('tyre_rebuild', 'freeze_key', 'row_is_locked', 'row_module', 'login_lookup')
    );
  if v is not null then raise exception 'FAIL P2 signed-in users can run: %', v; end if;
  raise notice 'PASS P2 internal and trigger functions are closed to signed-in users';
end $$;

-- P3 a security definer function that signed-in users can call must check
-- who is calling, or be one of the small read-only helpers the row rules use.
do $$ declare v text; begin
  select string_agg(p.proname, ', ' order by p.proname) into v
  from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef
    and has_function_privilege('authenticated', p.oid, 'execute')
    and p.prosrc !~* 'auth\.uid|is_org_member|is_super_admin|get_user_role|is_trip_editor|my_module'
    and p.proname not in (
      -- Read one small fact for the row rules; they return no row data.
      'bus_module', 'person_module', 'trip_module', 'loan_bus_ids', 'is_day_frozen',
      'bus_latest_odometer',
      -- Checks its own token.
      'get_invite'
    );
  if v is not null then raise exception 'FAIL P3 no caller check in: %', v; end if;
  raise notice 'PASS P3 every callable security definer function checks its caller';
end $$;

-- P4 the development helper is gone.
do $$ begin
  if exists (
    select 1 from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'ensure_personal_organization'
  ) then raise exception 'FAIL P4 ensure_personal_organization still exists'; end if;
  raise notice 'PASS P4 ensure_personal_organization is gone';
end $$;

-- P5 every table in public has row level security switched on.
do $$ declare v text; begin
  select string_agg(c.relname, ', ' order by c.relname) into v
  from pg_class as c join pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  if v is not null then raise exception 'FAIL P5 no row level security on: %', v; end if;
  raise notice 'PASS P5 every table has row level security';
end $$;

-- Company A: an admin with an omni bus and a trip. Company B: an admin.
-- A third login belongs to no company.
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000029a1', 'admin@a29.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000029b1', 'admin@b29.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000029c1', 'nobody@c29.test', '{}', '{}');

insert into public.organizations (id, name, bus_types) values
  ('00000000-0000-0000-0000-00000000029a', 'Company A29', array['omni']),
  ('00000000-0000-0000-0000-00000000029b', 'Company B29', array['omni']);

insert into public.buses (id, organization_id, registration_number, route_label, bus_type) values
  ('00000000-0000-0000-0000-000000029b01', '00000000-0000-0000-0000-00000000029a', 'TN 29 A 0001', 'A', 'omni');

insert into public.organization_members (organization_id, user_id, role, module) values
  ('00000000-0000-0000-0000-00000000029a', '00000000-0000-0000-0000-0000000029a1', 'admin', null),
  ('00000000-0000-0000-0000-00000000029b', '00000000-0000-0000-0000-0000000029b1', 'admin', null);

set local role authenticated;
\pset tuples_only on

-- P6 an admin saves a trip sheet: one history row for the new sheet, one for the change.
select pg_temp.act_as('00000000-0000-0000-0000-0000000029a1');
select set_config('t29.trip', public.save_trip(
  jsonb_build_object(
    'organization_id', '00000000-0000-0000-0000-00000000029a',
    'bus_id', '00000000-0000-0000-0000-000000029b01',
    'route', 'Chennai - Madurai'
  ),
  '[{"kind": "expense", "category": "toll", "amount_inr": 100}]'::jsonb,
  false
)::text, true) \g /dev/null
select public.save_trip(
  jsonb_build_object(
    'id', current_setting('t29.trip'),
    'organization_id', '00000000-0000-0000-0000-00000000029a',
    'bus_id', '00000000-0000-0000-0000-000000029b01',
    'route', 'Chennai - Trichy'
  ),
  '[{"kind": "expense", "category": "toll", "amount_inr": 150}]'::jsonb,
  false
) \g /dev/null
do $$ declare n int; begin
  select count(*) into n from public.audit_log
  where table_name = 'trips' and row_id = current_setting('t29.trip')::uuid;
  if n <> 2 then raise exception 'FAIL P6 expected 2 history rows for the trip, found %', n; end if;
  raise notice 'PASS P6 save_trip still writes its history';
end $$;

-- P7 the admin reads their own trip sheet snapshot.
do $$ begin
  if public.trip_snapshot(current_setting('t29.trip')::uuid) is null then
    raise exception 'FAIL P7 own trip snapshot is empty';
  end if;
  raise notice 'PASS P7 an admin reads their own trip snapshot';
end $$;

-- P8 an admin cannot write a history row by hand for another table.
do $$ begin
  begin
    perform public.write_history(
      'daily_entries', 'delete',
      jsonb_build_object('organization_id', '00000000-0000-0000-0000-00000000029a'), null
    );
    raise exception 'FAIL P8 hand-written history row saved';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS P8 a hand-written history row is refused';
  end;
end $$;

-- P9 another company's admin gets nothing from the snapshot, and cannot
-- write history into company A.
select pg_temp.act_as('00000000-0000-0000-0000-0000000029b1');
do $$ begin
  if public.trip_snapshot(current_setting('t29.trip')::uuid) is not null then
    raise exception 'FAIL P9 another company read the trip snapshot';
  end if;
  begin
    perform public.write_history(
      'trips', 'update', null,
      jsonb_build_object('organization_id', '00000000-0000-0000-0000-00000000029a')
    );
    raise exception 'FAIL P9 another company wrote history';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS P9 another company cannot read the snapshot or write history';
end $$;

-- P10 a login with no company gets nothing either.
select pg_temp.act_as('00000000-0000-0000-0000-0000000029c1');
do $$ begin
  if public.trip_snapshot(current_setting('t29.trip')::uuid) is not null then
    raise exception 'FAIL P10 a login with no company read the trip snapshot';
  end if;
  begin
    perform public.tyre_rebuild(gen_random_uuid());
    raise exception 'FAIL P10 tyre_rebuild ran';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS P10 a login with no company is refused';
end $$;

-- P11 signed out: get_invite answers, everything else is refused.
reset role;
set local role anon;
select pg_temp.act_as(null);
do $$ begin
  if (public.get_invite('no-such-token') ->> 'valid')::boolean then
    raise exception 'FAIL P11 unknown invite reads as valid';
  end if;
  begin
    perform public.trip_snapshot(current_setting('t29.trip')::uuid);
    raise exception 'FAIL P11 anon ran trip_snapshot';
  exception when insufficient_privilege then null; end;
  begin
    perform public.write_history('trips', 'insert', null, '{}'::jsonb);
    raise exception 'FAIL P11 anon ran write_history';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS P11 signed out: get_invite only';
end $$;

reset role;
rollback;
