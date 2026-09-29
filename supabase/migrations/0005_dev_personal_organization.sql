-- Development fallback: a signed-in user with no membership gets a personal org.
-- Existing members are returned unchanged.

create or replace function public.ensure_personal_organization()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_org uuid;
  created_org uuid;
  member_email text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to save cash entries.';
  end if;

  select organization_id
  into existing_org
  from public.organization_members
  where user_id = auth.uid()
  order by created_at
  limit 1;

  if existing_org is not null then
    return existing_org;
  end if;

  select email into member_email from auth.users where id = auth.uid();

  insert into public.organizations (name)
  values (coalesce(member_email, 'Personal fleet'))
  returning id into created_org;

  insert into public.organization_members (organization_id, user_id, role)
  values (created_org, auth.uid(), 'owner');

  return created_org;
end;
$$;

revoke all on function public.ensure_personal_organization() from public;
grant execute on function public.ensure_personal_organization() to authenticated;
