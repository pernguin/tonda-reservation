# Tonda ← Round parity port — design

Date: 2026-09-14. Repo: tonda-reservation (Supabase project `qeepslmexektwqhxzwqs`, vault secret
`tonda_service_role_key`, function env `TONDA_SERVICE_ROLE_KEY`; customers + feedback live in
Round's project and are reached through `src/supabaseCustomers.js` / the functions' `roundSupabase`
client). Reference implementation: round-reservation `main` at `ce4f18b` and its specs
`2026-09-13-staff-alerts-bookings-triage-design.md`, `2026-09-14-server-side-assignment-design.md`.

## 1. Goal

Bring Tonda to functional parity with Round for the four slices shipped 2026-09-13/14:
staff alerts + Bookings triage; time-aware floor-plan status + fixtures; server-side table
assignment + cancel RPC + settings read policy + reminders; floor-plan live refresh + timeline.
Plus Tonda-only data cleanup (duplicate `restaurant_tables` rows).

Everything ports **behaviour-identical**; only the items in §3 differ from Round.

## 2. Live Tonda DB facts (2026-09-14)

pg_net 0.20 + supabase_vault installed; `pg_cron` not installed; vault `tonda_service_role_key`
exists; triggers `on_reservation_insert` / `on_reservation_completed` exist (keep); Realtime
publication has **no tables**; `settings` has the three `confirmation_message_*` keys (UNIQUE on
`key` — Settings.jsx upserts on it); RLS: reservations anon SELECT/INSERT/UPDATE, restaurant_tables
anon SELECT, settings authenticated only; `restaurant_tables.x_position` is `numeric` (cast to
float8 in SQL); `create_reservation_atomic` is Round's skeleton with Tonda rules (`BT`, `table_type
'big'`, 6–8 pax auto-confirm, >8 pending). Duplicate tables: B1–B8 (two identical rows each), W1
(two rows: `a7e2302e…` at (38,381) referenced by one booking; `edaa7306…` at (372,144) visible).
DB timezone UTC.

## 3. Tonda-specific decisions

| Area | Round | Tonda |
|---|---|---|
| Customer lookups (hook, staff email, Bookings, Tables, ManageBooking) | same project embed | `supabaseCustomers` client in the browser; `roundSupabase` (`ROUND_SUPABASE_URL` + `ROUND_SUPABASE_ANON_KEY`) in functions — existing pattern, keep |
| Staff email brand | Round header/copy | header `#1B3A6B` "TONDA PIZZA ROMANA", accent `#E8420A`, from `Tonda Pizza Romana <reservations.tonda@roundpizzanapoletana.com>`, button → `https://tonda-reservation.vercel.app/admin/bookings` |
| Function auth | `ROUND_SERVICE_ROLE_KEY` | `TONDA_SERVICE_ROLE_KEY` (must equal vault `tonda_service_role_key` — verify by digest at rollout) |
| Trigger/cron URLs | gvncofccucoejwawjvdv | qeepslmexektwqhxzwqs |
| `create_reservation_atomic` splice | Round body | **Tonda's live body** (from `docs/superpowers/specs/2026-09-14-tonda-live-db-reference.txt`) + the same three splices |
| `AdminNav` | internal Feedback link | keep the external Feedback `<a>`; add badge + sound toggle |
| Bookings | `'round'` visit tag; embed join | `'tonda'` tag; two-step `supabaseCustomers` join kept; hoist row components the same way |
| `getLocalToday` | imported from lib | Bookings.jsx has a local copy → import from `lib/tableAvailability` instead (delete copy) |
| Floor plan fixtures | oven, Π bar, door | **store room** solid block bottom-right, existing Bar Counter rect kept, **door** at the existing `ENTRANCE` (370,60) drawn Round-style (wall gap + leaf + swing + arrow + label) |
| Floor colours | Long Table indigo | keep `BT`/bar-stool colours and legend rows; add `arriving` amber and `occupied`→reserved yellow; drop "Locked" legend row on today |
| `send-confirmation-email` link fix | needed | **not needed** (Tonda already uses `reservation.id`) |
| Table dedupe | n/a | migration: for each duplicated `table_number` keep the row referenced by any `reservations.table_ids` (else the earliest `created_at`, then lowest id); if the kept row is off-canvas (`x>400 or y>340`) and a deleted duplicate is on-canvas, copy that duplicate's position onto the kept row first; delete the others and their `table_blocks`. Rollback-tested. |
| Staff alert address | roundhappymansion@gmail.com | same, seeded by migration (owner may change later) |

## 4. Deliverables (mirrors Round's four slices)

### 4.1 Migrations (Tonda `supabase/migrations/`)
- `20260914170000_staff_alert_new_reservation.sql` — Round's `20260913120000` with Tonda URL/secret; publication add `reservations`; seed `staff_alert_email = 'roundhappymansion@gmail.com'`.
- `20260914170100_server_side_assignment.sql` — Round's `20260914090000` (post-hardening: `assign_tables` with `not exists`, revoke execute, `cancel_reservation` with lock release + KL date, settings policy with escaped LIKE, pg_cron job with Tonda URL/secret) with Tonda's `create_reservation_atomic` body spliced.
- `20260914170200_realtime_tables_blocks.sql` — Round's `20260914150000` verbatim.
- `20260914170300_dedupe_restaurant_tables.sql` — §3 dedupe rule.
- `supabase/tests/assignment_rollback_test.sql` — Round's test adapted (Tonda day_type/session for 2030-01-01; fixture names `ZZ*`), plus a dedupe assertion block that runs the dedupe logic against a temp duplicate and checks the outcome, all inside `begin … rollback`.

### 4.2 Edge functions
- New `notify-staff-reservation` = Round's, with §3 brand/env/URL and `roundSupabase` customer lookup.
- `send-reminder-email`: Round's bearer check (`TONDA_SERVICE_ROLE_KEY`) + KL-time window.
- New `supabase/config.toml` with `verify_jwt = true` for `send-reminder-email` and `notify-staff-reservation`.

### 4.3 Client
- Copy verbatim from Round: `src/lib/bookingSummary.js` (+test), `src/lib/useChime.js`, `src/lib/tableTimeline.js` (+test), `src/components/NewBookingAlert.jsx`, Round's `tableAvailability.js` changes (+test, using `getLocalToday()` for the legacy-locked case).
- Adapt: `src/lib/useReservationInserts.js` (customer via `supabaseCustomers`), `AdminNav.jsx` (props + keep external Feedback link), `App.jsx` (mount `NewBookingAlert`), `Settings.jsx` (staff field), `Bookings.jsx` (Round's triage + hoist on Tonda's join), `Tables.jsx` (status colours/legend, blocks fields + state, 60 s tick, live channel + layout hold, timeline panel, store room + door fixtures), `Reservations.jsx` (delete client auto-assign), `ManageBooking.jsx` (cancel via RPC with inline `cancelError`).
- Tooling: Vitest (`package.json` script + devDependency, `vite.config.js` `test` key).

### 4.4 Store room + door geometry (viewBox 0 0 400 340; floor polygon
`[30,80] [30,320] [370,320] [370,30] [130,30] [130,80]`)
- Store room: `<rect x="215" y="215" width="150" height="100" rx="3" fill="#3f3f3f" />` with label
  `STORE` (`#d4d4d4`, 9px, letter-spacing 1.5) centred at (290,268); plus a 1.5px `#333` stroke so it
  reads as a walled room. Sits inside the floor polygon at the bottom-right per the owner's sketch;
  tables must not be placed there (staff will drag the P-row above it if needed — flag in rollout).
- Door on the right wall at y≈60: wall gap rect `x=367 y=46 w=6 h=28` fill `#fafaf8`; leaf
  `M 370 74 L 344 74`; swing arc `M 370 74 L 344 74 A 26 26 0 0 1 370 48`; arrow `M 384 60 l -10 -5 v 10 z`;
  label `ENTRANCE` anchored end at (366, 91), `#c8281e`, 9px bold. Remove the old red rect + text.
- Existing Bar Counter rect stays.

## 5. Verification
Same gates as Round: Vitest suite (all of Round's tests pass unchanged except brand), lint no new
issues vs Tonda's baseline (measure first), build; rollback SQL test (assignment + cancel + dedupe)
against the linked Tonda DB; `db push --dry-run`. Rollout order: deploy functions → `db push` →
push `main` → verify (functions/policies/cron/publication/dedupe result) → pg_net smoke (staff
email with table / no table; reminder 200/401) → owner E2E.

## 6. Risks
- **a.** `TONDA_SERVICE_ROLE_KEY` env vs vault value unverified — compare digests before deploying;
  mismatch → 401s from the new auth checks.
- **b.** Dedupe touches live rows; rollback-tested, but the owner should eyeball the plan after.
- **c.** Tonda's `x_position numeric` — cast in `assign_tables` (`::float8`), otherwise arrays typed `numeric[]` break `sqrt`.
- **d.** `create_reservation_atomic` for Tonda passes `v_duration_minutes` the same way (confirm name in its body — same as Round).
- **e.** Tonda's Vercel deploy is from its own `origin/main` — push after merge.
