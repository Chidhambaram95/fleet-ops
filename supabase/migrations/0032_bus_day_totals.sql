-- Money in and out per bus per day, added up in the database.
-- Run after 0031. Safe to run more than once.
--
-- Reports and the Overview download every day book row for the company and
-- add them up in the browser, with a row cap (20,000 for reports). When the
-- cap is hit the totals are silently wrong. This function adds up in SQL, for
-- one module and a date range, so there is no row cap.
--
-- It runs as the caller (security invoker), so the daily_entries row rules
-- decide what is counted: crew see nothing, a manager sees only their module.

create index if not exists daily_entries_org_date_idx
  on public.daily_entries (organization_id, entry_date);

create or replace function public.bus_day_totals(
  p_org uuid,
  p_module text,
  p_from date,
  p_to date
)
returns table (bus_id uuid, day date, income_inr bigint, expense_inr bigint, entries bigint)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Pick a start date that is not after the end date.';
  end if;
  if p_to - p_from > 731 then
    raise exception 'Pick a range of two years or less.';
  end if;

  return query
  select e.bus_id,
         e.entry_date,
         coalesce(sum(e.amount_inr) filter (where e.kind = 'income'), 0)::bigint,
         coalesce(sum(e.amount_inr) filter (where e.kind = 'expense'), 0)::bigint,
         count(*)::bigint
  from public.daily_entries as e
  join public.buses as b on b.id = e.bus_id
  where e.organization_id = p_org
    and b.organization_id = p_org
    and (p_module is null or b.bus_type = p_module)
    and e.entry_date between p_from and p_to
  group by e.bus_id, e.entry_date
  order by e.entry_date, e.bus_id;
end;
$$;

revoke all on function public.bus_day_totals(uuid, text, date, date) from public, anon;
grant execute on function public.bus_day_totals(uuid, text, date, date) to authenticated;
