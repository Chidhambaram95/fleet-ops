-- Tyre warranty claims. Run after 0020. Safe to run more than once.
--
-- A claim is raised on a tyre that is off the bus; it waits with the dealer
-- (warranty_claim_on set, so it cannot be fitted) until the dealer answers:
--   replaced  the old tyre is scrapped and a new tyre is entered, priced at
--             the top-up paid, so the first bus it goes on pays that;
--   credited  the dealer keeps the tyre and pays or credits money, which goes
--             back to the bus that paid for this life of the tyre;
--   rejected  the tyre goes back to stock or onto the scrap pile.
-- A pending claim can be cancelled. Nothing here deletes rows.

alter table public.tyres
  add column if not exists warranty_claim_on date;

create table if not exists public.tyre_warranty_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  tyre_id uuid not null references public.tyres (id) on delete cascade,
  raised_on date not null,
  dealer text not null default '',
  reason text not null default '',
  note text not null default '',
  -- Total km and km in this life when the claim was raised.
  km_at_claim integer not null default 0,
  life_km_at_claim integer not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'replaced', 'credited', 'rejected', 'cancelled')),
  closed_on date,
  outcome_note text not null default '',
  -- Credited: the money, and the bus that paid for this life of the tyre.
  credit_inr integer check (credit_inr is null or credit_inr > 0),
  credit_bus_id uuid references public.buses (id) on delete set null,
  credit_bus_label text not null default '',
  -- Replaced: the new tyre and the top-up paid for it.
  replacement_tyre_id uuid references public.tyres (id) on delete set null,
  top_up_inr integer check (top_up_inr is null or top_up_inr >= 0),
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists tyre_warranty_claims_org_idx
  on public.tyre_warranty_claims (organization_id, raised_on desc);
create index if not exists tyre_warranty_claims_tyre_idx on public.tyre_warranty_claims (tyre_id);
create unique index if not exists tyre_warranty_claims_one_pending
  on public.tyre_warranty_claims (tyre_id) where status = 'pending';

alter table public.tyre_events
  add column if not exists warranty_claim_id uuid references public.tyre_warranty_claims (id) on delete set null;

-- Read by admins and managers; written only through the functions below.
alter table public.tyre_warranty_claims enable row level security;
revoke all on public.tyre_warranty_claims from anon, authenticated;
grant select on public.tyre_warranty_claims to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'tyre_warranty_claims' and policyname = 'Admins and managers read'
  ) then
    create policy "Admins and managers read"
      on public.tyre_warranty_claims for select to authenticated
      using (public.is_trip_editor(organization_id));
  end if;
end;
$$;

-- A new move takes the tyre off the scrap pile, and is refused while a
-- warranty claim is pending (closing the claim scraps it if needed).
create or replace function public.tyre_events_leave_scrap_pile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind <> 'scrapped' then
    if exists (select 1 from public.tyres where id = new.tyre_id and warranty_claim_on is not null) then
      raise exception 'This tyre has a warranty claim pending. Close the claim first.';
    end if;
    update public.tyres set scrap_pile_on = null where id = new.tyre_id and scrap_pile_on is not null;
  end if;
  return new;
end;
$$;

-- Sold or claimed tyres come back only through their sale or claim.
create or replace function public.tyre_events_keep_sales()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.tyres where id = old.tyre_id) then
    return old;
  end if;
  if old.scrap_sale_id is not null
    and coalesce(current_setting('fleet.undo_scrap_sale', true), '') <> 'on'
  then
    raise exception 'This tyre was sold as scrap. Undo the scrap sale instead.';
  end if;
  if old.warranty_claim_id is not null then
    raise exception 'This tyre was settled by a warranty claim and cannot be undone here.';
  end if;
  return old;
end;
$$;

-- The scrap pile, as in 0020, but not while a warranty claim is pending.
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
  if p_on and t.warranty_claim_on is not null then
    raise exception 'This tyre has a warranty claim pending. Close the claim first.';
  end if;
  update public.tyres
  set scrap_pile_on = case when p_on then coalesce(scrap_pile_on, public.today_ist()) end
  where id = p_tyre;
end;
$$;

-- Raise a claim on a tyre that is off the bus.
create or replace function public.tyre_raise_claim(
  p_tyre uuid,
  p_date date,
  p_dealer text,
  p_reason text,
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
  v_id uuid;
begin
  select * into t from public.tyres where id = p_tyre for update;
  if not found or not public.is_trip_editor(t.organization_id) then
    raise exception 'Tyre not found.';
  end if;
  if not public.org_in_good_standing(t.organization_id) then
    raise exception 'This company is view-only until the payment is made.';
  end if;
  if t.status <> 'in_stock' then
    raise exception 'Take the tyre off the bus before raising a warranty claim.';
  end if;
  if t.warranty_claim_on is not null then
    raise exception 'This tyre already has a warranty claim pending.';
  end if;
  if p_date is null or p_date > public.today_ist() then
    raise exception 'Enter the date, not in the future.';
  end if;
  select max(event_date) into v_last from public.tyre_events where tyre_id = p_tyre;
  if p_date < greatest(t.purchase_date, coalesce(v_last, t.purchase_date)) then
    raise exception 'The date cannot be before the last entry for this tyre.';
  end if;
  insert into public.tyre_warranty_claims (
    organization_id, tyre_id, raised_on, dealer, reason, note, km_at_claim, life_km_at_claim
  ) values (
    t.organization_id, p_tyre, p_date, btrim(coalesce(p_dealer, '')), btrim(coalesce(p_reason, '')),
    btrim(coalesce(p_note, '')), t.total_km, t.life_km
  )
  returning id into v_id;
  update public.tyres set warranty_claim_on = p_date, scrap_pile_on = null where id = p_tyre;
  return v_id;
end;
$$;

revoke all on function public.tyre_raise_claim(uuid, date, text, text, text) from public;
grant execute on function public.tyre_raise_claim(uuid, date, text, text, text) to authenticated;

-- Withdraw a pending claim; the tyre goes back to stock.
create or replace function public.tyre_cancel_claim(p_claim uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.tyre_warranty_claims%rowtype;
begin
  select * into c from public.tyre_warranty_claims where id = p_claim for update;
  if not found or not public.is_trip_editor(c.organization_id) then
    raise exception 'Claim not found.';
  end if;
  if not public.org_in_good_standing(c.organization_id) then
    raise exception 'This company is view-only until the payment is made.';
  end if;
  if c.status <> 'pending' then
    raise exception 'Only a pending claim can be cancelled.';
  end if;
  update public.tyre_warranty_claims set status = 'cancelled', closed_on = public.today_ist() where id = p_claim;
  update public.tyres set warranty_claim_on = null where id = c.tyre_id;
end;
$$;

revoke all on function public.tyre_cancel_claim(uuid) from public;
grant execute on function public.tyre_cancel_claim(uuid) to authenticated;

-- The dealer's answer. Returns the new tyre's id when the tyre was replaced.
create or replace function public.tyre_close_claim(
  p_claim uuid,
  p_outcome text,
  p_date date,
  p_amount integer default null,
  p_new_number text default '',
  p_after text default 'stock',
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.tyre_warranty_claims%rowtype;
  t public.tyres%rowtype;
  v_event uuid;
  v_bus uuid;
  v_label text := '';
  v_new uuid;
begin
  select * into c from public.tyre_warranty_claims where id = p_claim for update;
  if not found or not public.is_trip_editor(c.organization_id) then
    raise exception 'Claim not found.';
  end if;
  if not public.org_in_good_standing(c.organization_id) then
    raise exception 'This company is view-only until the payment is made.';
  end if;
  if c.status <> 'pending' then
    raise exception 'This claim is already closed.';
  end if;
  if p_outcome is null or p_outcome not in ('replaced', 'credited', 'rejected') then
    raise exception 'Pick what the dealer did.';
  end if;
  if p_date is null or p_date > public.today_ist() or p_date < c.raised_on then
    raise exception 'Enter the date: not before the claim and not in the future.';
  end if;
  select * into t from public.tyres where id = c.tyre_id for update;

  if p_outcome = 'rejected' then
    if p_after is null or p_after not in ('stock', 'pile') then
      raise exception 'Pick where the tyre goes.';
    end if;
    update public.tyres
    set warranty_claim_on = null,
        scrap_pile_on = case when p_after = 'pile' then p_date end
    where id = t.id;
    update public.tyre_warranty_claims
    set status = 'rejected', closed_on = p_date, outcome_note = btrim(coalesce(p_note, ''))
    where id = p_claim;
    return null;
  end if;

  if p_outcome = 'credited' then
    if p_amount is null or p_amount <= 0 then
      raise exception 'Enter the credit amount.';
    end if;
    -- The bus that paid for this life: the first fitting after the last retread.
    select e.bus_id, e.bus_label into v_bus, v_label
    from public.tyre_events as e
    where e.tyre_id = t.id and e.kind = 'fitted'
      and e.seq > coalesce(
        (select max(r.seq) from public.tyre_events as r where r.tyre_id = t.id and r.kind = 'retread_received'), 0)
    order by e.seq
    limit 1;
  else
    if btrim(coalesce(p_new_number, '')) = '' then
      raise exception 'Enter the new tyre number.';
    end if;
    if p_amount is not null and p_amount < 0 then
      raise exception 'Enter the top-up in rupees.';
    end if;
    if exists (
      select 1 from public.tyres
      where organization_id = t.organization_id and lower(btrim(tyre_number)) = lower(btrim(p_new_number))
    ) then
      raise exception 'Tyre number % is already entered.', btrim(p_new_number);
    end if;
    insert into public.tyres (
      organization_id, tyre_number, brand, size, bought_as, purchase_date, purchase_price_inr,
      vendor, warranty_months, warranty_km, warranty_note, note
    ) values (
      t.organization_id, btrim(p_new_number), t.brand, t.size, 'new', p_date, coalesce(p_amount, 0),
      c.dealer, t.warranty_months, t.warranty_km, t.warranty_note,
      'Warranty replacement for ' || t.tyre_number
    )
    returning id into v_new;
  end if;

  -- The dealer keeps the old tyre in both cases.
  update public.tyres set warranty_claim_on = null where id = t.id;
  v_event := public.tyre_move(
    t.id, 'scrapped', p_date, null, null, null, null, c.dealer,
    case when p_outcome = 'replaced' then 'Replaced under warranty' else 'Warranty credit' end, ''
  );
  update public.tyre_events set warranty_claim_id = p_claim where id = v_event;

  update public.tyre_warranty_claims
  set status = p_outcome,
      closed_on = p_date,
      outcome_note = btrim(coalesce(p_note, '')),
      credit_inr = case when p_outcome = 'credited' then p_amount end,
      credit_bus_id = v_bus,
      credit_bus_label = coalesce(v_label, ''),
      replacement_tyre_id = v_new,
      top_up_inr = case when p_outcome = 'replaced' then coalesce(p_amount, 0) end
  where id = p_claim;
  return v_new;
end;
$$;

revoke all on function public.tyre_close_claim(uuid, text, date, integer, text, text, text) from public;
grant execute on function public.tyre_close_claim(uuid, text, date, integer, text, text, text) to authenticated;
