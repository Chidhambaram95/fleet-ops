-- A list of what stops a day from closing.
-- Run after 0032. Safe to run more than once.
--
-- close_day had one hardcoded check (Town buses with entries need a driver
-- and a conductor). Now the checks live in day_close_blockers, which returns
-- one row per problem: a code the app can act on, the bus it is about (if
-- any) and a sentence to show. close_day refuses when the list is not empty.
-- A later check (for example "every conductor is settled") is one more
-- union branch here, with no change to close_day or the screen.

create or replace function public.day_close_blockers(p_org uuid, p_day date)
returns table (code text, bus_id uuid, detail text)
language sql
stable
security definer
set search_path = public
as $$
  select 'crew_missing'::text,
         m.bus_id,
         m.registration_number || ' (' || array_to_string(m.missing, ' and ') || ')'
  from public.town_day_crew_missing(p_org, p_day) as m
  where public.is_trip_editor(p_org) or public.is_super_admin();
$$;

revoke all on function public.day_close_blockers(uuid, date) from public, anon;
grant execute on function public.day_close_blockers(uuid, date) to authenticated;

-- Same as 0023, but reads the list instead of one fixed check.
create or replace function public.close_day(p_org uuid, p_day date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_blockers text;
begin
  if not public.is_trip_editor(p_org) then
    raise exception 'Only an admin or manager can close a day.';
  end if;
  if p_day is null or p_day > public.today_ist() then
    raise exception 'You can close today or an earlier day.';
  end if;
  select string_agg(b.detail, ', ' order by b.detail)
  into v_blockers
  from public.day_close_blockers(p_org, p_day) as b;
  if v_blockers is not null then
    raise exception 'The day cannot be closed yet: %.', v_blockers;
  end if;
  insert into public.closed_days (organization_id, day)
  values (p_org, p_day)
  on conflict (organization_id, day) do nothing;
end;
$$;

revoke all on function public.close_day(uuid, date) from public, anon;
grant execute on function public.close_day(uuid, date) to authenticated;
