-- Granular roles: admin (and legacy owner), manager, and crew.
-- Crew can work only the bus recorded in crew_assignments.

alter table public.buses
  add constraint buses_id_organization_id_key unique (id, organization_id);

do $$
declare
  constraint_name text;
begin
  select con.conname
  into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'organization_members'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%role%';

  if constraint_name is not null then
    execute format(
      'alter table public.organization_members drop constraint %I',
      constraint_name
    );
  end if;
end $$;

alter table public.organization_members
  add constraint organization_members_role_check
  check (role in ('owner', 'admin', 'manager', 'fleet_manager', 'member', 'crew'));

create table public.crew_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  bus_id uuid not null,
  created_at timestamptz not null default now(),
  constraint crew_assignments_organization_fkey
    foreign key (organization_id) references public.organizations (id) on delete cascade,
  constraint crew_assignments_user_fkey
    foreign key (user_id) references auth.users (id) on delete cascade,
  constraint crew_assignments_member_fkey
    foreign key (organization_id, user_id)
    references public.organization_members (organization_id, user_id)
    on delete cascade,
  constraint crew_assignments_bus_fkey
    foreign key (bus_id, organization_id)
    references public.buses (id, organization_id)
    on delete cascade,
  constraint crew_assignments_org_user_key unique (organization_id, user_id),
  constraint crew_assignments_org_user_bus_key unique (organization_id, user_id, bus_id)
);

create index crew_assignments_user_id_idx
  on public.crew_assignments (user_id);
create index crew_assignments_bus_id_idx
  on public.crew_assignments (bus_id);

alter table public.crew_assignments enable row level security;

grant select, insert, update, delete on public.crew_assignments to authenticated;

create or replace function public.get_user_role(org_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select membership.role
  from public.organization_members as membership
  where membership.organization_id = org_id
    and membership.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_assigned_to_bus(bus_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.crew_assignments as assignment
    where assignment.bus_id = is_assigned_to_bus.bus_id
      and assignment.user_id = auth.uid()
  );
$$;

revoke all on function public.get_user_role(uuid) from public;
revoke all on function public.is_assigned_to_bus(uuid) from public;
grant execute on function public.get_user_role(uuid) to authenticated;
grant execute on function public.is_assigned_to_bus(uuid) to authenticated;

-- owner matches admin. fleet_manager and member match manager.
drop policy if exists "Members can read buses" on public.buses;
drop policy if exists "Members can insert buses" on public.buses;
drop policy if exists "Members can update buses" on public.buses;
drop policy if exists "Members can delete buses" on public.buses;

create policy "Admins manage buses"
  on public.buses
  for all
  to authenticated
  using (public.get_user_role(organization_id) in ('owner', 'admin'))
  with check (public.get_user_role(organization_id) in ('owner', 'admin'));

create policy "Managers read buses"
  on public.buses
  for select
  to authenticated
  using (public.get_user_role(organization_id) in ('manager', 'fleet_manager', 'member'));

create policy "Crew read assigned buses"
  on public.buses
  for select
  to authenticated
  using (
    public.get_user_role(organization_id) = 'crew'
    and public.is_assigned_to_bus(id)
  );

drop policy if exists "Members can read entries" on public.daily_entries;
drop policy if exists "Members can insert entries" on public.daily_entries;
drop policy if exists "Members can update entries" on public.daily_entries;
drop policy if exists "Members can delete entries" on public.daily_entries;

create policy "Admins read entries"
  on public.daily_entries
  for select
  to authenticated
  using (public.get_user_role(organization_id) in ('owner', 'admin'));

create policy "Admins insert entries"
  on public.daily_entries
  for insert
  to authenticated
  with check (
    public.get_user_role(organization_id) in ('owner', 'admin')
    and created_by = auth.uid()
  );

create policy "Admins update entries"
  on public.daily_entries
  for update
  to authenticated
  using (public.get_user_role(organization_id) in ('owner', 'admin'))
  with check (public.get_user_role(organization_id) in ('owner', 'admin'));

create policy "Admins delete entries"
  on public.daily_entries
  for delete
  to authenticated
  using (public.get_user_role(organization_id) in ('owner', 'admin'));

create policy "Managers manage entries"
  on public.daily_entries
  for select
  to authenticated
  using (public.get_user_role(organization_id) in ('manager', 'fleet_manager', 'member'));

create policy "Managers insert entries"
  on public.daily_entries
  for insert
  to authenticated
  with check (
    public.get_user_role(organization_id) in ('manager', 'fleet_manager', 'member')
    and created_by = auth.uid()
  );

create policy "Managers update entries"
  on public.daily_entries
  for update
  to authenticated
  using (public.get_user_role(organization_id) in ('manager', 'fleet_manager', 'member'))
  with check (public.get_user_role(organization_id) in ('manager', 'fleet_manager', 'member'));

create policy "Managers delete entries"
  on public.daily_entries
  for delete
  to authenticated
  using (public.get_user_role(organization_id) in ('manager', 'fleet_manager', 'member'));

create policy "Crew read assigned entries"
  on public.daily_entries
  for select
  to authenticated
  using (
    public.get_user_role(organization_id) = 'crew'
    and public.is_assigned_to_bus(bus_id)
  );

create policy "Crew insert assigned entries"
  on public.daily_entries
  for insert
  to authenticated
  with check (
    public.get_user_role(organization_id) = 'crew'
    and public.is_assigned_to_bus(bus_id)
    and created_by = auth.uid()
  );

create policy "Crew update assigned entries"
  on public.daily_entries
  for update
  to authenticated
  using (
    public.get_user_role(organization_id) = 'crew'
    and public.is_assigned_to_bus(bus_id)
  )
  with check (
    public.get_user_role(organization_id) = 'crew'
    and public.is_assigned_to_bus(bus_id)
  );

create policy "Admins manage crew assignments"
  on public.crew_assignments
  for all
  to authenticated
  using (public.get_user_role(organization_id) in ('owner', 'admin'))
  with check (public.get_user_role(organization_id) in ('owner', 'admin'));

create policy "Users read own crew assignment"
  on public.crew_assignments
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "Admins update member roles"
  on public.organization_members
  for update
  to authenticated
  using (public.get_user_role(organization_id) in ('owner', 'admin'))
  with check (
    public.get_user_role(organization_id) in ('owner', 'admin')
    and role in ('owner', 'admin', 'manager', 'fleet_manager', 'member', 'crew')
  );

create policy "Members can read coworker profiles"
  on public.profiles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_members as mine
      join public.organization_members as theirs
        on theirs.organization_id = mine.organization_id
      where mine.user_id = auth.uid()
        and theirs.user_id = profiles.id
    )
  );
