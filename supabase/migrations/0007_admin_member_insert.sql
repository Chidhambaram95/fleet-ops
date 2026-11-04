-- Run once, in order, on a new database. Not safe to re-run on a live one:
-- later migrations replace parts of it. Kept unchanged as the history of the schema.
-- Admins can add an existing auth user to their organization.
-- Account creation itself happens through Supabase Auth.

create policy "Admins insert organization members"
  on public.organization_members
  for insert
  to authenticated
  with check (
    public.get_user_role(organization_id) in ('owner', 'admin')
    and role in ('admin', 'manager', 'crew')
    and user_id is distinct from auth.uid()
  );
