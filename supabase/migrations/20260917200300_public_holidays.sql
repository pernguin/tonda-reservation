-- public_holidays: overrides day_type -> 'public_holiday' in get_availability
-- (mirrors the client's ad-hoc fetch of https://date.nager.at/api/v3/PublicHolidays/<year>/MY
-- in src/pages/Reservations.jsx:24, made a real table so the server-side RPC does not
-- depend on an outbound HTTP call).
--
-- IMPORTANT — this table is seeded EMPTY by this migration, not with the rows T10's
-- brief asked for. At authoring time (2026-09-17) https://date.nager.at/api/v3/
-- PublicHolidays/2026/MY and /2027/MY both returned HTTP 204 No Content, and
-- GET https://date.nager.at/api/v3/AvailableCountries does not list "MY" at all —
-- confirmed with curl -sv against 2024/2025/2026/2027, all 204. Nager.Date does not
-- cover Malaysia, so there is nothing to inline. This is the same API the existing
-- client code calls (Reservations.jsx:24); that call already fails silently today
-- (catch block, day_type just stays weekday/weekend) so this is a pre-existing gap,
-- not one introduced here. Perng: pick a real MY holiday source (e.g. manually from
-- the government gazette) and insert rows before this table can actually flip any
-- date to 'public_holiday'. See README.md for the yearly re-seed note.

create table if not exists public.public_holidays (
  holiday_date date primary key,
  name text not null
);

alter table public.public_holidays enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'public_holidays'
      and policyname = 'Public read of public holidays'
  ) then
    create policy "Public read of public holidays" on public.public_holidays
      for select to anon using (true);
  end if;
end;
$$;
