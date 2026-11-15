-- Function privileges: closes the two ways around the row rules found in the
-- November 2026 audit. Run after 0028. Safe to run more than once.
--
-- 1. Earlier migrations wrote `revoke all on function ... from public`. On
--    Supabase that does not lock a function: the platform also grants EXECUTE
--    straight to the anon and authenticated roles, and those grants stayed.
--    So anyone holding the public anon key could call functions that were
--    meant to be internal, such as write_history and trip_snapshot.
-- 2. ensure_personal_organization (0005) was a development helper. It let any
--    signed-in login make its own company, outside billing and the bus limit.
--
-- After this migration:
--   * anon can run one function only: get_invite (the signed-out invite page).
--   * signed-in users keep the functions the app and the row rules call.
--   * internal helpers and trigger functions cannot be called directly.
--   * write_history and trip_snapshot check the caller themselves, because
--     save_trip (which runs as the caller) still needs to reach them.
--
-- It also puts day_crew back into row_module (see below).

-- The development helper is gone. Companies are made by create_company only.
drop function if exists public.ensure_personal_organization();

-- A trip sheet with all its lines, as history keeps it. Only for an admin or
-- manager of the trip's company, or the super-admin.
create or replace function public.trip_snapshot(p_trip uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(t) || jsonb_build_object(
    'items',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'kind', i.kind, 'category', i.category, 'amount_inr', i.amount_inr,
          'litres', i.litres, 'paid_by', i.paid_by, 'pump', i.pump, 'note', i.note
        )
        order by i.position
      )
      from public.trip_items as i
      where i.trip_id = t.id
    ), '[]'::jsonb)
  )
  from public.trips as t
  where t.id = p_trip
    and (public.is_trip_editor(t.organization_id) or public.is_super_admin());
$$;

-- History rows are written by the record_change and record_trip_delete
-- triggers, and by save_trip for a trip sheet. Nothing else may write them.
create or replace function public.write_history(
  p_table text,
  p_action text,
  p_old jsonb,
  p_new jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb := coalesce(p_new, p_old);
  v_org uuid := (v_row ->> 'organization_id')::uuid;
  v_key record;
  v_reason text := '';
begin
  -- Called directly (not from a trigger): only save_trip does that, for a
  -- trip sheet, as an admin or manager of that company.
  if pg_trigger_depth() = 0
    and not (p_table = 'trips' and coalesce(public.is_trip_editor(v_org), false))
  then
    raise exception 'History is written by the app only.';
  end if;
  -- The company is being deleted: nothing to keep.
  if not exists (select 1 from public.organizations where id = v_org) then
    return;
  end if;
  select * into v_key from public.freeze_key(p_table, v_row);
  if v_key.k_day is not null and public.is_day_frozen(v_org, v_key.k_day) then
    v_reason := coalesce(public.active_unlock_reason(v_org, v_key.k_day, v_key.k_trip), '');
  end if;
  insert into public.audit_log (
    organization_id, table_name, row_id, action, bus_id, module, changed_by, reason, old_data, new_data
  )
  values (
    v_org,
    p_table,
    nullif(v_row ->> 'id', '')::uuid,
    p_action,
    nullif(v_row ->> 'bus_id', '')::uuid,
    public.row_module(p_table, v_row),
    auth.uid(),
    v_reason,
    p_old,
    p_new
  );
  -- History is kept for one year.
  if random() < 0.02 then
    delete from public.audit_log
    where organization_id = v_org and changed_at < now() - interval '1 year';
  end if;
end;
$$;

-- Which module a history row belongs to. 0027 rewrote this for loans and
-- dropped day_crew, which 0023 had added, so a manager limited to one module
-- stopped seeing day crew changes in the history. day_crew is back.
create or replace function public.row_module(p_table text, p_row jsonb)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_table in ('daily_entries', 'trips', 'renewals', 'day_crew') and p_row ->> 'bus_id' is not null
      then public.bus_module((p_row ->> 'bus_id')::uuid)
    when p_table = 'renewals' then public.person_module((p_row ->> 'person_id')::uuid)
    when p_table in ('pump_statements', 'pump_payments', 'crew_people') then p_row ->> 'module'
    when p_table = 'salary_payments' then public.person_module((p_row ->> 'person_id')::uuid)
    when p_table in ('tour_bookings', 'tour_payments') then 'tour'
    when p_table = 'intercity_income' then 'omni'
    when p_table = 'bus_loans' then (
      select min(public.bus_module(x.id::uuid)) from jsonb_array_elements_text(p_row -> 'bus_ids') as x(id)
      having count(distinct public.bus_module(x.id::uuid)) = 1
    )
    when p_table = 'loan_emis' then (
      select min(public.bus_module(x.id)) from unnest(public.loan_bus_ids((p_row ->> 'loan_id')::uuid)) as x(id)
      having count(distinct public.bus_module(x.id)) = 1
    )
    else null
  end;
$$;

-- Privileges on every function in public.
do $$
declare
  f record;
  -- Reached only from triggers or from other security definer functions.
  internal constant text[] := array[
    'tyre_rebuild', 'freeze_key', 'row_is_locked', 'row_module', 'login_lookup'
  ];
begin
  for f in
    select
      p.oid::regprocedure as sig,
      p.proname as name,
      p.prorettype = 'trigger'::regtype as is_trigger,
      has_function_privilege('authenticated', p.oid, 'execute') as signed_in
    from pg_proc as p
    join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    if f.is_trigger or f.name = any (internal) then
      -- Trigger functions need no EXECUTE to fire.
      execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    else
      -- Keep signed-in callers by a grant of their own, so that taking
      -- EXECUTE from public below cannot remove it.
      if f.signed_in then
        execute format('grant execute on function %s to authenticated', f.sig);
      end if;
      execute format('revoke execute on function %s from public, anon', f.sig);
    end if;
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

-- The invite page reads an invite before the person has a login.
grant execute on function public.get_invite(text) to anon;

-- New functions are no longer handed to anon when they are created. A later
-- migration must still write `revoke ... from public` and grant to
-- authenticated, as before; supabase/tests/0029 fails if one forgets.
alter default privileges in schema public revoke execute on functions from anon;
