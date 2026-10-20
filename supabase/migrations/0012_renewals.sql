-- Phase 5: renewal dates for each bus (FC, insurance, permit, road tax, PUC,
-- speed governor, GPS) and each driver (licence, badge). Each renewal is a new
-- row, so the history stays; the latest expiry per bus and document is current.
-- Run after 0011.

create table if not exists public.renewals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  bus_id uuid references public.buses (id) on delete cascade,
  person_id uuid references public.crew_people (id) on delete cascade,
  kind text not null check (kind in (
    'fc', 'insurance', 'permit', 'road_tax', 'puc', 'speed_governor', 'gps',
    'licence', 'badge'
  )),
  permit_type text not null default '',
  expires_on date not null,
  amount_inr integer check (amount_inr is null or amount_inr >= 0),
  paid_on date,
  photo_path text not null default '',
  note text not null default '',
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  -- Bus documents belong to a bus; licence and badge belong to a driver.
  constraint renewals_owner check (
    (kind in ('licence', 'badge') and person_id is not null and bus_id is null)
    or (kind not in ('licence', 'badge') and bus_id is not null and person_id is null)
  )
);

create index if not exists renewals_org_idx on public.renewals (organization_id, expires_on);

alter table public.renewals enable row level security;
grant select, insert, update, delete on public.renewals to authenticated;

drop policy if exists "Admins and managers manage" on public.renewals;
create policy "Admins and managers manage"
  on public.renewals for all to authenticated
  using (public.is_trip_editor(organization_id))
  with check (public.is_trip_editor(organization_id));

drop policy if exists "Overdue companies are view-only" on public.renewals;
create policy "Overdue companies are view-only"
  on public.renewals as restrictive for all to authenticated
  using (true)
  with check (public.org_in_good_standing(organization_id));

drop policy if exists "Overdue companies are view-only (delete)" on public.renewals;
create policy "Overdue companies are view-only (delete)"
  on public.renewals as restrictive for delete to authenticated
  using (public.org_in_good_standing(organization_id));

-- The bus or driver must belong to the same company.
create or replace function public.check_renewal_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.bus_id is not null and not exists (
    select 1 from public.buses as b
    where b.id = new.bus_id and b.organization_id = new.organization_id
  ) then
    raise exception 'That bus is not in this company.';
  end if;
  if new.person_id is not null and not exists (
    select 1 from public.crew_people as p
    where p.id = new.person_id and p.organization_id = new.organization_id
  ) then
    raise exception 'That driver is not in this company.';
  end if;
  return new;
end;
$$;

drop trigger if exists renewals_check_owner on public.renewals;
create trigger renewals_check_owner
  before insert or update on public.renewals
  for each row execute function public.check_renewal_owner();

-- Document photos share the private trip-sheets bucket, under
-- <organization id>/documents/, so the same storage rules apply.
