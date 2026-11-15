-- Database checks for migration 0036. Runs inside one transaction and rolls
-- back, so it leaves no data behind. Run with scripts/test-db.sh against a
-- local or test database that has migrations 0001 to 0036 (never production).
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = notice;
begin;

create function pg_temp.act_as(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true),
         set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000036a1', 'admin@a36.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000036d1', 'omnimgr@a36.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000036c1', 'crew@a36.test', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000036b1', 'admin@b36.test', '{}', '{}');

insert into public.organizations (id, name, bus_types) values
  ('00000000-0000-0000-0000-00000000036a', 'Company A36', array['town', 'omni']),
  ('00000000-0000-0000-0000-00000000036b', 'Company B36', array['town']);

insert into public.buses (id, organization_id, registration_number, route_label, bus_type) values
  ('00000000-0000-0000-0000-000000360b01', '00000000-0000-0000-0000-00000000036a', 'TN 36 T 0001', 'Town 1', 'town'),
  ('00000000-0000-0000-0000-000000360b02', '00000000-0000-0000-0000-00000000036a', 'TN 36 T 0002', 'Town 2', 'town'),
  ('00000000-0000-0000-0000-000000360b03', '00000000-0000-0000-0000-00000000036a', 'TN 36 O 0003', 'Omni', 'omni');

insert into public.organization_members (organization_id, user_id, role, module) values
  ('00000000-0000-0000-0000-00000000036a', '00000000-0000-0000-0000-0000000036a1', 'admin', null),
  ('00000000-0000-0000-0000-00000000036a', '00000000-0000-0000-0000-0000000036d1', 'manager', 'omni'),
  ('00000000-0000-0000-0000-00000000036a', '00000000-0000-0000-0000-0000000036c1', 'crew', null),
  ('00000000-0000-0000-0000-00000000036b', '00000000-0000-0000-0000-0000000036b1', 'admin', null);

insert into public.crew_assignments (organization_id, user_id, bus_id) values
  ('00000000-0000-0000-0000-00000000036a', '00000000-0000-0000-0000-0000000036c1', '00000000-0000-0000-0000-000000360b01');
insert into public.crew_people (id, organization_id, name, job, module, active) values
  ('00000000-0000-0000-0000-000000360f01', '00000000-0000-0000-0000-00000000036a', 'Murugan', 'driver', 'town', true),
  ('00000000-0000-0000-0000-000000360f02', '00000000-0000-0000-0000-00000000036a', 'Arul', 'conductor', 'town', true),
  ('00000000-0000-0000-0000-000000360f03', '00000000-0000-0000-0000-00000000036a', 'Ravi', 'conductor', 'town', true),
  ('00000000-0000-0000-0000-000000360f04', '00000000-0000-0000-0000-00000000036a', 'Selvam', 'conductor', 'omni', true);

-- Bus 1 ran today with money; Arul started as conductor and Ravi relieved from trip 5.
insert into public.daily_entries (organization_id, bus_id, entry_date, kind, category, amount_inr) values
  ('00000000-0000-0000-0000-00000000036a', '00000000-0000-0000-0000-000000360b01', public.today_ist(), 'income', 'ticket_collection', 8000);
update public.crew_people set user_id = '00000000-0000-0000-0000-0000000036c1' where id = '00000000-0000-0000-0000-000000360f02';
insert into public.day_crew (organization_id, day, bus_id, duty, person_id) values
  ('00000000-0000-0000-0000-00000000036a', public.today_ist(), '00000000-0000-0000-0000-000000360b01', 'driver', '00000000-0000-0000-0000-000000360f01'),
  ('00000000-0000-0000-0000-00000000036a', public.today_ist(), '00000000-0000-0000-0000-000000360b01', 'conductor', '00000000-0000-0000-0000-000000360f02');
insert into public.day_crew_relief (organization_id, day, bus_id, duty, person_id, from_trip) values
  ('00000000-0000-0000-0000-00000000036a', public.today_ist(), '00000000-0000-0000-0000-000000360b01', 'conductor', '00000000-0000-0000-0000-000000360f03', 5);

set local role authenticated;
\pset tuples_only on

-- S1 the company has not turned the rule on: nothing blocks closing for settlements.
select pg_temp.act_as('00000000-0000-0000-0000-0000000036a1');
do $$ declare n int; begin
  select count(*) into n from public.day_close_blockers('00000000-0000-0000-0000-00000000036a', public.today_ist()) where code like 'settlement%';
  if n <> 0 then raise exception 'FAIL S1 % settlement blockers with the rule off', n; end if;
  raise notice 'PASS S1 rule off: no settlement blockers';
end $$;

-- S2 an admin turns the rule on, and both conductors are listed as not settled.
reset role;
update public.organizations set require_conductor_settlement = true where id = '00000000-0000-0000-0000-00000000036a';
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000036a1');
do $$ declare n int; begin
  select count(*) into n from public.day_close_blockers('00000000-0000-0000-0000-00000000036a', public.today_ist()) where code = 'settlement_missing';
  if n <> 2 then raise exception 'FAIL S2 % missing, expected 2 (starter and relief)', n; end if;
  if not exists (select 1 from public.day_close_blockers('00000000-0000-0000-0000-00000000036a', public.today_ist()) where detail = 'TN 36 T 0001: Ravi has not settled') then
    raise exception 'FAIL S2 detail text';
  end if;
  begin
    perform public.close_day('00000000-0000-0000-0000-00000000036a', public.today_ist());
    raise exception 'FAIL S2 day closed with conductors unsettled';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
    if sqlerrm not like '%Arul has not settled%' or sqlerrm not like '%Ravi has not settled%' then
      raise exception 'FAIL S2 message: %', sqlerrm;
    end if;
  end;
  raise notice 'PASS S2 close refused, naming each conductor';
end $$;

-- S3 the conductor enters their own settlement; the shortage is worked out; Ravi's is not theirs.
select pg_temp.act_as('00000000-0000-0000-0000-0000000036c1');
do $$ declare v_id uuid; v_short int; n int; begin
  v_id := public.save_conductor_settlement('00000000-0000-0000-0000-00000000036a', public.today_ist(), '00000000-0000-0000-0000-000000360b01', '00000000-0000-0000-0000-000000360f02', 5000, 4000, 700, 200, 'Short on tickets');
  select shortage_inr into v_short from public.conductor_settlements where id = v_id;
  if v_short <> 100 then raise exception 'FAIL S3 shortage %, expected 100', v_short; end if;
  begin
    perform public.save_conductor_settlement('00000000-0000-0000-0000-00000000036a', public.today_ist(), '00000000-0000-0000-0000-000000360b01', '00000000-0000-0000-0000-000000360f03', 3000, 3000, 0, 0);
    raise exception 'FAIL S3 conductor saved for another person';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  select count(*) into n from public.conductor_settlements;
  if n <> 1 then raise exception 'FAIL S3 conductor sees % rows, expected 1', n; end if;
  raise notice 'PASS S3 conductor enters and sees only their own';
end $$;

-- S4 the conductor cannot approve their own, and cannot read the day's money.
do $$ declare n int; begin
  begin
    update public.conductor_settlements set status = 'approved';
    raise exception 'FAIL S4 conductor approved';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  select count(*) into n from public.daily_entries;
  if n <> 0 then raise exception 'FAIL S4 conductor read % day book rows', n; end if;
  raise notice 'PASS S4 conductor cannot approve or see the day book';
end $$;

-- S5 while it is a draft the close list says it is waiting for approval.
select pg_temp.act_as('00000000-0000-0000-0000-0000000036a1');
do $$ begin
  if not exists (select 1 from public.day_close_blockers('00000000-0000-0000-0000-00000000036a', public.today_ist()) where code = 'settlement_pending' and detail like '%Arul''s settlement is waiting for approval%') then
    raise exception 'FAIL S5 pending blocker missing';
  end if;
  raise notice 'PASS S5 a draft is listed as waiting for approval';
end $$;

-- S6 an admin approves; recovery defaults to the shortage, in the next month.
do $$ declare r record; begin
  perform public.approve_conductor_settlement((select id from public.conductor_settlements where person_id = '00000000-0000-0000-0000-000000360f02'));
  select * into r from public.conductor_settlements where person_id = '00000000-0000-0000-0000-000000360f02';
  if r.status <> 'approved' or r.recover_inr <> 100 or r.approved_by is null then
    raise exception 'FAIL S6 got %, %, %', r.status, r.recover_inr, r.approved_by;
  end if;
  if r.recover_month <> (date_trunc('month', public.today_ist()) + interval '1 month')::date then
    raise exception 'FAIL S6 recover month %', r.recover_month;
  end if;
  raise notice 'PASS S6 approval stamps the approver and sets the recovery';
end $$;

-- S7 a recovery above the shortage is refused.
do $$ declare v_id uuid; begin
  v_id := public.save_conductor_settlement('00000000-0000-0000-0000-00000000036a', public.today_ist(), '00000000-0000-0000-0000-000000360b01', '00000000-0000-0000-0000-000000360f03', 3000, 2500, 0, 0, '');
  begin
    perform public.approve_conductor_settlement(v_id, 900);
    raise exception 'FAIL S7 recovery above the shortage accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform public.approve_conductor_settlement(v_id, 300);
  raise notice 'PASS S7 recovery is capped at the shortage';
end $$;

-- S8 the month's recoveries add up per person.
do $$ declare r record; begin
  select * into r from public.conductor_recoveries('00000000-0000-0000-0000-00000000036a', (date_trunc('month', public.today_ist()) + interval '1 month')::date) where person_id = '00000000-0000-0000-0000-000000360f03';
  if r.recover_inr <> 300 then raise exception 'FAIL S8 got %', r.recover_inr; end if;
  raise notice 'PASS S8 conductor_recoveries';
end $$;

-- S9 both settled: nothing blocks, and the day closes.
do $$ declare n int; begin
  select count(*) into n from public.day_close_blockers('00000000-0000-0000-0000-00000000036a', public.today_ist());
  if n <> 0 then raise exception 'FAIL S9 % blockers left', n; end if;
  perform public.close_day('00000000-0000-0000-0000-00000000036a', public.today_ist());
  raise notice 'PASS S9 day closes once everyone has settled';
end $$;

-- S10 an approved settlement stays frozen on a closed day, even for the admin.
do $$ begin
  begin
    update public.conductor_settlements set cash_inr = cash_inr + 1 where person_id = '00000000-0000-0000-0000-000000360f02';
    raise exception 'FAIL S10 closed day changed';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS S10 closed days freeze settlements';
end $$;

-- S11 the exception path: another day, a conductor who cannot settle is waived with a reason; a manager cannot waive.
select pg_temp.act_as('00000000-0000-0000-0000-0000000036a1');
do $$ begin
  insert into public.day_crew (organization_id, day, bus_id, duty, person_id) values
    ('00000000-0000-0000-0000-00000000036a', public.today_ist() - 1, '00000000-0000-0000-0000-000000360b02', 'driver', '00000000-0000-0000-0000-000000360f01'),
    ('00000000-0000-0000-0000-00000000036a', public.today_ist() - 1, '00000000-0000-0000-0000-000000360b02', 'conductor', '00000000-0000-0000-0000-000000360f03');
  insert into public.daily_entries (organization_id, bus_id, entry_date, kind, category, amount_inr)
  values ('00000000-0000-0000-0000-00000000036a', '00000000-0000-0000-0000-000000360b02', public.today_ist() - 1, 'income', 'ticket_collection', 1000);
  begin
    perform public.waive_conductor_settlement('00000000-0000-0000-0000-00000000036a', public.today_ist() - 1, '00000000-0000-0000-0000-000000360b02', '00000000-0000-0000-0000-000000360f03', '');
    raise exception 'FAIL S11 waived without a reason';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform public.waive_conductor_settlement('00000000-0000-0000-0000-00000000036a', public.today_ist() - 1, '00000000-0000-0000-0000-000000360b02', '00000000-0000-0000-0000-000000360f03', 'Absent, no collection');
  if exists (select 1 from public.day_close_blockers('00000000-0000-0000-0000-00000000036a', public.today_ist() - 1) where code like 'settlement%') then
    raise exception 'FAIL S11 waived settlement still blocks';
  end if;
  raise notice 'PASS S11 admin waives with a reason';
end $$;

-- S12 a conductor who was not on the bus that day cannot settle for it; wrong role is refused.
do $$ begin
  begin
    perform public.save_conductor_settlement('00000000-0000-0000-0000-00000000036a', public.today_ist() - 1, '00000000-0000-0000-0000-000000360b01', '00000000-0000-0000-0000-000000360f03', 100, 100, 0, 0);
    raise exception 'FAIL S12 settlement for a bus they were not on';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.save_conductor_settlement('00000000-0000-0000-0000-00000000036a', public.today_ist(), '00000000-0000-0000-0000-000000360b01', '00000000-0000-0000-0000-000000360f01', 100, 100, 0, 0);
    raise exception 'FAIL S12 a driver settled as a conductor';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'PASS S12 only conductors on the bus that day';
end $$;

-- S13 an Omni-only manager and another company see and change nothing.
select pg_temp.act_as('00000000-0000-0000-0000-0000000036d1');
do $$ declare n int; begin
  select count(*) into n from public.conductor_settlements;
  if n <> 0 then raise exception 'FAIL S13 Omni manager saw % settlements', n; end if;
  raise notice 'PASS S13 managers stay in their module';
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-0000000036b1');
do $$ declare n int; begin
  select count(*) into n from public.conductor_settlements;
  if n <> 0 then raise exception 'FAIL S13 outsider saw % settlements', n; end if;
  raise notice 'PASS S13 other companies see nothing';
end $$;

rollback;
