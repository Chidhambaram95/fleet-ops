-- Phase 3: Omni round trips recorded from the driver's trip sheet.
-- One trip sheet is one trip. Admins and managers record, check and approve
-- trips; only approved trips count in reports. Run once in the SQL editor.

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  bus_id uuid not null references public.buses (id) on delete cascade,
  sheet_no text not null default '',
  route text not null default '',
  started_at timestamptz,
  ended_at timestamptz,
  halt_note text not null default '',
  driver1 text not null default '',
  driver2 text not null default '',
  cleaner text not null default '',
  start_km integer check (start_km is null or start_km >= 0),
  end_km integer check (end_km is null or end_km >= 0),
  advance_inr integer not null default 0 check (advance_inr >= 0),
  -- The total cash spent as written on the sheet, kept to check the sums.
  written_total_inr integer check (written_total_inr is null or written_total_inr >= 0),
  photo_path text not null default '',
  status text not null default 'draft' check (status in ('draft', 'approved')),
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trips_km_order check (start_km is null or end_km is null or end_km >= start_km),
  constraint trips_time_order check (started_at is null or ended_at is null or ended_at >= started_at)
);

create index if not exists trips_organization_id_idx on public.trips (organization_id, started_at desc);
create index if not exists trips_bus_id_idx on public.trips (bus_id);

create table if not exists public.trip_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  trip_id uuid not null references public.trips (id) on delete cascade,
  kind text not null check (kind in ('diesel', 'expense')),
  category text not null,
  amount_inr integer not null check (amount_inr > 0),
  litres numeric(8, 2) check (litres is null or litres > 0),
  paid_by text not null default 'cash' check (paid_by in ('cash', 'credit')),
  pump text not null default '',
  note text not null default '',
  position integer not null default 0,
  constraint trip_items_category_matches_kind check (
    (kind = 'diesel' and category = 'diesel')
    or (
      kind = 'expense'
      and paid_by = 'cash'
      and category in (
        'pooja', 'driver_bata', 'cleaner_bata', 'toll', 'halt_bata', 'rto',
        'adblue', 'police', 'parking', 'tyre', 'mechanic', 'seat_wash',
        'grease', 'other'
      )
    )
  )
);

create index if not exists trip_items_trip_id_idx on public.trip_items (trip_id);

alter table public.trips enable row level security;
alter table public.trip_items enable row level security;
grant select, insert, update, delete on public.trips to authenticated;
grant select, insert, update, delete on public.trip_items to authenticated;

-- Admins and managers (including legacy role names) work with trips. Crew don't.
create or replace function public.is_trip_editor(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.get_user_role(org_id) in ('owner', 'admin', 'manager', 'fleet_manager', 'member'),
    false
  );
$$;

revoke all on function public.is_trip_editor(uuid) from public;
grant execute on function public.is_trip_editor(uuid) to authenticated;

drop policy if exists "Admins and managers manage trips" on public.trips;
create policy "Admins and managers manage trips"
  on public.trips
  for all
  to authenticated
  using (public.is_trip_editor(organization_id))
  with check (public.is_trip_editor(organization_id));

drop policy if exists "Admins and managers manage trip items" on public.trip_items;
create policy "Admins and managers manage trip items"
  on public.trip_items
  for all
  to authenticated
  using (public.is_trip_editor(organization_id))
  with check (
    public.is_trip_editor(organization_id)
    and exists (
      select 1 from public.trips as t
      where t.id = trip_id and t.organization_id = trip_items.organization_id
    )
  );

drop policy if exists "Overdue companies are view-only (trips)" on public.trips;
create policy "Overdue companies are view-only (trips)"
  on public.trips as restrictive
  for all
  to authenticated
  using (true)
  with check (public.org_in_good_standing(organization_id));

drop policy if exists "Overdue companies are view-only (trip delete)" on public.trips;
create policy "Overdue companies are view-only (trip delete)"
  on public.trips as restrictive
  for delete
  to authenticated
  using (public.org_in_good_standing(organization_id));

drop policy if exists "Overdue companies are view-only (trip items)" on public.trip_items;
create policy "Overdue companies are view-only (trip items)"
  on public.trip_items as restrictive
  for all
  to authenticated
  using (true)
  with check (public.org_in_good_standing(organization_id));

drop policy if exists "Overdue companies are view-only (trip item delete)" on public.trip_items;
create policy "Overdue companies are view-only (trip item delete)"
  on public.trip_items as restrictive
  for delete
  to authenticated
  using (public.org_in_good_standing(organization_id));

-- Approved trips are locked for managers; an admin can still correct them.
create or replace function public.guard_approved_trip()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_org uuid;
  v_status text;
begin
  if tg_table_name = 'trips' then
    v_trip_id := old.id;
    v_org := old.organization_id;
    v_status := old.status;
  else
    v_trip_id := coalesce(old.trip_id, new.trip_id);
    v_org := coalesce(old.organization_id, new.organization_id);
    select t.status into v_status from public.trips as t where t.id = v_trip_id;
  end if;

  if v_status = 'approved'
    and coalesce(public.get_user_role(v_org), '') not in ('owner', 'admin')
    and not public.is_super_admin()
  then
    raise exception 'This trip is approved. Only an admin can change it.';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_table_name = 'trips' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trips_guard_approved on public.trips;
create trigger trips_guard_approved
  before update or delete on public.trips
  for each row execute function public.guard_approved_trip();

drop trigger if exists trip_items_guard_approved on public.trip_items;
create trigger trip_items_guard_approved
  before insert or update or delete on public.trip_items
  for each row execute function public.guard_approved_trip();

-- Saves a trip and replaces its lines in one step. Runs as the caller, so the
-- policies above still decide who may save.
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
begin
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

  return v_id;
end;
$$;

revoke all on function public.save_trip(jsonb, jsonb, boolean) from public;
grant execute on function public.save_trip(jsonb, jsonb, boolean) to authenticated;

-- Photos of trip sheets, kept for audit. Files live under <organization id>/.
insert into storage.buckets (id, name, public)
values ('trip-sheets', 'trip-sheets', false)
on conflict (id) do nothing;

-- True when the first folder of a photo path is a company the caller can
-- record trips for. Uploads also need the company to be in good standing.
create or replace function public.can_use_trip_sheet_folder(folder text, for_upload boolean)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members as m
    where m.user_id = auth.uid()
      and m.organization_id::text = folder
      and public.is_trip_editor(m.organization_id)
      and (not for_upload or public.org_in_good_standing(m.organization_id))
  );
$$;

revoke all on function public.can_use_trip_sheet_folder(text, boolean) from public;
grant execute on function public.can_use_trip_sheet_folder(text, boolean) to authenticated;

drop policy if exists "Trip editors read trip sheet photos" on storage.objects;
create policy "Trip editors read trip sheet photos"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'trip-sheets'
    and public.can_use_trip_sheet_folder((storage.foldername(name))[1], false)
  );

drop policy if exists "Trip editors upload trip sheet photos" on storage.objects;
create policy "Trip editors upload trip sheet photos"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'trip-sheets'
    and public.can_use_trip_sheet_folder((storage.foldername(name))[1], true)
  );
