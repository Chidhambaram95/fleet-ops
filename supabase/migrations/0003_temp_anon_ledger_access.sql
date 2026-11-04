-- Run once, in order, on a new database. Not safe to re-run on a live one:
-- later migrations replace parts of it. Kept unchanged as the history of the schema.
-- Temporary: let the anon key read/write daily cash before auth is wired.
-- Run this in the Supabase SQL editor if the ledger shows RLS errors.
-- Remove these policies once sign-in is live.

create policy "Temp anon can read buses"
  on public.buses for select
  to anon
  using (true);

create policy "Temp anon can read entries"
  on public.daily_entries for select
  to anon
  using (true);

create policy "Temp anon can insert entries"
  on public.daily_entries for insert
  to anon
  with check (true);

create policy "Temp anon can delete entries"
  on public.daily_entries for delete
  to anon
  using (true);
