-- Phase 2: Police and AdBlue expense categories, matching real trip sheets.
-- Safe to run more than once.

alter table public.daily_entries
  drop constraint if exists daily_entries_category_matches_kind;

alter table public.daily_entries
  add constraint daily_entries_category_matches_kind check (
    (
      kind = 'income'
      and category in ('ticket_collection', 'private_hire', 'parcel', 'other')
    )
    or (
      kind = 'expense'
      and category in (
        'diesel', 'adblue', 'toll', 'crew_bata', 'police', 'parking', 'repair', 'other'
      )
    )
  );
