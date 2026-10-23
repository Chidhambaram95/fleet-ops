-- P0 "trust and control" release. Run after 0017_tyres. Safe to run more than once.
--
-- 1. Admins remove people; managers remove crew. An admin can't remove an admin.
-- 2. Admins add people directly (no invite): the app makes the login, this
--    database adds it to the company. The old open insert rule is dropped.
-- 3. Company admins can change only a member's role and module.
-- 4. Change history for every money record, kept for one year.
-- 5. Days older than 3 days freeze (Town and Omni); admins and managers can
--    close a day early, and open a frozen day or trip sheet for 30 minutes
--    with a comment.
-- 6. A manager limited to one module is limited in the database too.

-- ---------------------------------------------------------------------------
-- Member rows
-- ---------------------------------------------------------------------------

revoke update on public.organization_members from authenticated;
grant update (role, module) on public.organization_members to authenticated;

-- People join through an invite or add_member_direct, never a plain insert.
drop policy if exists "Admins insert organization members" on public.organization_members;

-- Removes a person from the company. Their past records stay.
create or replace function public.remove_member(p_org uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mine text;
  v_theirs text;
  v_module text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if p_user = auth.uid() then
    raise exception 'You cannot remove yourself.';
  end if;

  select role into v_theirs
  from public.organization_members
  where organization_id = p_org and user_id = p_user;
  if v_theirs is null then
    raise exception 'That person is not in this company.';
  end if;

  v_mine := public.get_user_role(p_org);
  if v_mine in ('owner', 'admin') then
    if v_theirs in ('owner', 'admin') then
      raise exception 'An admin cannot remove another admin. Contact Fleet Ops.';
    end if;
  elsif v_mine in ('manager', 'fleet_manager', 'member') then
    if v_theirs <> 'crew' then
      raise exception 'Managers can remove crew only.';
    end if;
    -- A manager limited to one module removes only crew of that module's buses.
    select m.module into v_module
    from public.organization_members as m
    where m.organization_id = p_org and m.user_id = auth.uid();
    if v_module is not null and exists (
      select 1
      from public.crew_assignments as a
      join public.buses as b on b.id = a.bus_id
      where a.organization_id = p_org and a.user_id = p_user and b.bus_type <> v_module
    ) then
      raise exception 'That person works on another bus type.';
    end if;
  else
    raise exception 'Only an admin or manager can remove people.';
  end if;

  delete from public.crew_assignments where organization_id = p_org and user_id = p_user;
  delete from public.organization_members where organization_id = p_org and user_id = p_user;
end;
$$;

revoke all on function public.remove_member(uuid, uuid) from public;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

-- Adds a login the Fleet Ops server just made for this company. The server
-- stamps the company id in the login's app_metadata, which users can't edit,
-- so an admin can only add logins made for their own company.
create or replace function public.add_member_direct(
  p_org uuid,
  p_user uuid,
  p_role text,
  p_bus uuid,
  p_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if not (
    public.is_super_admin()
    or public.get_user_role(p_org) in ('owner', 'admin')
  ) then
    raise exception 'Only an admin can add people.';
  end if;
  if not public.org_in_good_standing(p_org) then
    raise exception 'The app is view-only until the payment is received.';
  end if;
  if p_role not in ('admin', 'manager', 'crew') then
    raise exception 'Choose a valid role.';
  end if;
  if not exists (
    select 1 from auth.users as u
    where u.id = p_user and u.raw_app_meta_data ->> 'fleetops_org' = p_org::text
  ) then
    raise exception 'That login was not made for this company.';
  end if;
  if exists (select 1 from public.organization_members where user_id = p_user) then
    raise exception 'This login already belongs to a company.';
  end if;
  if p_role = 'crew' and (
    p_bus is null
    or not exists (select 1 from public.buses where id = p_bus and organization_id = p_org)
  ) then
    raise exception 'Choose a vehicle for this crew member.';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (p_org, p_user, p_role);

  if p_role = 'crew' then
    insert into public.crew_assignments (organization_id, user_id, bus_id)
    values (p_org, p_user, p_bus);
  end if;

  if btrim(coalesce(p_name, '')) <> '' then
    insert into public.profiles (id, display_name)
    values (p_user, btrim(p_name))
    on conflict (id) do update set display_name = excluded.display_name;
  end if;
end;
$$;

revoke all on function public.add_member_direct(uuid, uuid, text, uuid, text) from public;
grant execute on function public.add_member_direct(uuid, uuid, text, uuid, text) to authenticated;

-- True when the caller may set a new password for this person: the super
-- admin for anyone, a company admin for their own managers and crew.
create or replace function public.can_set_member_password(p_org uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and p_user is distinct from auth.uid()
    and exists (
      select 1 from public.organization_members
      where organization_id = p_org and user_id = p_user
        and (public.is_super_admin() or role not in ('owner', 'admin'))
    )
    and (public.is_super_admin() or public.get_user_role(p_org) in ('owner', 'admin'));
$$;

revoke all on function public.can_set_member_password(uuid, uuid) from public;
grant execute on function public.can_set_member_password(uuid, uuid) to authenticated;

-- Each member's login (email, or the phone-number login), for the Team page.
create or replace function public.team_logins(p_org uuid)
returns table (user_id uuid, login text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    public.is_super_admin()
    or public.get_user_role(p_org) in ('owner', 'admin', 'manager', 'fleet_manager', 'member')
  ) then
    raise exception 'Only admins and managers can see logins.';
  end if;
  return query
  select m.user_id, coalesce(u.email::text, '')
  from public.organization_members as m
  left join auth.users as u on u.id = m.user_id
  where m.organization_id = p_org;
end;
$$;

revoke all on function public.team_logins(uuid) from public;
grant execute on function public.team_logins(uuid) to authenticated;

-- For the server (service role) only: the login with this email, the company
-- it belongs to, and whether it is a Fleet Ops super admin. A removed person
-- can be added back; a super admin's login is never handed to a company.
drop function if exists public.login_lookup(text);
create function public.login_lookup(p_email text)
returns table (user_id uuid, organization_id uuid, super_admin boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.id,
    m.organization_id,
    exists (select 1 from public.super_admins as s where s.user_id = u.id)
  from auth.users as u
  left join public.organization_members as m on m.user_id = u.id
  where lower(u.email) = lower(btrim(p_email))
  limit 1;
$$;

revoke all on function public.login_lookup(text) from public;
revoke all on function public.login_lookup(text) from anon, authenticated;
grant execute on function public.login_lookup(text) to service_role;

-- ---------------------------------------------------------------------------
-- Module helpers (a manager limited to one module)
-- ---------------------------------------------------------------------------

-- The caller's module limit in this company; null means every module.
create or replace function public.my_module(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.module
  from public.organization_members as m
  where m.organization_id = p_org
    and m.user_id = auth.uid()
    and m.role in ('manager', 'fleet_manager', 'member')
  limit 1;
$$;

create or replace function public.bus_module(p_bus uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select bus_type from public.buses where id = p_bus;
$$;

create or replace function public.trip_module(p_trip uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select b.bus_type
  from public.trips as t
  join public.buses as b on b.id = t.bus_id
  where t.id = p_trip;
$$;

create or replace function public.person_module(p_person uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select module from public.crew_people where id = p_person;
$$;

-- True when the caller may work with rows of this module.
create or replace function public.module_allows(p_org uuid, p_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.my_module(p_org) is null or public.my_module(p_org) = coalesce(p_module, '');
$$;

-- For rows that list several buses. any_bus: one of them is enough (reading);
-- otherwise every bus must be in the module and at least one listed (writing).
create or replace function public.module_allows_buses(p_org uuid, p_bus_ids uuid[], p_any_bus boolean)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.my_module(p_org) is null then true
    when p_any_bus then exists (
      select 1 from public.buses as b
      where b.id = any(p_bus_ids) and b.bus_type = public.my_module(p_org)
    )
    else cardinality(p_bus_ids) > 0 and not exists (
      select 1 from unnest(p_bus_ids) as x(id)
      where coalesce(public.bus_module(x.id), '') <> public.my_module(p_org)
    )
  end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'my_module(uuid)', 'bus_module(uuid)', 'trip_module(uuid)', 'person_module(uuid)',
    'module_allows(uuid, text)', 'module_allows_buses(uuid, uuid[], boolean)'
  ]
  loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;

-- One restrictive rule per table: rows outside the manager's module are hidden
-- and can't be written. Admins, crew and unlimited managers are not affected.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('buses', 'bus_type'),
      ('daily_entries', 'public.bus_module(bus_id)'),
      ('trips', 'public.bus_module(bus_id)'),
      ('trip_items', 'public.trip_module(trip_id)'),
      ('pump_statements', 'module'),
      ('pump_payments', 'module'),
      ('crew_people', 'module'),
      ('salary_payments', 'public.person_module(person_id)'),
      ('renewals', 'coalesce(public.bus_module(bus_id), public.person_module(person_id))'),
      ('tour_bookings', '''tour'''),
      ('tour_payments', '''tour''')
    ) as t(tbl, module_expr)
  loop
    execute format('drop policy if exists "Managers stay in their module" on public.%I', r.tbl);
    execute format(
      'create policy "Managers stay in their module" on public.%I as restrictive for all to authenticated
         using (public.module_allows(organization_id, %s))
         with check (public.module_allows(organization_id, %s))',
      r.tbl, r.module_expr, r.module_expr
    );
  end loop;
end;
$$;

-- Intercity lists several buses: seen when one is in the module, written only
-- when all are.
drop policy if exists "Managers stay in their module" on public.intercity_income;
create policy "Managers stay in their module"
  on public.intercity_income as restrictive
  for all
  to authenticated
  using (public.module_allows_buses(organization_id, bus_ids, true))
  with check (public.module_allows_buses(organization_id, bus_ids, false));

-- Company costs belong to the company area. A limited manager sees the shared
-- costs and costs of their buses (their reports need them), but can't change any.
drop policy if exists "Managers stay in their module" on public.company_expenses;
create policy "Managers stay in their module"
  on public.company_expenses as restrictive
  for all
  to authenticated
  using (
    public.my_module(organization_id) is null
    or cardinality(bus_ids) = 0
    or public.module_allows_buses(organization_id, bus_ids, true)
  )
  with check (public.my_module(organization_id) is null);

drop policy if exists "Managers stay in their module (delete)" on public.company_expenses;
create policy "Managers stay in their module (delete)"
  on public.company_expenses as restrictive
  for delete
  to authenticated
  using (public.my_module(organization_id) is null);

-- ---------------------------------------------------------------------------
-- Frozen days
-- ---------------------------------------------------------------------------

-- Days an admin or manager closed early.
create table if not exists public.closed_days (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  day date not null,
  closed_by uuid references auth.users (id) on delete set null default auth.uid(),
  closed_at timestamptz not null default now(),
  primary key (organization_id, day)
);

-- A frozen day (or one approved trip sheet) opened for a short while, with the reason.
create table if not exists public.edit_unlocks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  day date,
  trip_id uuid references public.trips (id) on delete cascade,
  reason text not null check (length(btrim(reason)) >= 3),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  constraint edit_unlocks_one_target check ((day is null) <> (trip_id is null))
);

create index if not exists edit_unlocks_lookup_idx
  on public.edit_unlocks (organization_id, user_id, expires_at desc);

alter table public.closed_days enable row level security;
alter table public.edit_unlocks enable row level security;
grant select on public.closed_days to authenticated;
grant select on public.edit_unlocks to authenticated;

drop policy if exists "Members read closed days" on public.closed_days;
create policy "Members read closed days"
  on public.closed_days for select to authenticated
  using (public.is_org_member(organization_id) or public.is_super_admin());

drop policy if exists "Admins and managers read unlocks" on public.edit_unlocks;
create policy "Admins and managers read unlocks"
  on public.edit_unlocks for select to authenticated
  using (public.is_trip_editor(organization_id) or public.is_super_admin());

-- Records stay editable for today and the 3 days before; older days freeze.
create or replace function public.is_day_frozen(p_org uuid, p_day date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_day is not null and (
    p_day < public.today_ist() - 3
    or exists (select 1 from public.closed_days where organization_id = p_org and day = p_day)
  );
$$;

-- The caller's open unlock for this day or trip sheet, if any: its reason.
create or replace function public.active_unlock_reason(p_org uuid, p_day date, p_trip uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.reason
  from public.edit_unlocks as u
  where u.organization_id = p_org
    and u.user_id = auth.uid()
    and u.expires_at > now()
    and ((p_day is not null and u.day = p_day) or (p_trip is not null and u.trip_id = p_trip))
  order by u.created_at desc
  limit 1;
$$;

-- The date (and trip sheet) that decides whether a row is frozen. Tour rows
-- never freeze. A trip sheet freezes 3 days after it was approved; a draft
-- never freezes.
create or replace function public.freeze_key(p_table text, p_row jsonb, out k_day date, out k_trip uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_trip public.trips;
begin
  if p_row is null then
    return;
  end if;
  case p_table
    when 'daily_entries' then
      if coalesce(public.bus_module((p_row ->> 'bus_id')::uuid), '') <> 'tour' then
        k_day := (p_row ->> 'entry_date')::date;
      end if;
    when 'trips', 'trip_items' then
      if p_table = 'trips' then
        v_trip := jsonb_populate_record(null::public.trips, p_row);
      else
        select * into v_trip from public.trips where id = (p_row ->> 'trip_id')::uuid;
      end if;
      if v_trip.status = 'approved'
        and v_trip.approved_at is not null
        and coalesce(public.bus_module(v_trip.bus_id), '') <> 'tour'
      then
        k_day := (v_trip.approved_at at time zone 'Asia/Kolkata')::date;
        k_trip := v_trip.id;
      end if;
    when 'pump_statements' then
      if p_row ->> 'module' <> 'tour' then k_day := (p_row ->> 'statement_on')::date; end if;
    when 'pump_payments' then
      if p_row ->> 'module' <> 'tour' then k_day := (p_row ->> 'paid_on')::date; end if;
    when 'company_expenses' then
      k_day := (p_row ->> 'spent_on')::date;
    when 'salary_payments' then
      k_day := (p_row ->> 'paid_on')::date;
    when 'intercity_income' then
      k_day := (p_row ->> 'received_on')::date;
    else
      null;
  end case;
end;
$$;

create or replace function public.row_is_locked(p_table text, p_org uuid, p_row jsonb)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_key record;
begin
  select * into v_key from public.freeze_key(p_table, p_row);
  if v_key.k_day is null or not public.is_day_frozen(p_org, v_key.k_day) then
    return false;
  end if;
  return public.active_unlock_reason(p_org, v_key.k_day, v_key.k_trip) is null;
end;
$$;

-- Refuses changes to frozen rows. Changes made by another change (a bus or
-- company being deleted), by the super admin, or from the SQL editor pass.
create or replace function public.guard_frozen_rows()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_org uuid;
  v_trip boolean := tg_table_name in ('trips', 'trip_items');
begin
  if pg_trigger_depth() > 1 or auth.uid() is null or public.is_super_admin() then
    return coalesce(new, old);
  end if;
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  v_org := coalesce(v_new ->> 'organization_id', v_old ->> 'organization_id')::uuid;

  -- Marking a trip advance settled is not a change to the trip sheet.
  if tg_table_name = 'trips' and tg_op = 'UPDATE'
    and (v_new - 'settled_on' - 'updated_at') = (v_old - 'settled_on' - 'updated_at')
  then
    return new;
  end if;

  if public.row_is_locked(tg_table_name, v_org, v_old)
    or public.row_is_locked(tg_table_name, v_org, v_new)
  then
    if v_trip then
      raise exception 'This trip sheet is closed. An admin or manager can open it with a comment.';
    end if;
    raise exception 'This day is closed. An admin or manager can open it with a comment.';
  end if;
  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'daily_entries', 'trips', 'trip_items', 'pump_statements', 'pump_payments',
    'company_expenses', 'salary_payments', 'intercity_income'
  ]
  loop
    execute format('drop trigger if exists guard_frozen on public.%I', t);
    execute format(
      'create trigger guard_frozen before insert or update or delete on public.%I
         for each row execute function public.guard_frozen_rows()', t
    );
  end loop;
end;
$$;

-- An admin or manager closes a day early (today or before).
create or replace function public.close_day(p_org uuid, p_day date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_trip_editor(p_org) then
    raise exception 'Only an admin or manager can close a day.';
  end if;
  if p_day is null or p_day > public.today_ist() then
    raise exception 'You can close today or an earlier day.';
  end if;
  insert into public.closed_days (organization_id, day)
  values (p_org, p_day)
  on conflict (organization_id, day) do nothing;
end;
$$;

-- An admin or manager opens a frozen day, or one approved trip sheet, for 30
-- minutes. The comment is saved with every change made meanwhile.
create or replace function public.open_for_edit(p_org uuid, p_day date, p_trip uuid, p_reason text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_until timestamptz;
begin
  if not public.is_trip_editor(p_org) then
    raise exception 'Only an admin or manager can change a closed day.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Write why you are changing it.';
  end if;
  if (p_day is null) = (p_trip is null) then
    raise exception 'Choose a day or a trip sheet.';
  end if;
  if p_trip is not null and not exists (
    select 1 from public.trips where id = p_trip and organization_id = p_org
  ) then
    raise exception 'That trip is not in this company.';
  end if;
  insert into public.edit_unlocks (organization_id, day, trip_id, reason)
  values (p_org, p_day, p_trip, btrim(p_reason))
  returning expires_at into v_until;
  return v_until;
end;
$$;

-- Whether a day is frozen or closed, and until when the caller has it open.
create or replace function public.day_lock_status(p_org uuid, p_day date)
returns table (frozen boolean, closed boolean, open_until timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_day_frozen(p_org, p_day),
    exists (select 1 from public.closed_days where organization_id = p_org and day = p_day),
    (
      select max(u.expires_at) from public.edit_unlocks as u
      where u.organization_id = p_org and u.user_id = auth.uid()
        and u.day = p_day and u.expires_at > now()
    )
  where public.is_org_member(p_org) or public.is_super_admin();
$$;

-- The same for one trip sheet.
create or replace function public.trip_lock_status(p_org uuid, p_trip uuid)
returns table (frozen boolean, open_until timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((
      select public.is_day_frozen(p_org, k.k_day)
      from public.trips as t, public.freeze_key('trips', to_jsonb(t)) as k
      where t.id = p_trip and t.organization_id = p_org
    ), false),
    (
      select max(u.expires_at) from public.edit_unlocks as u
      where u.organization_id = p_org and u.user_id = auth.uid()
        and u.trip_id = p_trip and u.expires_at > now()
    )
  where public.is_trip_editor(p_org) or public.is_super_admin();
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'is_day_frozen(uuid, date)', 'active_unlock_reason(uuid, date, uuid)',
    'freeze_key(text, jsonb)', 'row_is_locked(text, uuid, jsonb)',
    'close_day(uuid, date)', 'open_for_edit(uuid, date, uuid, text)',
    'day_lock_status(uuid, date)', 'trip_lock_status(uuid, uuid)'
  ]
  loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Change history
-- ---------------------------------------------------------------------------

-- No foreign key to the company: rows are written while a company is being
-- deleted, and admin_delete_company clears them afterwards.
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  table_name text not null,
  row_id uuid,
  action text not null check (action in ('insert', 'update', 'delete')),
  bus_id uuid,
  -- The module the row belongs to; null for company-wide rows.
  module text,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  reason text not null default '',
  old_data jsonb,
  new_data jsonb
);

create index if not exists audit_log_org_idx on public.audit_log (organization_id, changed_at desc);
create index if not exists audit_log_row_idx on public.audit_log (row_id, changed_at desc);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

drop policy if exists "Admins and managers read history" on public.audit_log;
create policy "Admins and managers read history"
  on public.audit_log for select to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_trip_editor(organization_id)
      and changed_at > now() - interval '1 year'
      and (public.my_module(organization_id) is null or module = public.my_module(organization_id))
    )
  );

-- The module a money record belongs to.
create or replace function public.row_module(p_table text, p_row jsonb)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_table in ('daily_entries', 'trips', 'renewals') and p_row ->> 'bus_id' is not null
      then public.bus_module((p_row ->> 'bus_id')::uuid)
    when p_table = 'renewals' then public.person_module((p_row ->> 'person_id')::uuid)
    when p_table in ('pump_statements', 'pump_payments', 'crew_people') then p_row ->> 'module'
    when p_table = 'salary_payments' then public.person_module((p_row ->> 'person_id')::uuid)
    when p_table in ('tour_bookings', 'tour_payments') then 'tour'
    when p_table = 'intercity_income' then 'omni'
    else null
  end;
$$;

create or replace function public.write_history(
  p_table text,
  p_action text,
  p_old jsonb,
  p_new jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := coalesce(p_new, p_old);
  v_org uuid := (v_row ->> 'organization_id')::uuid;
  v_key record;
  v_reason text := '';
begin
  -- The company is being deleted: nothing to keep.
  if not exists (select 1 from public.organizations where id = v_org) then
    return;
  end if;
  select * into v_key from public.freeze_key(p_table, v_row);
  if v_key.k_day is not null and public.is_day_frozen(v_org, v_key.k_day) then
    v_reason := coalesce(public.active_unlock_reason(v_org, v_key.k_day, v_key.k_trip), '');
  end if;
  insert into public.audit_log (
    organization_id, table_name, row_id, action, bus_id, module, changed_by, reason, old_data, new_data
  )
  values (
    v_org,
    p_table,
    nullif(v_row ->> 'id', '')::uuid,
    p_action,
    nullif(v_row ->> 'bus_id', '')::uuid,
    public.row_module(p_table, v_row),
    auth.uid(),
    v_reason,
    p_old,
    p_new
  );
  -- History is kept for one year.
  if random() < 0.02 then
    delete from public.audit_log
    where organization_id = v_org and changed_at < now() - interval '1 year';
  end if;
end;
$$;

revoke all on function public.write_history(text, text, jsonb, jsonb) from public;
revoke all on function public.row_module(text, jsonb) from public;

create or replace function public.record_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  -- save_trip writes one history row with the trip and all its lines.
  if tg_table_name = 'trips' and current_setting('fleetops.saving_trip', true) = 'on' then
    return null;
  end if;
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and (v_old - 'updated_at') = (v_new - 'updated_at') then
    return null;
  end if;
  perform public.write_history(tg_table_name, lower(tg_op), v_old, v_new);
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'daily_entries', 'trips', 'pump_statements', 'pump_payments', 'company_expenses',
    'crew_people', 'salary_payments', 'intercity_income', 'renewals',
    'tour_bookings', 'tour_payments'
  ]
  loop
    execute format('drop trigger if exists record_change on public.%I', t);
    execute format(
      'create trigger record_change after insert or update or delete on public.%I
         for each row execute function public.record_change()', t
    );
  end loop;
end;
$$;

-- A trip sheet with all its lines, as history keeps it.
create or replace function public.trip_snapshot(p_trip uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(t) || jsonb_build_object(
    'items',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'kind', i.kind, 'category', i.category, 'amount_inr', i.amount_inr,
          'litres', i.litres, 'paid_by', i.paid_by, 'pump', i.pump, 'note', i.note
        )
        order by i.position
      )
      from public.trip_items as i
      where i.trip_id = t.id
    ), '[]'::jsonb)
  )
  from public.trips as t
  where t.id = p_trip;
$$;

revoke all on function public.trip_snapshot(uuid) from public;

-- save_trip from 0010, now writing one history row per save (trip + lines).
create or replace function public.save_trip(
  p_trip jsonb,
  p_items jsonb,
  p_approve boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid := nullif(p_trip ->> 'id', '')::uuid;
  v_org uuid := (p_trip ->> 'organization_id')::uuid;
  v_before jsonb;
  v_after jsonb;
begin
  perform set_config('fleetops.saving_trip', 'on', true);

  if v_id is null then
    insert into public.trips (
      organization_id, bus_id, sheet_no, route, started_at, ended_at, halt_note,
      driver1, driver2, cleaner, start_km, end_km, advance_inr,
      written_total_inr, photo_path
    )
    values (
      v_org,
      (p_trip ->> 'bus_id')::uuid,
      coalesce(p_trip ->> 'sheet_no', ''),
      coalesce(p_trip ->> 'route', ''),
      nullif(p_trip ->> 'started_at', '')::timestamptz,
      nullif(p_trip ->> 'ended_at', '')::timestamptz,
      coalesce(p_trip ->> 'halt_note', ''),
      coalesce(p_trip ->> 'driver1', ''),
      coalesce(p_trip ->> 'driver2', ''),
      coalesce(p_trip ->> 'cleaner', ''),
      nullif(p_trip ->> 'start_km', '')::integer,
      nullif(p_trip ->> 'end_km', '')::integer,
      coalesce(nullif(p_trip ->> 'advance_inr', '')::integer, 0),
      nullif(p_trip ->> 'written_total_inr', '')::integer,
      coalesce(p_trip ->> 'photo_path', '')
    )
    returning id into v_id;
  else
    v_before := public.trip_snapshot(v_id);
    update public.trips set
      bus_id = (p_trip ->> 'bus_id')::uuid,
      sheet_no = coalesce(p_trip ->> 'sheet_no', ''),
      route = coalesce(p_trip ->> 'route', ''),
      started_at = nullif(p_trip ->> 'started_at', '')::timestamptz,
      ended_at = nullif(p_trip ->> 'ended_at', '')::timestamptz,
      halt_note = coalesce(p_trip ->> 'halt_note', ''),
      driver1 = coalesce(p_trip ->> 'driver1', ''),
      driver2 = coalesce(p_trip ->> 'driver2', ''),
      cleaner = coalesce(p_trip ->> 'cleaner', ''),
      start_km = nullif(p_trip ->> 'start_km', '')::integer,
      end_km = nullif(p_trip ->> 'end_km', '')::integer,
      advance_inr = coalesce(nullif(p_trip ->> 'advance_inr', '')::integer, 0),
      written_total_inr = nullif(p_trip ->> 'written_total_inr', '')::integer,
      photo_path = coalesce(p_trip ->> 'photo_path', photo_path)
    where id = v_id and organization_id = v_org;
    if not found then
      raise exception 'Trip not found.';
    end if;
  end if;

  delete from public.trip_items where trip_id = v_id;

  insert into public.trip_items (
    organization_id, trip_id, kind, category, amount_inr, litres, paid_by, pump, note, position
  )
  select
    v_org,
    v_id,
    item ->> 'kind',
    item ->> 'category',
    (item ->> 'amount_inr')::integer,
    nullif(item ->> 'litres', '')::numeric,
    coalesce(nullif(item ->> 'paid_by', ''), 'cash'),
    coalesce(item ->> 'pump', ''),
    coalesce(item ->> 'note', ''),
    ordinality::integer
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as lines (item, ordinality);

  if p_approve then
    update public.trips
    set status = 'approved', approved_by = auth.uid(), approved_at = now()
    where id = v_id;
  end if;

  perform set_config('fleetops.saving_trip', 'off', true);

  v_after := public.trip_snapshot(v_id);
  if v_before is null
    or (v_before - 'updated_at') is distinct from (v_after - 'updated_at')
  then
    perform public.write_history(
      'trips',
      case when v_before is null then 'insert' else 'update' end,
      v_before,
      v_after
    );
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_trip(jsonb, jsonb, boolean) from public;
grant execute on function public.save_trip(jsonb, jsonb, boolean) to authenticated;

-- A deleted trip keeps its lines in history too.
create or replace function public.record_trip_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.write_history(
    'trips',
    'delete',
    to_jsonb(old) || jsonb_build_object(
      'items',
      coalesce((
        select jsonb_agg(
          jsonb_build_object('kind', i.kind, 'category', i.category, 'amount_inr', i.amount_inr)
          order by i.position
        )
        from public.trip_items as i where i.trip_id = old.id
      ), '[]'::jsonb)
    ),
    null
  );
  return old;
end;
$$;

-- Trip deletes are recorded before the lines go (with the lines); the
-- after-trigger then skips them.
drop trigger if exists record_trip_delete on public.trips;
create trigger record_trip_delete
  before delete on public.trips
  for each row execute function public.record_trip_delete();

drop trigger if exists record_change on public.trips;
create trigger record_change
  after insert or update on public.trips
  for each row execute function public.record_change();

-- ---------------------------------------------------------------------------
-- Deleting a company also clears its history (0013, plus the history rows).
-- ---------------------------------------------------------------------------

create or replace function public.admin_delete_company(p_org uuid, p_confirm_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org public.organizations;
begin
  if not public.is_super_admin() then
    raise exception 'Only the super-admin can delete companies.';
  end if;
  select * into v_org from public.organizations where id = p_org for update;
  if not found then
    raise exception 'That company was not found.';
  end if;
  if v_org.deactivated_at is null then
    raise exception 'Deactivate the company first.';
  end if;
  -- Counted in IST calendar days, the same way the console shows the date.
  if (v_org.deactivated_at at time zone 'Asia/Kolkata')::date + 30 > public.today_ist() then
    raise exception 'This company can be deleted from %.',
      to_char((v_org.deactivated_at at time zone 'Asia/Kolkata')::date + 30, 'DD Mon YYYY');
  end if;
  if btrim(coalesce(p_confirm_name, '')) <> btrim(v_org.name) then
    raise exception 'Type the company name exactly to delete it.';
  end if;
  delete from public.organizations where id = p_org;
  delete from public.audit_log where organization_id = p_org;
end;
$$;

revoke all on function public.admin_delete_company(uuid, text) from public;
grant execute on function public.admin_delete_company(uuid, text) to authenticated;
