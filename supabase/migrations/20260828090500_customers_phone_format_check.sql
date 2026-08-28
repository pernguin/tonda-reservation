-- ============================================================================
-- TARGETS A DIFFERENT PROJECT THAN THIS REPO IS LINKED TO. READ BEFORE ACTING.
--
-- This migration applies to the SHARED "Round Reservation" Supabase project
-- (ref: gvncofccucoejwawjvdv) — the customers table used by BOTH Tonda's and
-- Round's reservation apps (Tonda writes to it via VITE_ROUND_SUPABASE_URL /
-- VITE_ROUND_SUPABASE_ANON_KEY in src/supabaseCustomers.js, not its own
-- project). It is filed in THIS repo (tonda-reservation) only because this
-- is the repo with a supabase/migrations/ convention — round-reservation has
-- no migrations directory of its own.
--
-- This repo's OWN linked project (qeepslmexektwqhxzwqs) ALSO happens to have
-- an unrelated table named "customers" (confirmed 2026-08-28). That means:
--   * This file must NEVER be applied via a plain `supabase db push` run
--     from this repo — that targets qeepslmexektwqhxzwqs, the WRONG project,
--     and could alter or fail against its unrelated customers table instead.
--   * It was applied out-of-band, directly against gvncofccucoejwawjvdv, via:
--       supabase db query --linked --project-ref gvncofccucoejwawjvdv -f <this file>
--     Confirmed applied 2026-08-28 (constraint present, convalidated = true;
--     verified rejecting a live INSERT of phone = 'Hello' with error 23514).
--   * This file exists here purely as a historical record of that change,
--     not as something this repo's own migration history will ever run.
--
-- Background: investigating a bug where free-text ("Hello") was accepted as
-- a phone number end-to-end (client -> findOrCreateCustomer -> DB) produced
-- exactly one non-conforming row out of 6,450 in customers.phone. Confirmed
-- zero linked reservations for that row before deleting it. This is layer 3
-- of a three-layer fix; layers 1-2 are client-side (Reservations.jsx
-- handleSubmit) and app-side (findOrCreateCustomer), both in
-- src/supabaseCustomers.js and src/pages/Reservations.jsx in both this repo
-- and round-reservation, added in the same commit as this file.
-- ============================================================================

-- One-time cleanup: the single row that failed the format check below.
-- id ce12070c-c5d5-4b48-8c40-5add9b02a173, full_name "Sparkles ",
-- phone "Hello" — a test artifact (created 2026-08-28, zero linked
-- reservations), not a real customer. Safe no-op if already removed.
DELETE FROM customers WHERE id = 'ce12070c-c5d5-4b48-8c40-5add9b02a173';

-- Digits only, optional leading '+', 8-15 digits: a loose superset of every
-- real value found in the table (bare digit strings, 8-14 chars, no '+'
-- prefix in current data) plus headroom for full E.164. Mirrors
-- isValidPhone() in both repos' supabaseCustomers.js.
ALTER TABLE customers
  ADD CONSTRAINT customers_phone_format_check
  CHECK (phone ~ '^\+?[0-9]{8,15}$');
