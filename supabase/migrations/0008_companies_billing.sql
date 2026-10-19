-- Phase 1: companies, invites, super-admin console, free trial and subscription reminders.
--
-- Run this once in the Supabase SQL editor, then make yourself the super-admin:
--   insert into public.super_admins (user_id)
--   select id from auth.users where email = 'YOUR-LOGIN-EMAIL';
--
-- Payment itself happens outside the app (bank transfer or UPI). The super-admin
-- records each payment here, which moves the company's next due date.

-- ---------------------------------------------------------------------------
-- Super-admin
-- ---------------------------------------------------------------------------

create table public.super_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.super_admins enable row level security;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.super_admins
    where user_id = auth.uid()
  );
$$;

revoke all on function public.is_super_admin() from public;
grant execute on function public.is_super_admin() to authenticated;

create policy "Users read own super admin row"
  on public.super_admins for select
  to authenticated
  using (user_id = auth.uid());

create or replace function public.today_ist()
returns date
language sql
stable
as $$
  select (now() at time zone 'Asia/Kolkata')::date;
$$;

-- ---------------------------------------------------------------------------
-- Company details and bus types
-- ---------------------------------------------------------------------------

alter table public.organizations
  add column if not exists town text not null default '',
  add column if not exists gstin text not null default '',
  add column if not exists whatsapp_number text not null default '',
  add column if not exists bus_types text[] not null default array['town'];

alter table public.organizations
  add constraint organizations_bus_types_check
  check (bus_types <@ array['town', 'omni', 'tour']);

create policy "Super admin reads organizations"
  on public.organizations for select
  to authenticated
  using (public.is_super_admin());

create policy "Admins update their organization"
  on public.organizations for update
  to authenticated
  using (public.get_user_role(id) in ('owner', 'admin'))
  with check (public.get_user_role(id) in ('owner', 'admin'));

alter table public.buses
  add column if not exists bus_type text not null default 'town'
    check (bus_type in ('town', 'omni', 'tour')),
  add column if not exists seats integer check (seats is null or seats > 0),
  add column if not exists seat_layout text not null default ''
    check (seat_layout in ('', 'seater', 'sleeper')),
  add column if not exists permit_type text not null default '',
  add column if not exists runs_with text not null default '';

-- ---------------------------------------------------------------------------
-- Subscription: free trial, plan, next due date
-- ---------------------------------------------------------------------------

create table public.org_subscriptions (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  plan_label text not null default 'Per operator',
  amount_inr integer check (amount_inr is null or amount_inr >= 0),
  billing_period text not null default 'month'
    check (billing_period in ('month', 'quarter', 'year')),
  trial_ends_on date not null,
  next_due_on date,
  created_at timestamptz not null default now()
);

alter table public.org_subscriptions enable row level security;

create policy "Members read their subscription"
  on public.org_subscriptions for select
  to authenticated
  using (public.is_org_member(organization_id) or public.is_super_admin());

create policy "Super admin manages subscriptions"
  on public.org_subscriptions for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

insert into public.org_subscriptions (organization_id, trial_ends_on)
select id, public.today_ist() + 30
from public.organizations
on conflict (organization_id) do nothing;

create table public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  paid_on date not null,
  amount_inr integer not null check (amount_inr >= 0),
  mode text not null default 'upi' check (mode in ('upi', 'bank', 'cash', 'other')),
  reference text not null default '',
  paid_until date not null,
  recorded_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index subscription_payments_org_idx
  on public.subscription_payments (organization_id, paid_on desc);

alter table public.subscription_payments enable row level security;

create policy "Super admin manages payments"
  on public.subscription_payments for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- Where companies pay. One row, edited by the super-admin, shown to every company.
create table public.platform_payment_details (
  id boolean primary key default true check (id),
  account_name text not null default '',
  bank_name text not null default '',
  account_number text not null default '',
  ifsc text not null default '',
  upi_id text not null default ''
);

insert into public.platform_payment_details (id) values (true);

alter table public.platform_payment_details enable row level security;

create policy "Signed-in users read payment details"
  on public.platform_payment_details for select
  to authenticated
  using (true);

create policy "Super admin updates payment details"
  on public.platform_payment_details for update
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- A company stays usable for 15 days after its due date, then turns view-only.
create or replace function public.org_in_good_standing(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(
      (
        select coalesce(s.next_due_on, s.trial_ends_on) + 15 >= public.today_ist()
        from public.org_subscriptions as s
        where s.organization_id = org_id
      ),
      true
    )
    or public.is_super_admin();
$$;

revoke all on function public.org_in_good_standing(uuid) from public;
grant execute on function public.org_in_good_standing(uuid) to authenticated;

create policy "Overdue companies are view-only (insert)"
  on public.daily_entries as restrictive
  for insert
  to authenticated
  with check (public.org_in_good_standing(organization_id));

create policy "Overdue companies are view-only (update)"
  on public.daily_entries as restrictive
  for update
  to authenticated
  using (public.org_in_good_standing(organization_id))
  with check (public.org_in_good_standing(organization_id));

create policy "Overdue companies are view-only (delete)"
  on public.daily_entries as restrictive
  for delete
  to authenticated
  using (public.org_in_good_standing(organization_id));

create policy "Overdue companies are view-only (insert buses)"
  on public.buses as restrictive
  for insert
  to authenticated
  with check (public.org_in_good_standing(organization_id));

create policy "Overdue companies are view-only (update buses)"
  on public.buses as restrictive
  for update
  to authenticated
  using (public.org_in_good_standing(organization_id))
  with check (public.org_in_good_standing(organization_id));

create policy "Overdue companies are view-only (delete buses)"
  on public.buses as restrictive
  for delete
  to authenticated
  using (public.org_in_good_standing(organization_id));

-- ---------------------------------------------------------------------------
-- Invites (shared on WhatsApp). Accepting one adds the person to the company.
-- ---------------------------------------------------------------------------

create table public.org_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  token text not null unique
    default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  role text not null check (role in ('admin', 'manager', 'crew')),
  display_name text not null default '',
  whatsapp_number text not null default '',
  bus_id uuid references public.buses (id) on delete set null,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index org_invites_org_idx on public.org_invites (organization_id);

alter table public.org_invites enable row level security;

create policy "Admins read invites"
  on public.org_invites for select
  to authenticated
  using (
    public.get_user_role(organization_id) in ('owner', 'admin')
    or public.is_super_admin()
  );

create policy "Admins cancel open invites"
  on public.org_invites for delete
  to authenticated
  using (
    accepted_at is null
    and (
      public.get_user_role(organization_id) in ('owner', 'admin')
      or public.is_super_admin()
    )
  );

create or replace function public.create_company(
  p_name text,
  p_town text,
  p_bus_types text[],
  p_gstin text,
  p_admin_name text,
  p_admin_whatsapp text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_token text;
  v_types text[];
begin
  if not public.is_super_admin() then
    raise exception 'Only the super-admin can create companies.';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'Enter the company name.';
  end if;

  v_types := coalesce(nullif(p_bus_types, '{}'), array['town']);

  insert into public.organizations (name, town, gstin, whatsapp_number, bus_types)
  values (
    btrim(p_name),
    btrim(coalesce(p_town, '')),
    btrim(coalesce(p_gstin, '')),
    btrim(coalesce(p_admin_whatsapp, '')),
    v_types
  )
  returning id into v_org;

  insert into public.org_subscriptions (organization_id, trial_ends_on)
  values (v_org, public.today_ist() + 30);

  insert into public.org_invites (
    organization_id, role, display_name, whatsapp_number, created_by
  )
  values (
    v_org,
    'admin',
    btrim(coalesce(p_admin_name, '')),
    btrim(coalesce(p_admin_whatsapp, '')),
    auth.uid()
  )
  returning token into v_token;

  return jsonb_build_object('organization_id', v_org, 'token', v_token);
end;
$$;

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

-- Callable before sign-in, so the invite page can say who invited the person.
create or replace function public.get_invite(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_invite public.org_invites;
  v_company text;
begin
  select * into v_invite from public.org_invites where token = p_token;
  if not found then
    return jsonb_build_object('valid', false, 'reason', 'This invite link is not valid.');
  end if;
  if v_invite.accepted_at is not null then
    return jsonb_build_object('valid', false, 'reason', 'This invite was already used.');
  end if;
  if v_invite.expires_at < now() then
    return jsonb_build_object('valid', false, 'reason', 'This invite link has expired.');
  end if;

  select name into v_company from public.organizations where id = v_invite.organization_id;
  return jsonb_build_object(
    'valid', true,
    'company', v_company,
    'role', v_invite.role,
    'display_name', v_invite.display_name
  );
end;
$$;

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

-- ---------------------------------------------------------------------------
-- Super-admin: company list and payment recording
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_companies()
returns table (
  organization_id uuid,
  name text,
  town text,
  bus_types text[],
  bus_count bigint,
  member_count bigint,
  admin_name text,
  pending_invite_token text,
  plan_label text,
  amount_inr integer,
  billing_period text,
  trial_ends_on date,
  next_due_on date,
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
    s.trial_ends_on,
    s.next_due_on,
    o.created_at
  from public.organizations o
  left join public.org_subscriptions s on s.organization_id = o.id
  order by o.created_at;
end;
$$;

create or replace function public.record_payment(
  p_org uuid,
  p_paid_on date,
  p_amount integer,
  p_mode text,
  p_reference text,
  p_paid_until date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only the super-admin can record payments.';
  end if;
  if p_paid_until is null or p_paid_until <= p_paid_on then
    raise exception 'Paid-until date must be after the payment date.';
  end if;

  insert into public.subscription_payments (
    organization_id, paid_on, amount_inr, mode, reference, paid_until, recorded_by
  )
  values (
    p_org, p_paid_on, p_amount, p_mode, btrim(coalesce(p_reference, '')), p_paid_until, auth.uid()
  );

  insert into public.org_subscriptions (organization_id, trial_ends_on, next_due_on)
  values (p_org, public.today_ist(), p_paid_until)
  on conflict (organization_id) do update set next_due_on = excluded.next_due_on;
end;
$$;

revoke all on function public.create_company(text, text, text[], text, text, text) from public;
revoke all on function public.create_invite(uuid, text, text, text, uuid) from public;
revoke all on function public.get_invite(text) from public;
revoke all on function public.accept_invite(text) from public;
revoke all on function public.admin_list_companies() from public;
revoke all on function public.record_payment(uuid, date, integer, text, text, date) from public;

grant execute on function public.create_company(text, text, text[], text, text, text) to authenticated;
grant execute on function public.create_invite(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.get_invite(text) to anon, authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.admin_list_companies() to authenticated;
grant execute on function public.record_payment(uuid, date, integer, text, text, date) to authenticated;
