-- Drop temporary anon access now that sign-in is required.
drop policy if exists "Temp anon can read buses" on public.buses;
drop policy if exists "Temp anon can read entries" on public.daily_entries;
drop policy if exists "Temp anon can insert entries" on public.daily_entries;
drop policy if exists "Temp anon can delete entries" on public.daily_entries;
