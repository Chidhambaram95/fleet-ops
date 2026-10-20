-- Super-admin controls: edit a company, its people and bus limit; deactivate a
-- company (a hard lock) and delete all of its data only 30 days after that.
-- Also hides the super-admin's own login company from the console.
-- Run after 0012.

-- ---------------------------------------------------------------------------
-- New company columns
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column if not exists max_buses integer check (max_buses is null or max_buses >= 0),
  add column if not exists deactivated_at timestamptz;

-- ---------------------------------------------------------------------------
-- Deactivated companies are locked: their people can no longer read or change
-- anything. The super-admin still sees everything.
-- ---------------------------------------------------------------------------

create or replace function public.is_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members as m
    join public.organizations as o on o.id = m.organization_id
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and o.deactivated_at is null
  );
$$;

create or replace function public.get_user_role(org_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select membership.role
  from public.organization_members as membership
  join public.organizations as o on o.id = membership.organization_id
  where membership.organization_id = org_id
    and membership.user_id = auth.uid()
    and o.deactivated_at is null
  limit 1;
$$;

-- So the app can say why a person was locked out.
create or replace function public.my_closed_company()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select o.name
  from public.organization_members as m
  join public.organizations as o on o.id = m.organization_id
  where m.user_id = auth.uid()
    and o.deactivated_at is not null
  limit 1;
$$;

revoke all on function public.my_closed_company() from public;
grant execute on function public.my_closed_company() to authenticated;

-- ---------------------------------------------------------------------------
-- Bus limit, checked by the database so it can't be bypassed. Buses already
-- over a lowered limit stay; only new ones are blocked.
-- ---------------------------------------------------------------------------

create or replace function public.check_bus_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_count integer;
begin
  select max_buses into v_limit from public.organizations where id = new.organization_id;
  if v_limit is null then
    return new;
  end if;
  select count(*) into v_count from public.buses where organization_id = new.organization_id;
  if v_count >= v_limit then
    raise exception 'Your plan allows % buses. Contact Fleet Ops to add more.', v_limit;
  end if;
  return new;
end;
$$;

drop trigger if exists buses_limit on public.buses;
create trigger buses_limit
  before insert on public.buses
  for each row execute function public.check_bus_limit();

-- ---------------------------------------------------------------------------
-- Company list: adds trial start, bus limit and deactivation. Leaves out
-- companies whose only people are super-admins (the super-admin's own login).
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Edit a company. Everything else points at the company id, so a new name
-- shows everywhere at once.
-- ---------------------------------------------------------------------------

create or replace function public.admin_update_company(
  p_org uuid,
  p_name text,
  p_town text,
  p_gstin text,
  p_whatsapp text,
  p_bus_types text[],
  p_max_buses integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super-admin can edit companies.';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'Enter the company name.';
  end if;
  if p_max_buses is not null and p_max_buses < 0 then
    raise exception 'The bus limit cannot be negative.';
  end if;

  update public.organizations
  set
    name = btrim(p_name),
    town = btrim(coalesce(p_town, '')),
    gstin = upper(btrim(coalesce(p_gstin, ''))),
    whatsapp_number = btrim(coalesce(p_whatsapp, '')),
    bus_types = coalesce(nullif(p_bus_types, '{}'), array['town']),
    max_buses = p_max_buses
  where id = p_org;
  if not found then
    raise exception 'That company was not found.';
  end if;
end;
$$;

-- People in a company, with their login email so the super-admin can tell them apart.
create or replace function public.admin_list_members(p_org uuid)
returns table (
  user_id uuid,
  display_name text,
  email text,
  role text,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super-admin can see this.';
  end if;
  return query
  select
    m.user_id,
    coalesce(nullif(btrim(p.display_name), ''), ''),
    coalesce(u.email::text, ''),
    m.role,
    m.created_at
  from public.organization_members m
  left join public.profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  where m.organization_id = p_org
  order by m.created_at;
end;
$$;

create or replace function public.admin_set_member_role(p_org uuid, p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super-admin can change access.';
  end if;
  if p_role not in ('admin', 'manager', 'crew') then
    raise exception 'Choose admin, manager or crew.';
  end if;
  update public.organization_members
  set role = p_role
  where organization_id = p_org and user_id = p_user;
  if not found then
    raise exception 'That person is not in this company.';
  end if;
end;
$$;

create or replace function public.admin_remove_member(p_org uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super-admin can remove access.';
  end if;
  delete from public.crew_assignments where organization_id = p_org and user_id = p_user;
  delete from public.organization_members where organization_id = p_org and user_id = p_user;
  if not found then
    raise exception 'That person is not in this company.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Deactivate, reactivate, and delete for good after a 30-day lock.
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_company_active(p_org uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super-admin can do this.';
  end if;
  update public.organizations
  set deactivated_at = case when p_active then null else coalesce(deactivated_at, now()) end
  where id = p_org;
  if not found then
    raise exception 'That company was not found.';
  end if;
end;
$$;

-- Deletes the company and, through the foreign keys, every bus, entry, trip,
-- cost, salary, renewal, invite and payment record that belongs to it.
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
end;
$$;

revoke all on function public.admin_update_company(uuid, text, text, text, text, text[], integer) from public;
revoke all on function public.admin_list_members(uuid) from public;
revoke all on function public.admin_set_member_role(uuid, uuid, text) from public;
revoke all on function public.admin_remove_member(uuid, uuid) from public;
revoke all on function public.admin_set_company_active(uuid, boolean) from public;
revoke all on function public.admin_delete_company(uuid, text) from public;

grant execute on function public.admin_update_company(uuid, text, text, text, text, text[], integer) to authenticated;
grant execute on function public.admin_list_members(uuid) to authenticated;
grant execute on function public.admin_set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.admin_remove_member(uuid, uuid) to authenticated;
grant execute on function public.admin_set_company_active(uuid, boolean) to authenticated;
grant execute on function public.admin_delete_company(uuid, text) to authenticated;

-- The super-admin lists and removes a deleted company's photos before the delete.
drop policy if exists "Super admin reads all trip sheet photos" on storage.objects;
create policy "Super admin reads all trip sheet photos"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'trip-sheets' and public.is_super_admin());

drop policy if exists "Super admin deletes trip sheet photos" on storage.objects;
create policy "Super admin deletes trip sheet photos"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'trip-sheets' and public.is_super_admin());
