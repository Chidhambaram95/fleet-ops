-- Scrap pile and scrap sales. Run after 0019. Safe to run more than once.
--
-- Removed tyres wait in a scrap pile (an in-stock tyre with scrap_pile_on
-- set) until enough are collected. One sale scraps them all together and
-- records the money as company income, received in cash or into the
-- company account. Any later move other than scrapping takes a tyre back
-- out of the pile.

alter table public.tyres
  add column if not exists scrap_pile_on date;

create table if not exists public.tyre_scrap_sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  sold_on date not null,
  buyer text not null default '',
  amount_inr integer not null check (amount_inr >= 0),
  received_via text not null default 'cash' check (received_via in ('cash', 'account')),
  tyre_count integer not null default 0 check (tyre_count >= 0),
  note text not null default '',
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists tyre_scrap_sales_org_idx on public.tyre_scrap_sales (organization_id, sold_on desc);

alter table public.tyre_events
  add column if not exists scrap_sale_id uuid references public.tyre_scrap_sales (id) on delete set null;

-- Read by admins and managers; written only through the functions below.
alter table public.tyre_scrap_sales enable row level security;
revoke all on public.tyre_scrap_sales from anon, authenticated;
grant select on public.tyre_scrap_sales to authenticated;

drop policy if exists "Admins and managers read" on public.tyre_scrap_sales;
create policy "Admins and managers read"
  on public.tyre_scrap_sales for select to authenticated
  using (public.is_trip_editor(organization_id));

-- A new move (fitted, sent for retread, repair...) takes the tyre off the pile.
create or replace function public.tyre_events_leave_scrap_pile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind <> 'scrapped' then
    update public.tyres set scrap_pile_on = null where id = new.tyre_id and scrap_pile_on is not null;
  end if;
  return new;
end;
$$;

drop trigger if exists tyre_events_leave_scrap_pile on public.tyre_events;
create trigger tyre_events_leave_scrap_pile
  after insert on public.tyre_events
  for each row execute function public.tyre_events_leave_scrap_pile();

-- A sold tyre comes back only by undoing the whole sale, so the amount
-- stays right. Deleting the tyre itself (cascade) is still allowed.
create or replace function public.tyre_events_keep_sales()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.scrap_sale_id is not null
    and coalesce(current_setting('fleet.undo_scrap_sale', true), '') <> 'on'
    and exists (select 1 from public.tyres where id = old.tyre_id)
  then
    raise exception 'This tyre was sold as scrap. Undo the scrap sale instead.';
  end if;
  return old;
end;
$$;

drop trigger if exists tyre_events_keep_sales on public.tyre_events;
create trigger tyre_events_keep_sales
  before delete on public.tyre_events
  for each row execute function public.tyre_events_keep_sales();

-- Put an in-stock tyre on the scrap pile, or take it back.
create or replace function public.tyre_scrap_pile(p_tyre uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tyres%rowtype;
begin
  select * into t from public.tyres where id = p_tyre for update;
  if not found or not public.is_trip_editor(t.organization_id) then
    raise exception 'Tyre not found.';
  end if;
  if not public.org_in_good_standing(t.organization_id) then
    raise exception 'This company is view-only until the payment is made.';
  end if;
  if p_on and t.status <> 'in_stock' then
    raise exception 'Only a tyre that is off the bus can go on the scrap pile.';
  end if;
  update public.tyres
  set scrap_pile_on = case when p_on then coalesce(scrap_pile_on, public.today_ist()) end
  where id = p_tyre;
end;
$$;

revoke all on function public.tyre_scrap_pile(uuid, boolean) from public;
grant execute on function public.tyre_scrap_pile(uuid, boolean) to authenticated;

-- Sell tyres as scrap together: each is scrapped and the money is one sale.
create or replace function public.tyre_sell_scrap(
  p_tyres uuid[],
  p_date date,
  p_buyer text,
  p_amount integer,
  p_via text,
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orgs integer;
  v_org uuid;
  v_sale uuid;
  v_event uuid;
  v_tyre uuid;
  v_count integer;
begin
  if p_tyres is null or cardinality(p_tyres) = 0 then
    raise exception 'Pick the tyres sold.';
  end if;
  select count(distinct organization_id), min(organization_id::text)::uuid, count(*)
  into v_orgs, v_org, v_count
  from public.tyres where id = any (p_tyres);
  if v_orgs <> 1 or v_count <> cardinality(array(select distinct unnest(p_tyres))) then
    raise exception 'Tyre not found.';
  end if;
  if not public.is_trip_editor(v_org) then
    raise exception 'Tyre not found.';
  end if;
  if not public.org_in_good_standing(v_org) then
    raise exception 'This company is view-only until the payment is made.';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'Enter the amount received.';
  end if;
  if p_via is null or p_via not in ('cash', 'account') then
    raise exception 'Pick cash or company account.';
  end if;
  if exists (select 1 from public.tyres where id = any (p_tyres) and status <> 'in_stock') then
    raise exception 'Only tyres that are off the bus can be sold as scrap.';
  end if;

  insert into public.tyre_scrap_sales (organization_id, sold_on, buyer, amount_inr, received_via, tyre_count, note)
  values (v_org, p_date, btrim(coalesce(p_buyer, '')), p_amount, p_via, v_count, btrim(coalesce(p_note, '')))
  returning id into v_sale;

  foreach v_tyre in array array(select distinct unnest(p_tyres)) loop
    -- tyre_move checks the date for each tyre.
    v_event := public.tyre_move(
      v_tyre, 'scrapped', p_date, null, null, null, null, btrim(coalesce(p_buyer, '')), 'Sold as scrap', ''
    );
    update public.tyre_events set scrap_sale_id = v_sale where id = v_event;
    update public.tyres set scrap_pile_on = null where id = v_tyre;
  end loop;
  return v_sale;
end;
$$;

revoke all on function public.tyre_sell_scrap(uuid[], date, text, integer, text, text) from public;
grant execute on function public.tyre_sell_scrap(uuid[], date, text, integer, text, text) to authenticated;

-- Undo a scrap sale, for mistakes: the tyres go back on the pile. Admins only.
create or replace function public.tyre_undo_scrap_sale(p_sale uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.tyre_scrap_sales%rowtype;
  e record;
begin
  select * into s from public.tyre_scrap_sales where id = p_sale for update;
  if not found or coalesce(public.get_user_role(s.organization_id) not in ('owner', 'admin'), true) then
    raise exception 'Only an admin can undo a scrap sale.';
  end if;
  if not public.org_in_good_standing(s.organization_id) then
    raise exception 'This company is view-only until the payment is made.';
  end if;
  for e in select id, tyre_id, seq from public.tyre_events where scrap_sale_id = p_sale loop
    if exists (select 1 from public.tyre_events where tyre_id = e.tyre_id and seq > e.seq) then
      raise exception 'A sold tyre has a later entry.';
    end if;
  end loop;
  perform set_config('fleet.undo_scrap_sale', 'on', true);
  for e in select id, tyre_id from public.tyre_events where scrap_sale_id = p_sale loop
    delete from public.tyre_events where id = e.id;
    perform public.tyre_rebuild(e.tyre_id);
    update public.tyres set scrap_pile_on = s.sold_on where id = e.tyre_id;
  end loop;
  perform set_config('fleet.undo_scrap_sale', '', true);
  delete from public.tyre_scrap_sales where id = p_sale;
end;
$$;

revoke all on function public.tyre_undo_scrap_sale(uuid) from public;
grant execute on function public.tyre_undo_scrap_sale(uuid) to authenticated;
