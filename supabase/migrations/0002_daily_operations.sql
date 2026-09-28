-- Daily bus cash (income / expense). Apply after profiles exist.

create table public.buses (
  id uuid primary key default gen_random_uuid(),
  registration_number text not null unique,
  route_label text not null,
  created_at timestamptz not null default now()
);

create table public.daily_entries (
  id uuid primary key default gen_random_uuid(),
  bus_id uuid not null references public.buses (id) on delete cascade,
  entry_date date not null,
  kind text not null check (kind in ('income', 'expense')),
  category text not null,
  amount_inr integer not null check (amount_inr > 0),
  note text not null default '',
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  constraint daily_entries_category_matches_kind check (
    (
      kind = 'income'
      and category in ('ticket_collection', 'private_hire', 'parcel', 'other')
    )
    or (
      kind = 'expense'
      and category in ('diesel', 'toll', 'crew_bata', 'parking', 'repair', 'other')
    )
  )
);

create index daily_entries_date_idx on public.daily_entries (entry_date desc);

insert into public.buses (id, registration_number, route_label)
values
  (
    '7c1a9b20-4d3e-4f81-9a12-000000000001',
    'TN 01 N 4521',
    'MTC contract — CMBT'
  ),
  (
    '7c1a9b20-4d3e-4f81-9a12-000000000002',
    'TN 38 AQ 2198',
    'Coimbatore local'
  ),
  (
    '7c1a9b20-4d3e-4f81-9a12-000000000003',
    'TN 43 EF 4410',
    'Ooty tourist'
  )
on conflict (registration_number) do nothing;

alter table public.buses enable row level security;
alter table public.daily_entries enable row level security;

create policy "Authenticated users can read buses"
  on public.buses for select
  to authenticated
  using (true);

create policy "Managers can write buses"
  on public.buses for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'fleet_manager')
    )
  );

create policy "Crew and managers can read entries"
  on public.daily_entries for select
  to authenticated
  using (true);

create policy "Crew and managers can insert entries"
  on public.daily_entries for insert
  to authenticated
  with check (created_by = auth.uid());

create policy "Owners and managers can delete entries"
  on public.daily_entries for delete
  to authenticated
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'fleet_manager')
    )
  );
