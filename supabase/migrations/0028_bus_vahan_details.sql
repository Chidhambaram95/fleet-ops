-- Road tax on Vahan: the owner name as on the RC and the last 5 characters of
-- the chassis number for each bus. Run after 0027. Safe to run more than once.
--
-- Vahan asks for the registration number and the chassis last 5 before it shows
-- the tax due. Fleet Ops fills these in for you, and checks that the owner name
-- Vahan shows is the one on the bus record before you pay.
--
-- Both columns are optional (empty until an admin fills them in). They follow
-- the existing bus rules: admins change them, managers and crew can only read.

alter table public.buses
  add column if not exists owner_name text not null default '',
  add column if not exists chassis_last5 text not null default '';

alter table public.buses drop constraint if exists buses_vahan_details_check;
alter table public.buses
  add constraint buses_vahan_details_check check (
    length(owner_name) <= 120
    and owner_name = btrim(owner_name)
    and (chassis_last5 = '' or chassis_last5 ~ '^[A-Z0-9]{5}$')
  );
