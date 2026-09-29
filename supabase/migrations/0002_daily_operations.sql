-- Daily bus cash (income / expense). Apply after organizations exist.
-- Buses and entries are visible only inside an organization the caller belongs to.

create table public.buses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  registration_number text not null,
  route_label text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, registration_number)
);

create index buses_organization_id_idx on public.buses (organization_id);

create table public.daily_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
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

create index daily_entries_organization_id_idx
  on public.daily_entries (organization_id);
create index daily_entries_date_idx on public.daily_entries (entry_date desc);

alter table public.buses enable row level security;
alter table public.daily_entries enable row level security;

create policy "Members can read buses"
  on public.buses for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy "Members can insert buses"
  on public.buses for insert
  to authenticated
  with check (public.is_org_member(organization_id));

create policy "Members can update buses"
  on public.buses for update
  to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy "Members can delete buses"
  on public.buses for delete
  to authenticated
  using (public.is_org_member(organization_id));

create policy "Members can read entries"
  on public.daily_entries for select
  to authenticated
  using (public.is_org_member(organization_id));

create policy "Members can insert entries"
  on public.daily_entries for insert
  to authenticated
  with check (
    public.is_org_member(organization_id)
    and created_by = auth.uid()
  );

create policy "Members can update entries"
  on public.daily_entries for update
  to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

create policy "Members can delete entries"
  on public.daily_entries for delete
  to authenticated
  using (public.is_org_member(organization_id));
