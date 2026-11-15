-- Database checks for migration 0034. Runs inside one transaction and rolls
-- back, so it leaves no data behind. Run with scripts/test-db.sh against a
-- local or test database that has migrations 0001 to 0034 (never production).
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = notice;
begin;

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000034a1', 'admin@a34.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000034d1', 'omnimgr@a34.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000034c1', 'crew@a34.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000034b1', 'admin@b34.test', '{}', '{}');

insert into public.organizations (id, name, bus_types) values
  ('00000000-0000-0000-0000-00000000034a', 'Company A34', array['town', 'omni']),
  ('00000000-0000-0000-0000-00000000034b', 'Company B34', array['town']);

insert into public.buses (id, organization_id, registration_number, route_label, bus_type) values
  ('00000000-0000-0000-0000-000000340b01', '00000000-0000-0000-0000-00000000034a', 'TN 34 T 0001', 'Town 1', 'town'),
  ('00000000-0000-0000-0000-000000340b02', '00000000-0000-0000-0000-00000000034a', 'TN 34 T 0002', 'Town 2', 'town'),
  ('00000000-0000-0000-0000-000000340b03', '00000000-0000-0000-0000-00000000034a', 'TN 34 O 0003', 'Omni', 'omni');

insert into public.organization_members (organization_id, user_id, role, module) values
  ('00000000-0000-0000-0000-00000000034a', '00000000-0000-0000-0000-0000000034a1', 'admin', null),
  ('00000000-0000-0000-0000-00000000034a', '00000000-0000-0000-0000-0000000034d1', 'manager', 'omni'),
  ('00000000-0000-0000-0000-00000000034a', '00000000-0000-0000-0000-0000000034c1', 'crew', null),
  ('00000000-0000-0000-0000-00000000034b', '00000000-0000-0000-0000-0000000034b1', 'admin', null);

insert into public.crew_assignments (organization_id, user_id, bus_id) values
  ('00000000-0000-0000-0000-00000000034a', '00000000-0000-0000-0000-0000000034c1', '00000000-0000-0000-0000-000000340b01');
insert into public.crew_people (id, organization_id, name, job, module, active) values
  ('00000000-0000-0000-0000-000000340f01', '00000000-0000-0000-0000-00000000034a', 'Murugan', 'driver', 'town', true),
  ('00000000-0000-0000-0000-000000340f02', '00000000-0000-0000-0000-00000000034a', 'Arul', 'conductor', 'town', true),
  ('00000000-0000-0000-0000-000000340f03', '00000000-0000-0000-0000-00000000034a', 'Ravi', 'conductor', 'town', true),
  ('00000000-0000-0000-0000-000000340f04', '00000000-0000-0000-0000-00000000034a', 'Selvam', 'conductor', 'omni', true);

set local role authenticated;
\pset tuples_only on

select pg_temp.act_as('00000000-0000-0000-0000-0000000034a1');
do $$ begin
  -- L1 an admin links the conductor to the crew login.
  update public.crew_people set user_id = '00000000-0000-0000-0000-0000000034c1' where id = '00000000-0000-0000-0000-000000340f02';
  if public.my_crew_person('00000000-0000-0000-0000-00000000034a') is not null then raise exception 'FAIL L1 admin is not a crew person'; end if;
  raise notice 'PASS L1 admin links a login';

  -- L2 the same login cannot belong to a second person.
  begin
    update public.crew_people set user_id = '00000000-0000-0000-0000-0000000034c1' where id = '00000000-0000-0000-0000-000000340f03';
    raise exception 'FAIL L2 one login linked to two people';
  exception when unique_violation then null;
  end;
  raise notice 'PASS L2 one login, one person';

  -- L3 a login from another company is refused.
  begin
    update public.crew_people set user_id = '00000000-0000-0000-0000-0000000034b1' where id = '00000000-0000-0000-0000-000000340f03';
    raise exception 'FAIL L3 outside login linked';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS L3 login must be a member of the company';
end $$;

-- L4 the linked login finds its own person, and can read only that row.
select pg_temp.act_as('00000000-0000-0000-0000-0000000034c1');
do $$ declare n int; begin
  if public.my_crew_person('00000000-0000-0000-0000-00000000034a') is distinct from '00000000-0000-0000-0000-000000340f02'::uuid then raise exception 'FAIL L4 wrong person'; end if;
  select count(*) into n from public.crew_people;
  if n <> 1 then raise exception 'FAIL L4 login read % crew rows, expected 1', n; end if;
  raise notice 'PASS L4 a linked login sees only itself';
end $$;

-- L5 a manager (Omni) cannot change a link; the linked login cannot either.
select pg_temp.act_as('00000000-0000-0000-0000-0000000034d1');
do $$ begin
  begin
    update public.crew_people set user_id = null where id = '00000000-0000-0000-0000-000000340f04';
    -- no change (already null) is fine; now try a real change on an Omni person
    update public.crew_people set user_id = '00000000-0000-0000-0000-0000000034d1' where id = '00000000-0000-0000-0000-000000340f04';
    raise exception 'FAIL L5 manager linked a login';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS L5 only an admin links logins';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000034c1');
do $$ begin
  begin
    update public.crew_people set user_id = null where id = '00000000-0000-0000-0000-000000340f02';
    raise exception 'FAIL L5 crew unlinked themselves';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  when others then null;
  end;
  raise notice 'PASS L5 crew cannot change their link';
end $$;

-- L6 an admin clears the link.
select pg_temp.act_as('00000000-0000-0000-0000-0000000034a1');
do $$ begin
  update public.crew_people set user_id = null where id = '00000000-0000-0000-0000-000000340f02';
  if exists (select 1 from public.crew_people where id = '00000000-0000-0000-0000-000000340f02' and user_id is not null) then
    raise exception 'FAIL L6 link not cleared';
  end if;
  raise notice 'PASS L6 admin clears a link';
end $$;

-- L7 another company's admin cannot link anyone here.
select pg_temp.act_as('00000000-0000-0000-0000-0000000034b1');
do $$ begin
  begin
    update public.crew_people set user_id = '00000000-0000-0000-0000-0000000034b1' where id = '00000000-0000-0000-0000-000000340f03';
    if found then raise exception 'FAIL L7 outsider changed a crew person'; end if;
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS L7 other companies refused';
end $$;

rollback;
