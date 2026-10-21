-- Tour module: enquiries, quotes, bookings and customer payments.
-- Run after 0015. Safe to run more than once.

-- Company defaults for tour quotes (the company admin changes them).
alter table public.organizations
  add column if not exists tour_quote_valid_days integer not null default 3,
  add column if not exists tour_advance_percent integer not null default 25,
  add column if not exists tour_turnaround_hours integer not null default 3;

alter table public.organizations drop constraint if exists organizations_tour_defaults_check;
alter table public.organizations
  add constraint organizations_tour_defaults_check check (
    tour_quote_valid_days between 1 and 60
    and tour_advance_percent between 0 and 100
    and tour_turnaround_hours between 0 and 24
  );

grant update (tour_quote_valid_days, tour_advance_percent, tour_turnaround_hours)
  on public.organizations to authenticated;

-- Two more costs a tour sheet can have.
alter table public.trip_items drop constraint if exists trip_items_category_matches_kind;
alter table public.trip_items
  add constraint trip_items_category_matches_kind check (
    (kind = 'diesel' and category = 'diesel')
    or (
      kind = 'expense'
      and paid_by = 'cash'
      and category in (
        'pooja', 'driver_bata', 'cleaner_bata', 'toll', 'halt_bata', 'rto',
        'adblue', 'police', 'parking', 'tyre', 'mechanic', 'seat_wash',
        'grease', 'interstate_permit', 'guide_commission', 'other'
      )
    )
  );

-- One row per customer enquiry; it moves on to a quote, a booking and a finished tour.
create table if not exists public.tour_bookings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  quote_no integer not null default 0,
  status text not null default 'enquiry'
    check (status in ('enquiry', 'quoted', 'confirmed', 'completed', 'cancelled')),
  customer_name text not null check (length(trim(customer_name)) > 0),
  customer_phone text not null default '',
  pickup text not null default '',
  drop_place text not null default '',
  seats_needed integer check (seats_needed is null or seats_needed > 0),
  start_date date not null,
  end_date date not null,
  -- Exact times are optional; without them the booking counts as whole days.
  start_at timestamptz,
  end_at timestamptz,
  bus_id uuid references public.buses (id) on delete set null,
  hire_amount_inr integer not null default 0 check (hire_amount_inr >= 0),
  advance_required_inr integer not null default 0 check (advance_required_inr >= 0),
  inclusions text not null default '',
  quote_valid_until date,
  quote_sent_at timestamptz,
  trip_id uuid references public.trips (id) on delete set null,
  note text not null default '',
  cancelled_reason text not null default '',
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tour_bookings_dates_check check (end_date >= start_date),
  constraint tour_bookings_times_check check (start_at is null or end_at is null or end_at > start_at)
);

create table if not exists public.tour_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  booking_id uuid not null references public.tour_bookings (id) on delete cascade,
  received_on date not null,
  amount_inr integer not null check (amount_inr > 0),
  mode text not null default 'cash' check (mode in ('cash', 'upi', 'bank')),
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists tour_bookings_org_idx on public.tour_bookings (organization_id, start_date desc);
create index if not exists tour_bookings_bus_idx on public.tour_bookings (bus_id, start_date);
create index if not exists tour_payments_booking_idx on public.tour_payments (booking_id);

-- Admins and managers only; an overdue company becomes view-only.
do $$
declare
  t text;
begin
  foreach t in array array['tour_bookings', 'tour_payments']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists "Admins and managers manage" on public.%I', t);
    execute format(
      'create policy "Admins and managers manage" on public.%I for all to authenticated
         using (public.is_trip_editor(organization_id))
         with check (public.is_trip_editor(organization_id))', t);
    execute format('drop policy if exists "Overdue companies are view-only" on public.%I', t);
    execute format(
      'create policy "Overdue companies are view-only" on public.%I as restrictive for all to authenticated
         using (true)
         with check (public.org_in_good_standing(organization_id))', t);
    execute format('drop policy if exists "Overdue companies are view-only (delete)" on public.%I', t);
    execute format(
      'create policy "Overdue companies are view-only (delete)" on public.%I as restrictive for delete to authenticated
         using (public.org_in_good_standing(organization_id))', t);
  end loop;
end;
$$;

-- Quote numbers count up inside each company, starting at 1001.
create or replace function public.tour_booking_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and coalesce(new.quote_no, 0) = 0 then
    select coalesce(max(quote_no), 1000) + 1 into new.quote_no
    from public.tour_bookings where organization_id = new.organization_id;
  end if;
  new.updated_at := now();

  if new.bus_id is not null then
    if not exists (
      select 1 from public.buses
      where id = new.bus_id and organization_id = new.organization_id and bus_type = 'tour'
    ) then
      raise exception 'Pick one of your tour buses.';
    end if;
  end if;

  -- A confirmed booking needs a bus, and two confirmed bookings with exact
  -- times can't overlap on one bus. Same-day turnarounds are allowed.
  if new.status = 'confirmed' then
    if new.bus_id is null then
      raise exception 'Choose a bus to confirm this booking.';
    end if;
    if new.start_at is not null and new.end_at is not null and exists (
      select 1 from public.tour_bookings as o
      where o.bus_id = new.bus_id
        and o.id <> new.id
        and o.status = 'confirmed'
        and o.start_at is not null and o.end_at is not null
        and o.start_at < new.end_at and new.start_at < o.end_at
    ) then
      raise exception 'This bus is already booked for those times.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tour_bookings_before_write on public.tour_bookings;
create trigger tour_bookings_before_write
  before insert or update on public.tour_bookings
  for each row execute function public.tour_booking_before_write();

-- A payment belongs to a booking of the same company.
create or replace function public.check_tour_payment_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.tour_bookings
    where id = new.booking_id and organization_id = new.organization_id
  ) then
    raise exception 'That booking is not in this company.';
  end if;
  return new;
end;
$$;

drop trigger if exists tour_payments_check_booking on public.tour_payments;
create trigger tour_payments_check_booking
  before insert or update of booking_id, organization_id on public.tour_payments
  for each row execute function public.check_tour_payment_booking();

-- The linked trip must be one of this company's trips.
create or replace function public.check_tour_booking_trip()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.trip_id is not null and not exists (
    select 1 from public.trips where id = new.trip_id and organization_id = new.organization_id
  ) then
    raise exception 'That trip is not in this company.';
  end if;
  return new;
end;
$$;

drop trigger if exists tour_bookings_check_trip on public.tour_bookings;
create trigger tour_bookings_check_trip
  before insert or update of trip_id, organization_id on public.tour_bookings
  for each row execute function public.check_tour_booking_trip();

-- Tour buses are for admins and managers: crew can't be given one.
create or replace function public.block_crew_on_tour_bus()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.bus_id is not null and exists (
    select 1 from public.buses where id = new.bus_id and bus_type = 'tour'
  ) then
    raise exception 'Tour buses are for admins and managers only. Pick another bus for crew.';
  end if;
  return new;
end;
$$;

drop trigger if exists crew_assignments_no_tour_bus on public.crew_assignments;
create trigger crew_assignments_no_tour_bus
  before insert or update of bus_id on public.crew_assignments
  for each row execute function public.block_crew_on_tour_bus();

create or replace function public.block_crew_invite_on_tour_bus()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'crew' and new.bus_id is not null and exists (
    select 1 from public.buses where id = new.bus_id and bus_type = 'tour'
  ) then
    raise exception 'Tour buses are for admins and managers only. Pick another bus for crew.';
  end if;
  return new;
end;
$$;

drop trigger if exists org_invites_no_tour_bus on public.org_invites;
create trigger org_invites_no_tour_bus
  before insert or update of bus_id, role on public.org_invites
  for each row execute function public.block_crew_invite_on_tour_bus();
