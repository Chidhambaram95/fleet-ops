-- One call saves a day book entry together with its odometer reading.
-- Run after 0029. Safe to run more than once.
--
-- Today the app inserts the odometer reading first and the entry second. If
-- the entry then fails, the reading stays behind and the next diesel entry
-- can be refused for a km figure that was never really saved. This function
-- does both in one transaction, so either both are saved or neither.
--
-- It runs as the caller (security invoker), so every existing row rule still
-- applies: crew only for their own bus, managers only in their module,
-- overdue companies view-only, closed days frozen, and the odometer check.

create or replace function public.add_daily_entry(
  p_org uuid,
  p_bus uuid,
  p_date date,
  p_kind text,
  p_category text,
  p_amount_inr integer,
  p_note text default '',
  p_litres numeric default null,
  p_odometer_km integer default null,
  p_full_tank boolean default false,
  p_id uuid default gen_random_uuid()
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_odometer_km is not null then
    -- The check_odometer_reading trigger refuses a figure below the last one.
    insert into public.odometer_readings (organization_id, bus_id, odometer_km)
    values (p_org, p_bus, p_odometer_km);
  end if;

  insert into public.daily_entries (
    id, organization_id, bus_id, entry_date, kind, category, amount_inr, note,
    created_by, litres, odometer_km, full_tank
  )
  values (
    p_id, p_org, p_bus, p_date, p_kind, p_category, p_amount_inr, coalesce(p_note, ''),
    auth.uid(), p_litres, p_odometer_km, coalesce(p_full_tank, false)
  );

  return p_id;
end;
$$;

revoke all on function public.add_daily_entry(uuid, uuid, date, text, text, integer, text, numeric, integer, boolean, uuid) from public, anon;
grant execute on function public.add_daily_entry(uuid, uuid, date, text, text, integer, text, numeric, integer, boolean, uuid) to authenticated;
