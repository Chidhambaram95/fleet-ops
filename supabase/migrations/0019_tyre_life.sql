-- Tyre health on the chassis view. Run after 0018. Safe to run more than once.
--
-- Each tyre life (as bought, then after each retread) has an expected km.
-- A new tyre uses its warranty km, else the company's new-tyre default; a
-- retread uses the warranty km the retreader gave, else the retread default.
-- life_km is the km run in the current life over finished stints; the app
-- adds the current stint from the latest odometer.

alter table public.organizations
  add column if not exists tyre_new_life_km integer not null default 80000,
  add column if not exists tyre_retread_life_km integer not null default 40000;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_tyre_life_check') then
    alter table public.organizations
      add constraint organizations_tyre_life_check
      check (tyre_new_life_km between 1000 and 1000000 and tyre_retread_life_km between 1000 and 1000000);
  end if;
end;
$$;

-- Company admins set the defaults in Company settings.
grant update (tyre_new_life_km, tyre_retread_life_km) on public.organizations to authenticated;

alter table public.tyres
  add column if not exists life_km integer not null default 0,
  add column if not exists life_limit_km integer;

-- Back from retread: the retreader's warranty, if any.
alter table public.tyre_events
  add column if not exists warranty_km integer check (warranty_km is null or warranty_km > 0),
  add column if not exists warranty_months integer check (warranty_months is null or warranty_months > 0);

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
  -- The current life: km since it was bought or last came back from retread.
  v_life_km integer := 0;
  v_life_limit integer;
begin
  select * into t from public.tyres where id = p_tyre for update;
  if not found then
    return;
  end if;
  v_uncharged := coalesce(t.purchase_price_inr, 0);
  v_life_limit := t.warranty_km;

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
        v_life_km := v_life_km + coalesce(v_km, 0);
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
        v_life_km := 0;
        v_life_limit := e.warranty_km;
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
      uncharged_inr = v_uncharged,
      life_km = v_life_km,
      life_limit_km = v_life_limit
  where id = p_tyre;
end;
$$;

revoke all on function public.tyre_rebuild(uuid) from public;

-- Records the retreader's warranty on a "back from retread" entry.
create or replace function public.tyre_set_retread_warranty(p_event uuid, p_km integer, p_months integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.tyre_events%rowtype;
begin
  select * into e from public.tyre_events where id = p_event;
  if not found or not public.is_trip_editor(e.organization_id) then
    raise exception 'Entry not found.';
  end if;
  if not public.org_in_good_standing(e.organization_id) then
    raise exception 'This company is view-only until the payment is made.';
  end if;
  if e.kind <> 'retread_received' then
    raise exception 'Only a retread can have a retread warranty.';
  end if;
  if (p_km is not null and p_km <= 0) or (p_months is not null and p_months <= 0) then
    raise exception 'Enter the warranty in km or months.';
  end if;
  update public.tyre_events set warranty_km = p_km, warranty_months = p_months where id = p_event;
  perform public.tyre_rebuild(e.tyre_id);
end;
$$;

revoke all on function public.tyre_set_retread_warranty(uuid, integer, integer) from public;
grant execute on function public.tyre_set_retread_warranty(uuid, integer, integer) to authenticated;

-- Fill in life_km and life_limit_km for tyres already entered.
select public.tyre_rebuild(id) from public.tyres;
