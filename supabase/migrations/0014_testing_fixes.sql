-- Fixes from end-to-end testing. Run after 0013. Safe to run more than once.

-- Company admins may edit only their company's details. The bus limit and the
-- closed date belong to the super admin, who changes them through the
-- security-definer admin_* functions.
revoke update on public.organizations from authenticated;
grant update (name, town, gstin, whatsapp_number, bus_types) on public.organizations to authenticated;

-- The view-only lock also covers company details and team roles.
drop policy if exists "Overdue companies are view-only (organization)" on public.organizations;
create policy "Overdue companies are view-only (organization)"
  on public.organizations as restrictive
  for update
  to authenticated
  using (public.org_in_good_standing(id))
  with check (public.org_in_good_standing(id));

drop policy if exists "Overdue companies are view-only (members)" on public.organization_members;
create policy "Overdue companies are view-only (members)"
  on public.organization_members as restrictive
  for update
  to authenticated
  using (public.org_in_good_standing(organization_id))
  with check (public.org_in_good_standing(organization_id));

-- Invites are created through create_invite, which bypasses table policies.
create or replace function public.create_invite(
  p_org uuid,
  p_role text,
  p_name text,
  p_whatsapp text,
  p_bus_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;
  if not (
    public.is_super_admin()
    or public.get_user_role(p_org) in ('owner', 'admin')
  ) then
    raise exception 'Only an admin can invite people.';
  end if;
  if not public.org_in_good_standing(p_org) then
    raise exception 'The app is view-only until the payment is received.';
  end if;
  if p_role not in ('admin', 'manager', 'crew') then
    raise exception 'Choose a valid role.';
  end if;
  if p_role = 'crew' then
    if p_bus_id is null
      or not exists (
        select 1 from public.buses where id = p_bus_id and organization_id = p_org
      )
    then
      raise exception 'Choose a vehicle for this crew member.';
    end if;
  end if;

  insert into public.org_invites (
    organization_id, role, display_name, whatsapp_number, bus_id, created_by
  )
  values (
    p_org,
    p_role,
    btrim(coalesce(p_name, '')),
    btrim(coalesce(p_whatsapp, '')),
    case when p_role = 'crew' then p_bus_id else null end,
    auth.uid()
  )
  returning token into v_token;

  return v_token;
end;
$$;

-- A row's bus must belong to the same company as the row.
create or replace function public.check_bus_in_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.bus_id is not null and not exists (
    select 1 from public.buses where id = new.bus_id and organization_id = new.organization_id
  ) then
    raise exception 'That bus is not in this company.';
  end if;
  return new;
end;
$$;

drop trigger if exists trips_check_bus on public.trips;
create trigger trips_check_bus
  before insert or update of bus_id, organization_id on public.trips
  for each row execute function public.check_bus_in_org();

drop trigger if exists daily_entries_check_bus on public.daily_entries;
create trigger daily_entries_check_bus
  before insert or update of bus_id, organization_id on public.daily_entries
  for each row execute function public.check_bus_in_org();

drop trigger if exists company_expenses_check_bus on public.company_expenses;
create trigger company_expenses_check_bus
  before insert or update of bus_id, organization_id on public.company_expenses
  for each row execute function public.check_bus_in_org();

create or replace function public.check_intercity_buses()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from unnest(new.bus_ids) as b(id)
    where not exists (
      select 1 from public.buses where buses.id = b.id and organization_id = new.organization_id
    )
  ) then
    raise exception 'That bus is not in this company.';
  end if;
  return new;
end;
$$;

drop trigger if exists intercity_income_check_buses on public.intercity_income;
create trigger intercity_income_check_buses
  before insert or update of bus_ids, organization_id on public.intercity_income
  for each row execute function public.check_intercity_buses();

-- A salary can be paid in parts, so a person can have several payments a month.
alter table public.salary_payments drop constraint if exists salary_payments_person_id_for_month_key;
create index if not exists salary_payments_person_month_idx on public.salary_payments (person_id, for_month);

-- Every company keeps at least one admin, and crew always have a bus.
create or replace function public.guard_member_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role in ('owner', 'admin') and new.role not in ('owner', 'admin') and not exists (
    select 1 from public.organization_members
    where organization_id = old.organization_id
      and user_id <> old.user_id
      and role in ('owner', 'admin')
  ) then
    raise exception 'This is the only admin. Make someone else admin first.';
  end if;
  if new.role = 'crew' and old.role <> 'crew' and not exists (
    select 1 from public.crew_assignments
    where organization_id = new.organization_id and user_id = new.user_id
  ) then
    raise exception 'Crew need a bus. Invite them again as crew and pick their bus.';
  end if;
  return new;
end;
$$;

drop trigger if exists organization_members_guard_role on public.organization_members;
create trigger organization_members_guard_role
  before update of role on public.organization_members
  for each row execute function public.guard_member_role();

-- Company admins can't hand out the legacy "owner" role.
drop policy if exists "Admins update member roles" on public.organization_members;
create policy "Admins update member roles"
  on public.organization_members
  for update
  to authenticated
  using (public.get_user_role(organization_id) in ('owner', 'admin'))
  with check (
    public.get_user_role(organization_id) in ('owner', 'admin')
    and role in ('admin', 'manager', 'crew')
  );

-- An invite to a closed company can't be used.
create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.org_invites;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.';
  end if;

  select * into v_invite from public.org_invites where token = p_token for update;
  if not found then
    raise exception 'This invite link is not valid.';
  end if;
  if v_invite.accepted_at is not null then
    raise exception 'This invite was already used.';
  end if;
  if v_invite.expires_at < now() then
    raise exception 'This invite link has expired.';
  end if;
  if exists (
    select 1 from public.organizations
    where id = v_invite.organization_id and deactivated_at is not null
  ) then
    raise exception 'This company is closed. Please contact Fleet Ops.';
  end if;
  if exists (
    select 1 from public.organization_members where user_id = auth.uid()
  ) then
    raise exception 'This account already belongs to a company.';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_invite.organization_id, auth.uid(), v_invite.role);

  if v_invite.role = 'crew' and v_invite.bus_id is not null then
    insert into public.crew_assignments (organization_id, user_id, bus_id)
    values (v_invite.organization_id, auth.uid(), v_invite.bus_id)
    on conflict (organization_id, user_id) do update set bus_id = excluded.bus_id;
  end if;

  update public.org_invites
  set accepted_at = now(), accepted_by = auth.uid()
  where id = v_invite.id;

  return v_invite.organization_id;
end;
$$;

-- The company list also returns the pending admin invite's WhatsApp number.
drop function if exists public.admin_list_companies();

create function public.admin_list_companies()
returns table (
  organization_id uuid,
  name text,
  town text,
  gstin text,
  whatsapp_number text,
  bus_types text[],
  bus_count bigint,
  member_count bigint,
  admin_name text,
  pending_invite_token text,
  pending_invite_whatsapp text,
  plan_label text,
  amount_inr integer,
  billing_period text,
  trial_starts_on date,
  trial_ends_on date,
  next_due_on date,
  max_buses integer,
  deactivated_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super-admin can see all companies.';
  end if;

  return query
  select
    o.id,
    o.name,
    o.town,
    o.gstin,
    o.whatsapp_number,
    o.bus_types,
    (select count(*) from public.buses b where b.organization_id = o.id),
    (select count(*) from public.organization_members m where m.organization_id = o.id),
    coalesce(
      (
        select nullif(btrim(p.display_name), '')
        from public.organization_members m
        join public.profiles p on p.id = m.user_id
        where m.organization_id = o.id and m.role in ('owner', 'admin')
        order by m.created_at
        limit 1
      ),
      (
        select nullif(i.display_name, '')
        from public.org_invites i
        where i.organization_id = o.id and i.role = 'admin'
        order by i.created_at
        limit 1
      ),
      ''
    ),
    (
      select i.token
      from public.org_invites i
      where i.organization_id = o.id
        and i.role = 'admin'
        and i.accepted_at is null
        and i.expires_at > now()
      order by i.created_at desc
      limit 1
    ),
    (
      select i.whatsapp_number
      from public.org_invites i
      where i.organization_id = o.id
        and i.role = 'admin'
        and i.accepted_at is null
        and i.expires_at > now()
      order by i.created_at desc
      limit 1
    ),
    s.plan_label,
    s.amount_inr,
    s.billing_period,
    (s.created_at at time zone 'Asia/Kolkata')::date,
    s.trial_ends_on,
    s.next_due_on,
    o.max_buses,
    o.deactivated_at,
    o.created_at
  from public.organizations o
  left join public.org_subscriptions s on s.organization_id = o.id
  where not (
    exists (
      select 1 from public.organization_members m
      join public.super_admins sa on sa.user_id = m.user_id
      where m.organization_id = o.id
    )
    and not exists (
      select 1 from public.organization_members m
      where m.organization_id = o.id
        and m.user_id not in (select user_id from public.super_admins)
    )
  )
  order by o.created_at;
end;
$$;

revoke all on function public.admin_list_companies() from public;
grant execute on function public.admin_list_companies() to authenticated;
