-- Profiles + RBAC for Admins, Fleet Managers, and Crew.
-- Apply in the Supabase SQL editor after creating a project.

create type public.user_role as enum ('admin', 'fleet_manager', 'crew');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'crew',
  full_name text,
  phone text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);
