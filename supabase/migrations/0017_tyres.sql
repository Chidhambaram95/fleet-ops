-- Tyres: every tyre the company owns, and every move it makes (fitted,
-- rotated on the same bus, removed, sent for retread, back from retread,
-- repaired, scrapped).
-- Run after 0016. Safe to run more than once.
--
-- The events are the record; the tyre's status, bus, position, retread count
-- and costs are worked out from them by tyre_rebuild(). People never write
-- events directly: tyre_move() checks each move and tyre_undo_last() takes
-- the latest one back.
--
-- Costs (charge when fitted): the purchase price is charged to the first bus
-- the tyre is fitted on, and each retread bill to the bus it is fitted on
-- next. A repair is charged to the bus the tyre is on, or waits for the next
-- bus when the tyre is off. charge_inr on the event is what that bus pays,
-- on that day.

create table if not exists public.tyres (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  tyre_number text not null check (btrim(tyre_number) <> ''),
  brand text not null default '',
  size text not null default '',
  bought_as text not null default 'new' check (bought_as in ('new', 'retreaded')),
  purchase_date date not null,
  purchase_price_inr integer check (purchase_price_inr is null or purchase_price_inr >= 0),
  vendor text not null default '',
  bill_photo_path text not null default '',
  warranty_months integer check (warranty_months is null or warranty_months > 0),
  warranty_km integer check (warranty_km is null or warranty_km > 0),
  warranty_note text not null default '',
  note text not null default '',
  -- Worked out from the events by tyre_rebuild().
  status text not null default 'in_stock'
    check (status in ('in_stock', 'fitted', 'at_retreader', 'scrapped')),
  current_bus_id uuid references public.buses (id) on delete set null,
  current_position text,
  fitted_odometer_km integer,
  retread_count integer not null default 0,
  total_km integer not null default 0,
  -- Purchase, retread and off-bus repair money not yet charged to a bus.
  uncharged_inr integer not null default 0,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- Tyre numbers are unique in a company, ignoring case and spaces at the ends.
create unique index if not exists tyres_org_number_key
  on public.tyres (organization_id, lower(btrim(tyre_number)));
create index if not exists tyres_org_idx on public.tyres (organization_id, status);
-- One tyre per wheel position on a bus.
create unique index if not exists tyres_one_per_position
  on public.tyres (current_bus_id, current_position)
  where status = 'fitted';

create table if not exists public.tyre_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  tyre_id uuid not null references public.tyres (id) on delete cascade,
  kind text not null check (kind in (
    'fitted', 'rotated', 'removed', 'sent_for_retread', 'retread_received', 'repair', 'scrapped'
  )),
  event_date date not null,
  bus_id uuid references public.buses (id) on delete set null,
  -- Kept so the history still reads right after a bus is deleted.
  bus_label text not null default '',
  position text,
  -- Rotated: the position it moved from on the same bus.
  from_position text,
  odometer_km integer check (odometer_km is null or odometer_km >= 0),
  -- Removed or rotated: km run in the position it left. Worked out by tyre_rebuild().
  km_run integer,
  -- Money paid at this event (retread or repair bill).
  cost_inr integer check (cost_inr is null or cost_inr >= 0),
  -- What the bus on this event is charged, on event_date. Worked out by tyre_rebuild().
  charge_inr integer not null default 0,
  vendor text not null default '',
  reason text not null default '',
  note text not null default '',
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists tyre_events_tyre_idx on public.tyre_events (tyre_id, seq);
create index if not exists tyre_events_org_idx on public.tyre_events (organization_id, event_date);
create index if not exists tyre_events_bus_idx on public.tyre_events (bus_id, event_date);

-- Wheel positions: six road wheels, and as many spares as a bus needs.
create or replace function public.is_tyre_position(p_position text)
returns boolean
language sql
immutable
as $$
  select coalesce(
    p_position in (
      'front_left', 'front_right',
      'rear_left_outer', 'rear_left_inner', 'rear_right_inner', 'rear_right_outer'
    ) or p_position ~ '^spare_[1-9][0-9]?$',
    false
  );
$$;

alter table public.tyre_events drop constraint if exists tyre_events_position_check;
alter table public.tyre_events
  add constraint tyre_events_position_check
  check (position is null or public.is_tyre_position(position));

-- Security: admins and managers only, and overdue companies are view-only.
alter table public.tyres enable row level security;
alter table public.tyre_events enable row level security;

revoke all on public.tyres from anon, authenticated;
revoke all on public.tyre_events from anon, authenticated;
grant select, delete on public.tyres to authenticated;
grant insert (
  id, organization_id, tyre_number, brand, size, bought_as, purchase_date, purchase_price_inr,
  vendor, bill_photo_path, warranty_months, warranty_km, warranty_note, note
) on public.tyres to authenticated;
grant update (
  tyre_number, brand, size, bought_as, purchase_date, purchase_price_inr,
  vendor, bill_photo_path, warranty_months, warranty_km, warranty_note, note
) on public.tyres to authenticated;
grant select on public.tyre_events to authenticated;

drop policy if exists "Admins and managers manage" on public.tyres;
create policy "Admins and managers manage"
  on public.tyres for all to authenticated
  using (public.is_trip_editor(organization_id))
  with check (public.is_trip_editor(organization_id));

drop policy if exists "Only admins delete tyres" on public.tyres;
create policy "Only admins delete tyres"
  on public.tyres as restrictive for delete to authenticated
  using (public.get_user_role(organization_id) in ('owner', 'admin'));

drop policy if exists "Overdue companies are view-only" on public.tyres;
create policy "Overdue companies are view-only"
  on public.tyres as restrictive for all to authenticated
  using (true)
  with check (public.org_in_good_standing(organization_id));

drop policy if exists "Overdue companies are view-only (delete)" on public.tyres;
create policy "Overdue companies are view-only (delete)"
  on public.tyres as restrictive for delete to authenticated
  using (public.org_in_good_standing(organization_id));

drop policy if exists "Admins and managers read" on public.tyre_events;
create policy "Admins and managers read"
  on public.tyre_events for select to authenticated
  using (public.is_trip_editor(organization_id));

-- Replays a tyre's events in order and stores where it is now, its km,
-- retread count and costs. Raises if the events are not in a possible order.
create or replace function public.tyre_rebuild(p_tyre uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tyres%rowtype;
  e record;
  v_status text := 'in_stock';
  v_bus uuid;
  v_position text;
  v_fit_odo integer;
  -- Latest reading on the bus it is on; readings never go backwards.
  v_last_odo integer;
  v_retreads integer := 0;
  v_total integer := 0;
  v_uncharged integer;
  v_km integer;
  v_charge integer;
begin
  select * into t from public.tyres where id = p_tyre for update;
  if not found then
    return;
  end if;
  v_uncharged := coalesce(t.purchase_price_inr, 0);

  for e in
    select * from public.tyre_events where tyre_id = p_tyre order by seq
  loop
    v_km := null;
    v_charge := 0;
    if v_status = 'scrapped' then
      raise exception 'This tyre is scrapped.';
    end if;
    case e.kind
      when 'fitted' then
        if v_status <> 'in_stock' then
          raise exception 'Only a tyre in stock can be fitted. Remove it first.';
        end if;
        v_status := 'fitted';
        v_bus := e.bus_id;
        v_position := e.position;
        v_fit_odo := e.odometer_km;
        v_last_odo := e.odometer_km;
        v_charge := v_uncharged;
        v_uncharged := 0;
      when 'removed', 'rotated' then
        if v_status <> 'fitted' then
          raise exception 'This tyre is not fitted.';
        end if;
        if e.odometer_km is not null and v_last_odo is not null and e.odometer_km < v_last_odo then
          raise exception 'The odometer (%) is less than the last reading on this bus (%).', e.odometer_km, v_last_odo;
        end if;
        v_last_odo := coalesce(e.odometer_km, v_last_odo);
        if v_position like 'spare_%' then
          -- A spare does not run, whatever the odometer did.
          v_km := 0;
        elsif e.odometer_km is not null and v_fit_odo is not null then
          if e.odometer_km < v_fit_odo then
            raise exception 'The odometer (%) is less than when the tyre was fitted (%).', e.odometer_km, v_fit_odo;
          end if;
          v_km := e.odometer_km - v_fit_odo;
        end if;
        v_total := v_total + coalesce(v_km, 0);
        if e.kind = 'rotated' then
          -- Same bus, new position. With no odometer the km carry on from the last reading.
          -- Coming off a spare spot with no reading, the km are unknown until the next one.
          if e.odometer_km is not null then
            v_fit_odo := e.odometer_km;
          elsif v_position like 'spare_%' then
            v_fit_odo := null;
          end if;
          v_position := e.position;
        else
          v_status := 'in_stock';
          v_bus := null;
          v_position := null;
          v_fit_odo := null;
          v_last_odo := null;
        end if;
      when 'sent_for_retread' then
        if v_status <> 'in_stock' then
          raise exception 'Remove the tyre before sending it for retread.';
        end if;
        v_status := 'at_retreader';
      when 'retread_received' then
        if v_status <> 'at_retreader' then
          raise exception 'This tyre is not at the retreader.';
        end if;
        v_status := 'in_stock';
        v_retreads := v_retreads + 1;
        v_uncharged := v_uncharged + coalesce(e.cost_inr, 0);
      when 'repair' then
        if v_status = 'fitted' then
          v_charge := coalesce(e.cost_inr, 0);
        else
          v_uncharged := v_uncharged + coalesce(e.cost_inr, 0);
        end if;
      when 'scrapped' then
        if v_status = 'fitted' then
          raise exception 'Remove the tyre before scrapping it.';
        end if;
        v_status := 'scrapped';
    end case;

    update public.tyre_events
    set km_run = v_km,
        charge_inr = v_charge
    where id = e.id
      and (km_run is distinct from v_km or charge_inr is distinct from v_charge);
  end loop;

  update public.tyres
  set status = v_status,
      current_bus_id = v_bus,
      current_position = v_position,
      fitted_odometer_km = v_fit_odo,
      retread_count = v_retreads,
      total_km = v_total,
      uncharged_inr = v_uncharged
  where id = p_tyre;
end;
$$;

revoke all on function public.tyre_rebuild(uuid) from public;

-- One move of a tyre. Checks the person, the company, the date, the bus and
-- the position, writes the event and brings the tyre up to date.
create or replace function public.tyre_move(
  p_tyre uuid,
  p_kind text,
  p_date date,
  p_bus uuid default null,
  p_position text default null,
  p_odometer integer default null,
  p_cost integer default null,
  p_vendor text default '',
  p_reason text default '',
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tyres%rowtype;
  v_last date;
  v_bus uuid;
  v_position text;
  v_label text := '';
  v_id uuid;
  v_other uuid;
begin
  select * into t from public.tyres where id = p_tyre for update;
  if not found or not public.is_trip_editor(t.organization_id) then
    raise exception 'Tyre not found.';
  end if;
  if not public.org_in_good_standing(t.organization_id) then
    raise exception 'This company is view-only until the payment is made.';
  end if;
  if p_kind not in ('fitted', 'rotated', 'removed', 'sent_for_retread', 'retread_received', 'repair', 'scrapped') then
    raise exception 'Unknown tyre move.';
  end if;
  if p_date is null then
    raise exception 'Enter the date.';
  end if;
  if p_date > public.today_ist() then
    raise exception 'The date cannot be in the future.';
  end if;
  if p_date < t.purchase_date then
    raise exception 'The date is before the tyre was bought.';
  end if;
  select max(event_date) into v_last from public.tyre_events where tyre_id = p_tyre;
  if v_last is not null and p_date < v_last then
    raise exception 'The date cannot be before the last entry (%).', to_char(v_last, 'DD Mon YYYY');
  end if;
  if p_odometer is not null and p_odometer < 0 then
    raise exception 'Enter the odometer in km.';
  end if;
  if p_cost is not null and p_cost < 0 then
    raise exception 'Enter the amount in rupees.';
  end if;

  if p_kind = 'fitted' then
    if p_bus is null then
      raise exception 'Pick the bus.';
    end if;
    if not public.is_tyre_position(p_position) then
      raise exception 'Pick the wheel position.';
    end if;
    select registration_number into v_label
    from public.buses where id = p_bus and organization_id = t.organization_id;
    if not found then
      raise exception 'That bus is not in this company.';
    end if;
    if exists (
      select 1 from public.tyres
      where current_bus_id = p_bus and current_position = p_position
        and status = 'fitted' and id <> p_tyre
    ) then
      raise exception 'Another tyre is already fitted there. Remove it first.';
    end if;
    v_bus := p_bus;
    v_position := p_position;
  elsif p_kind = 'rotated' then
    if t.status <> 'fitted' then
      raise exception 'Only a fitted tyre can be rotated.';
    end if;
    if not public.is_tyre_position(p_position) or p_position = t.current_position then
      raise exception 'Pick the new position on this bus.';
    end if;
    v_bus := t.current_bus_id;
    v_position := p_position;
    select registration_number into v_label from public.buses where id = v_bus;
    -- A tyre already in that spot swaps into this one's old spot.
    select id into v_other from public.tyres
    where current_bus_id = v_bus and current_position = p_position
      and status = 'fitted' and id <> p_tyre
    for update;
    if v_other is not null and exists (
      select 1 from public.tyre_events where tyre_id = v_other and event_date > p_date
    ) then
      raise exception 'The other tyre has a later entry. Pick a later date.';
    end if;
  elsif p_kind in ('removed', 'repair') and t.status = 'fitted' then
    -- These happen on the bus the tyre is on.
    v_bus := t.current_bus_id;
    v_position := t.current_position;
    select registration_number into v_label from public.buses where id = v_bus;
  end if;

  insert into public.tyre_events (
    organization_id, tyre_id, kind, event_date, bus_id, bus_label, position, from_position,
    odometer_km, cost_inr, vendor, reason, note
  ) values (
    t.organization_id, p_tyre, p_kind, p_date, v_bus, coalesce(v_label, ''), v_position,
    case when p_kind = 'rotated' then t.current_position end,
    case when p_kind in ('fitted', 'rotated', 'removed') then p_odometer end,
    case when p_kind in ('retread_received', 'repair', 'sent_for_retread') then p_cost end,
    btrim(coalesce(p_vendor, '')), btrim(coalesce(p_reason, '')), btrim(coalesce(p_note, ''))
  )
  returning id into v_id;

  if v_other is not null then
    insert into public.tyre_events (
      organization_id, tyre_id, kind, event_date, bus_id, bus_label, position, from_position,
      odometer_km, reason, note
    ) values (
      t.organization_id, v_other, 'rotated', p_date, v_bus, coalesce(v_label, ''),
      t.current_position, p_position, p_odometer,
      btrim(coalesce(p_reason, '')), btrim(coalesce(p_note, ''))
    );
    -- Free the spot first so the two can trade places.
    update public.tyres set current_position = null where id = v_other;
    perform public.tyre_rebuild(p_tyre);
    perform public.tyre_rebuild(v_other);
  else
    perform public.tyre_rebuild(p_tyre);
  end if;
  return v_id;
end;
$$;

revoke all on function public.tyre_move(uuid, text, date, uuid, text, integer, integer, text, text, text) from public;
grant execute on function public.tyre_move(uuid, text, date, uuid, text, integer, integer, text, text, text) to authenticated;

-- Takes back the latest move, for mistakes. Admins only.
create or replace function public.tyre_undo_last(p_tyre uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tyres%rowtype;
  v_last uuid;
  v_kind text;
  v_bus uuid;
  v_position text;
  v_from text;
  v_date date;
  v_other uuid;
  v_other_event uuid;
begin
  select * into t from public.tyres where id = p_tyre for update;
  if not found or coalesce(public.get_user_role(t.organization_id) not in ('owner', 'admin'), true) then
    raise exception 'Only an admin can undo a tyre entry.';
  end if;
  if not public.org_in_good_standing(t.organization_id) then
    raise exception 'This company is view-only until the payment is made.';
  end if;
  select id, kind, bus_id, position, from_position, event_date
  into v_last, v_kind, v_bus, v_position, v_from, v_date
  from public.tyre_events where tyre_id = p_tyre order by seq desc limit 1;
  if v_last is null then
    raise exception 'Nothing to undo.';
  end if;
  if v_kind = 'rotated' then
    select id into v_other from public.tyres
    where current_bus_id = v_bus and current_position = v_from
      and status = 'fitted' and id <> p_tyre
    for update;
    if v_other is not null then
      -- A swap: undo the other tyre's half too, if it is still its latest entry.
      select e.id into v_other_event
      from public.tyre_events as e
      where e.tyre_id = v_other
        and e.seq = (select max(seq) from public.tyre_events where tyre_id = v_other)
        and e.kind = 'rotated' and e.from_position = v_position and e.position = v_from
        and e.event_date = v_date;
      if v_other_event is null then
        raise exception 'Another tyre is now in the old position.';
      end if;
      delete from public.tyre_events where id in (v_last, v_other_event);
      update public.tyres set current_position = null where id = v_other;
      perform public.tyre_rebuild(p_tyre);
      perform public.tyre_rebuild(v_other);
      return;
    end if;
  end if;
  -- Undoing a removal puts the tyre back where it was, if that spot is still free.
  if v_kind = 'removed' and exists (
    select 1 from public.tyres
    where current_bus_id = v_bus and current_position = v_position
      and status = 'fitted' and id <> p_tyre
  ) then
    raise exception 'Another tyre is now fitted in that position.';
  end if;
  delete from public.tyre_events where id = v_last;
  perform public.tyre_rebuild(p_tyre);
end;
$$;

revoke all on function public.tyre_undo_last(uuid) from public;
grant execute on function public.tyre_undo_last(uuid) to authenticated;

-- A changed purchase price changes what the first bus was charged.
create or replace function public.tyres_after_price_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.tyre_rebuild(new.id);
  return null;
end;
$$;

drop trigger if exists tyres_price_change on public.tyres;
create trigger tyres_price_change
  after insert or update of purchase_price_inr on public.tyres
  for each row execute function public.tyres_after_price_change();

-- Deleting a bus takes its tyres off and puts them back in stock. The
-- history keeps the bus number. Skipped when the whole company is deleted.
create or replace function public.buses_release_tyres()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
begin
  if not exists (select 1 from public.organizations where id = old.organization_id) then
    return old;
  end if;
  for t in
    select id from public.tyres where current_bus_id = old.id and status = 'fitted'
  loop
    insert into public.tyre_events (
      organization_id, tyre_id, kind, event_date, bus_id, bus_label, position, reason
    )
    select old.organization_id, t.id, 'removed',
      greatest(public.today_ist(), coalesce(max(e.event_date), public.today_ist())),
      old.id, old.registration_number, ty.current_position, 'Bus deleted'
    from public.tyres as ty
    left join public.tyre_events as e on e.tyre_id = ty.id
    where ty.id = t.id
    group by ty.current_position;
    perform public.tyre_rebuild(t.id);
  end loop;
  return old;
end;
$$;

drop trigger if exists buses_release_tyres on public.buses;
create trigger buses_release_tyres
  before delete on public.buses
  for each row execute function public.buses_release_tyres();

-- Tyre bills are now entered on the Tyres screen; old "Tyre / retread"
-- company costs stay as they are. Bill photos go in the private trip-sheets
-- bucket under <organization id>/tyres/, so the same storage rules apply.
