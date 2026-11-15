-- Link a crew person to their login.
-- Run after 0033. Safe to run more than once.
--
-- crew_people is the payroll list (drivers, conductors, cleaners). A crew login
-- (role "crew") is the account someone signs in with. Nothing connected the two,
-- so the app could not tell which conductor a login belongs to. Conductor
-- settlements need that: a conductor enters and sees only their own.
--
-- Rules, as decided by the owner:
--   * Only some people have a login, so the link is optional (null).
--   * One login belongs to one person, and one person has at most one login.
--   * Only an admin can set, change or clear the link.
--   * The login must be a member of the same company.

alter table public.crew_people
  add column if not exists user_id uuid references auth.users (id) on delete set null;

-- One login, one person. (One column already means one login per person.)
create unique index if not exists crew_people_user_id_key
  on public.crew_people (user_id)
  where user_id is not null;

create or replace function public.check_crew_login_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.user_id is not distinct from old.user_id then
    return new;
  end if;
  if tg_op = 'INSERT' and new.user_id is null then
    return new;
  end if;
  -- Changes made by another change (a login being deleted), the super admin or
  -- the SQL editor pass; every signed-in person must be an admin of this company.
  if auth.uid() is not null and not public.is_super_admin() and pg_trigger_depth() <= 1
    and coalesce(public.get_user_role(new.organization_id), '') not in ('owner', 'admin')
  then
    raise exception 'Only an admin can link a crew person to a login.';
  end if;
  if new.user_id is not null and not exists (
    select 1 from public.organization_members as m
    where m.organization_id = new.organization_id and m.user_id = new.user_id
  ) then
    raise exception 'That login is not a member of this company.';
  end if;
  return new;
end;
$$;

drop trigger if exists crew_people_login_link on public.crew_people;
create trigger crew_people_login_link
  before insert or update on public.crew_people
  for each row execute function public.check_crew_login_link();

-- The crew person the signed-in login is linked to in this company, if any.
create or replace function public.my_crew_person(p_org uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.crew_people as p
  where p.organization_id = p_org and p.user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.my_crew_person(uuid) from public, anon;
grant execute on function public.my_crew_person(uuid) to authenticated;

-- A linked person can read their own row, even though crew logins cannot read
-- the crew list. Nothing else about the list opens up.
drop policy if exists "A linked login reads its own person" on public.crew_people;
create policy "A linked login reads its own person"
  on public.crew_people for select to authenticated
  using (user_id = auth.uid());
