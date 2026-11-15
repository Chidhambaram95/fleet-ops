-- One call sets the crew for a whole day.
-- Run after 0030. Safe to run more than once.
--
-- "Same crew as yesterday" used to save one slot at a time from the browser,
-- so a failure half-way left a partly filled day. This function takes the
-- whole list and saves all of it or none of it.
--
-- p_rows is a JSON list of { "bus_id": "...", "duty": "driver", "person_id": "..." }.
-- An empty or missing person_id clears that job. It runs as the caller
-- (security invoker), so the day_crew policies and the check_day_crew,
-- guard_frozen and history triggers all still apply.

create or replace function public.set_day_crew(p_org uuid, p_day date, p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row jsonb;
  v_person uuid;
  v_count integer := 0;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Send the crew as a list.';
  end if;
  if jsonb_array_length(p_rows) > 200 then
    raise exception 'Too many crew rows in one save.';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_person := nullif(v_row ->> 'person_id', '')::uuid;
    if v_person is null then
      delete from public.day_crew
      where organization_id = p_org
        and day = p_day
        and bus_id = (v_row ->> 'bus_id')::uuid
        and duty = v_row ->> 'duty';
    else
      insert into public.day_crew (organization_id, day, bus_id, duty, person_id)
      values (p_org, p_day, (v_row ->> 'bus_id')::uuid, v_row ->> 'duty', v_person)
      on conflict (bus_id, day, duty) do update set person_id = excluded.person_id;
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.set_day_crew(uuid, date, jsonb) from public, anon;
grant execute on function public.set_day_crew(uuid, date, jsonb) to authenticated;
