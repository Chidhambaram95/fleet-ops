-- Database checks for migration 0018. Runs inside one transaction and rolls
-- back, so it leaves no data behind. Run with scripts/test-db.sh against a
-- local or test database that has migrations 0001 to 0018 (never production).
\set ON_ERROR_STOP 1
\set QUIET 1
begin;

-- Acts as a signed-in user (both claim styles that auth.uid() reads).
create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- ---------------------------------------------------------------------------
-- Seed: company A with an admin, a second admin, a manager, an Omni-only
-- manager and two crew; company B with an admin; a login with no company.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@a.test', '{}', '{"display_name":"Admin A"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'admin2@a.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000000d1', 'manager@a.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000000d2', 'omni@a.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000000c1', 'crew1@a.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000000c2', 'crew2@a.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000000b1', 'admin@b.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000000e1', 'loose@x.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000000e2', 'p919876543210@phone.fleetops.invalid', '{"fleetops_org":"00000000-0000-0000-0000-00000000000a"}', '{}'),
  ('00000000-0000-0000-0000-0000000000e3', 'madeforb@x.test', '{"fleetops_org":"00000000-0000-0000-0000-00000000000b"}', '{}');

insert into public.organizations (id, name, bus_types) values
  ('00000000-0000-0000-0000-00000000000a', 'Company A', array['town', 'omni', 'tour']),
  ('00000000-0000-0000-0000-00000000000b', 'Company B', array['town']);

insert into public.buses (id, organization_id, registration_number, route_label, bus_type) values
  ('00000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-00000000000a', 'TN 01 T 0001', 'Town', 'town'),
  ('00000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-00000000000a', 'TN 01 O 0002', 'Omni', 'omni'),
  ('00000000-0000-0000-0000-000000000b03', '00000000-0000-0000-0000-00000000000a', 'TN 01 R 0003', 'Tour', 'tour'),
  ('00000000-0000-0000-0000-000000000b09', '00000000-0000-0000-0000-00000000000b', 'TN 09 B 0009', 'B', 'town');

insert into public.organization_members (organization_id, user_id, role, module) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1', 'admin', null),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'admin', null),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000d1', 'manager', null),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000d2', 'manager', 'omni'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'crew', null),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c2', 'crew', null),
  ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000b1', 'admin', null);

insert into public.crew_assignments (organization_id, user_id, bus_id) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000b01'),
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-000000000b01');

-- Old cash entries (5 days ago) on the town and omni buses.
insert into public.daily_entries (id, organization_id, bus_id, entry_date, kind, category, amount_inr) values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000b01', public.today_ist() - 5, 'income', 'ticket_collection', 1000),
  ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000b02', public.today_ist() - 5, 'income', 'ticket_collection', 2000);

-- An approved omni trip, approved 5 days ago.
insert into public.trips (id, organization_id, bus_id, sheet_no, advance_inr) values
  ('00000000-0000-0000-0000-00000000f001', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000b02', '501', 5000);
insert into public.trip_items (organization_id, trip_id, kind, category, amount_inr) values
  ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000f001', 'expense', 'toll', 500);
update public.trips set status = 'approved', approved_at = now() - interval '5 days'
where id = '00000000-0000-0000-0000-00000000f001';

set local role authenticated;
\pset tuples_only on

-- ---------------------------------------------------------------------------
-- R5: admins change only role and module
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
do $$ begin
  begin
    update public.organization_members set user_id = '00000000-0000-0000-0000-0000000000e1'
    where user_id = '00000000-0000-0000-0000-0000000000d1';
    raise exception 'FAIL R5-1 admin changed a member''s login';
  exception when insufficient_privilege then raise notice 'PASS R5-1 admin cannot change a member''s login';
  end;
end $$;
do $$ begin
  update public.organization_members set role = 'manager'
  where user_id = '00000000-0000-0000-0000-0000000000c2' and organization_id = '00000000-0000-0000-0000-00000000000a';
  raise notice 'PASS R5-2 admin can still change a role';
end $$;
update public.organization_members set role = 'crew'
where user_id = '00000000-0000-0000-0000-0000000000c2' and organization_id = '00000000-0000-0000-0000-00000000000a';

-- ---------------------------------------------------------------------------
-- R4: no plain insert of members; direct add only for logins made for the company
-- ---------------------------------------------------------------------------
do $$ begin
  begin
    insert into public.organization_members (organization_id, user_id, role)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000e1', 'manager');
    raise exception 'FAIL R4-1 plain member insert worked';
  exception when insufficient_privilege then raise notice 'PASS R4-1 plain member insert refused';
  end;
end $$;
do $$ begin
  begin
    perform public.add_member_direct('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000e1', 'manager', null, 'Loose');
    raise exception 'FAIL R4-2 added a login not made for the company';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS R4-2 refused: %', sqlerrm;
  end;
end $$;
do $$ begin
  begin
    perform public.add_member_direct('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000e3', 'manager', null, 'Made for B');
    raise exception 'FAIL R4-3 added another company''s login';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS R4-3 refused: %', sqlerrm;
  end;
end $$;
do $$ begin
  begin
    perform public.add_member_direct('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000e2', 'crew', null, 'Phone Crew');
    raise exception 'FAIL R4-4 crew added without a bus';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS R4-4 refused: %', sqlerrm;
  end;
end $$;
do $$ begin
  perform public.add_member_direct('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000e2', 'crew', '00000000-0000-0000-0000-000000000b01', 'Phone Crew');
  if not exists (
    select 1 from public.crew_assignments where user_id = '00000000-0000-0000-0000-0000000000e2'
  ) then
    raise exception 'FAIL R4-5 crew added but no bus assignment';
  end if;
  raise notice 'PASS R4-5 phone-login crew added with their bus';
end $$;
do $$ begin
  begin
    perform public.add_member_direct('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000e2', 'manager', null, 'Again');
    raise exception 'FAIL R4-6 added twice';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS R4-6 refused: %', sqlerrm;
  end;
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
do $$ begin
  begin
    perform public.add_member_direct('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000e2', 'crew', '00000000-0000-0000-0000-000000000b01', 'x');
    raise exception 'FAIL R4-7 manager added someone';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS R4-7 manager refused: %', sqlerrm;
  end;
end $$;

-- Password reset rights
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
do $$ begin
  if not public.can_set_member_password('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1') then
    raise exception 'FAIL R23-1 admin cannot set crew password';
  end if;
  if public.can_set_member_password('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2') then
    raise exception 'FAIL R23-2 admin can set another admin''s password';
  end if;
  if public.can_set_member_password('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b1') then
    raise exception 'FAIL R23-3 admin can set another company''s password';
  end if;
  raise notice 'PASS R23 admin sets passwords only for their own managers and crew';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
do $$ begin
  if public.can_set_member_password('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1') then
    raise exception 'FAIL R23-4 manager can set passwords';
  end if;
  raise notice 'PASS R23-4 manager cannot set passwords';
end $$;

-- ---------------------------------------------------------------------------
-- R2: an Omni-only manager is limited in the database
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d2');
do $$
declare n integer;
begin
  select count(*) into n from public.buses;
  if n <> 1 then raise exception 'FAIL R2-1 omni manager sees % buses', n; end if;
  select count(*) into n from public.daily_entries;
  if n <> 1 then raise exception 'FAIL R2-2 omni manager sees % entries', n; end if;
  raise notice 'PASS R2-1 omni manager sees only the omni bus and its entries';
end $$;
do $$ begin
  begin
    insert into public.daily_entries (organization_id, bus_id, entry_date, kind, category, amount_inr, created_by)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000b01', public.today_ist(), 'income', 'ticket_collection', 10, auth.uid());
    raise exception 'FAIL R2-3 omni manager wrote a town entry';
  exception when insufficient_privilege then raise notice 'PASS R2-3 town entry refused for omni manager';
  end;
end $$;
do $$ begin
  insert into public.daily_entries (organization_id, bus_id, entry_date, kind, category, amount_inr, created_by)
  values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000b02', public.today_ist(), 'income', 'ticket_collection', 10, auth.uid());
  raise notice 'PASS R2-4 omni manager writes omni entries';
end $$;
do $$ begin
  begin
    insert into public.tour_bookings (organization_id, customer_name, start_date, end_date)
    values ('00000000-0000-0000-0000-00000000000a', 'X', public.today_ist(), public.today_ist());
    raise exception 'FAIL R2-5 omni manager wrote a tour booking';
  exception when insufficient_privilege then raise notice 'PASS R2-5 tour booking refused for omni manager';
  end;
end $$;
do $$ begin
  begin
    insert into public.company_expenses (organization_id, spent_on, category, amount_inr)
    values ('00000000-0000-0000-0000-00000000000a', public.today_ist(), 'office', 100);
    raise exception 'FAIL R2-6 omni manager wrote a company cost';
  exception when insufficient_privilege then raise notice 'PASS R2-6 company cost refused for omni manager';
  end;
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
do $$
declare n integer;
begin
  select count(*) into n from public.buses;
  if n <> 3 then raise exception 'FAIL R2-7 unlimited manager sees % buses', n; end if;
  raise notice 'PASS R2-7 unlimited manager sees every bus';
end $$;

-- ---------------------------------------------------------------------------
-- U2: frozen days
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
-- Since 0022 crew can't change entries at all, so the update finds no row.
do $$ declare n int; begin
  begin
    update public.daily_entries set amount_inr = 1 where id = '00000000-0000-0000-0000-00000000e001';
    get diagnostics n = row_count;
    if n > 0 then raise exception 'FAIL U2-1 crew changed a 5-day-old entry'; end if;
    raise notice 'PASS U2-1 crew cannot change an old entry';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS U2-1 old day frozen for crew: %', sqlerrm;
  end;
end $$;
do $$ begin
  insert into public.daily_entries (organization_id, bus_id, entry_date, kind, category, amount_inr, created_by)
  values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000b01', public.today_ist() - 3, 'expense', 'diesel', 300, auth.uid());
  raise notice 'PASS U2-2 3 days ago is still open';
end $$;
do $$ begin
  begin
    perform public.open_for_edit('00000000-0000-0000-0000-00000000000a', public.today_ist() - 5, null, 'crew wants to edit');
    raise exception 'FAIL U2-3 crew opened a frozen day';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS U2-3 crew cannot open a frozen day';
  end;
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
do $$ begin
  begin
    delete from public.daily_entries where id = '00000000-0000-0000-0000-00000000e001';
    raise exception 'FAIL U2-4 manager deleted a frozen entry without a comment';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS U2-4 frozen delete refused without a comment';
  end;
end $$;
do $$ begin
  begin
    perform public.open_for_edit('00000000-0000-0000-0000-00000000000a', public.today_ist() - 5, null, ' ');
    raise exception 'FAIL U2-5 opened without a comment';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS U2-5 a comment is required';
  end;
end $$;
do $$ begin
  perform public.open_for_edit('00000000-0000-0000-0000-00000000000a', public.today_ist() - 5, null, 'Wrong amount typed');
  update public.daily_entries set amount_inr = 1100 where id = '00000000-0000-0000-0000-00000000e001';
  if not exists (
    select 1 from public.audit_log
    where row_id = '00000000-0000-0000-0000-00000000e001' and action = 'update' and reason = 'Wrong amount typed'
  ) then
    raise exception 'FAIL U2-6 change not recorded with the comment';
  end if;
  raise notice 'PASS U2-6 manager edits a frozen day with a comment; history keeps it';
end $$;
do $$ begin
  perform public.close_day('00000000-0000-0000-0000-00000000000a', public.today_ist());
  begin
    insert into public.daily_entries (organization_id, bus_id, entry_date, kind, category, amount_inr, created_by)
    values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000b01', public.today_ist(), 'income', 'parcel', 50, auth.uid());
    raise exception 'FAIL U2-7 entry added to a closed day';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS U2-7 closed day refuses new entries';
  end;
end $$;
do $$
declare s record;
begin
  select * into s from public.day_lock_status('00000000-0000-0000-0000-00000000000a', public.today_ist());
  if not (s.frozen and s.closed) then raise exception 'FAIL U2-8 day status %', s; end if;
  raise notice 'PASS U2-8 day status says closed';
end $$;

-- Trip sheets freeze 3 days after approval; settling the advance still works.
do $$ begin
  begin
    perform public.save_trip(
      jsonb_build_object('id', '00000000-0000-0000-0000-00000000f001', 'organization_id', '00000000-0000-0000-0000-00000000000a',
        'bus_id', '00000000-0000-0000-0000-000000000b02', 'sheet_no', '501', 'advance_inr', 5000),
      '[{"kind":"expense","category":"toll","amount_inr":600}]'::jsonb, false);
    raise exception 'FAIL U2-9 frozen trip changed';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS U2-9 old approved trip is frozen: %', sqlerrm;
  end;
end $$;
do $$ begin
  update public.trips set settled_on = public.today_ist() where id = '00000000-0000-0000-0000-00000000f001';
  raise notice 'PASS U2-10 settling a frozen trip''s advance still works';
end $$;

-- An admin opens the trip sheet with a comment and corrects it: one history row with the lines.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
do $$ begin
  begin
    perform public.save_trip(
      jsonb_build_object('id', '00000000-0000-0000-0000-00000000f001', 'organization_id', '00000000-0000-0000-0000-00000000000a',
        'bus_id', '00000000-0000-0000-0000-000000000b02', 'sheet_no', '501', 'advance_inr', 5000),
      '[{"kind":"expense","category":"toll","amount_inr":600}]'::jsonb, false);
    raise exception 'FAIL U2-10b admin changed a frozen trip without a comment';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS U2-10b frozen for the admin too: %', sqlerrm;
  end;
end $$;
do $$
declare v jsonb;
begin
  perform public.open_for_edit('00000000-0000-0000-0000-00000000000a', null, '00000000-0000-0000-0000-00000000f001', 'Toll receipt found');
  perform public.save_trip(
    jsonb_build_object('id', '00000000-0000-0000-0000-00000000f001', 'organization_id', '00000000-0000-0000-0000-00000000000a',
      'bus_id', '00000000-0000-0000-0000-000000000b02', 'sheet_no', '501', 'advance_inr', 5000),
    '[{"kind":"expense","category":"toll","amount_inr":600}]'::jsonb, false);
  select new_data into v from public.audit_log
  where row_id = '00000000-0000-0000-0000-00000000f001' and action = 'update' and reason = 'Toll receipt found';
  if v is null or (v -> 'items' -> 0 ->> 'amount_inr') <> '600' then
    raise exception 'FAIL U2-11 trip history %', v;
  end if;
  raise notice 'PASS U2-11 admin corrects a frozen trip with a comment; history has the lines';
end $$;

-- ---------------------------------------------------------------------------
-- R12: change history
-- ---------------------------------------------------------------------------
do $$
declare n integer;
begin
  select count(*) into n from public.audit_log where table_name = 'daily_entries';
  if n < 3 then raise exception 'FAIL R12-1 only % entry history rows', n; end if;
  raise notice 'PASS R12-1 entry inserts and edits are recorded (% rows)', n;
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
do $$
declare n integer;
begin
  select count(*) into n from public.audit_log;
  if n <> 0 then raise exception 'FAIL R12-2 crew read % history rows', n; end if;
  raise notice 'PASS R12-2 crew cannot read history';
end $$;
do $$ begin
  begin
    delete from public.audit_log;
    raise exception 'FAIL R12-3 history could be deleted';
  exception when insufficient_privilege then raise notice 'PASS R12-3 history cannot be deleted';
  end;
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d2');
do $$
declare n integer;
begin
  select count(*) into n from public.audit_log where coalesce(module, '') <> 'omni';
  if n <> 0 then raise exception 'FAIL R12-4 omni manager read % other history rows', n; end if;
  raise notice 'PASS R12-4 omni manager reads only omni history';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
do $$
declare n integer;
begin
  select count(*) into n from public.audit_log;
  if n <> 0 then raise exception 'FAIL R12-5 company B read % rows of A', n; end if;
  raise notice 'PASS R12-5 another company cannot read the history';
end $$;

-- ---------------------------------------------------------------------------
-- R1: removing people
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
do $$ begin
  begin
    perform public.remove_member('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2');
    raise exception 'FAIL R1-1 admin removed an admin';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS R1-1 refused: %', sqlerrm;
  end;
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
do $$ begin
  begin
    perform public.remove_member('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000d2');
    raise exception 'FAIL R1-2 manager removed a manager';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS R1-2 refused: %', sqlerrm;
  end;
  perform public.remove_member('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c2');
  raise notice 'PASS R1-3 manager removes crew';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d2');
do $$ begin
  begin
    perform public.remove_member('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1');
    raise exception 'FAIL R1-4 omni manager removed town crew';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS R1-4 refused: %', sqlerrm;
  end;
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
do $$ begin
  perform public.remove_member('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000c1');
  if exists (select 1 from public.crew_assignments where user_id = '00000000-0000-0000-0000-0000000000c1') then
    raise exception 'FAIL R1-5 bus assignment left behind';
  end if;
  if not exists (select 1 from public.daily_entries where created_by = '00000000-0000-0000-0000-0000000000c1') then
    raise exception 'FAIL R1-6 removed person''s entries were lost';
  end if;
  raise notice 'PASS R1-5 admin removes crew; their entries stay';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
do $$
declare n integer;
begin
  select count(*) into n from public.daily_entries;
  if n <> 0 then raise exception 'FAIL R1-7 removed crew still read % entries', n; end if;
  raise notice 'PASS R1-7 removed crew lose access at once';
end $$;

-- ---------------------------------------------------------------------------
-- Deleting a bus with frozen entries still works (its history stays).
-- ---------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
do $$ begin
  delete from public.buses where id = '00000000-0000-0000-0000-000000000b01';
  raise notice 'PASS BUS-1 a bus with frozen entries can still be deleted';
end $$;

reset role;
\echo 'All database checks passed.'
rollback;
