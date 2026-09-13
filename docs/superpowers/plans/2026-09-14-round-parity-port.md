# Round-Parity Port Implementation Plan (Tonda)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tonda gets everything Round shipped 2026-09-13/14 (staff alerts, Bookings triage, time-aware floor plan + fixtures, server-side assignment, cancel RPC, reminders, live refresh, timeline) plus a dedupe of its duplicated tables.

**Architecture:** Port by copying Round's files/migrations and applying the deltas in the spec's §3 table. The only genuinely new code is the store-room/door fixtures and the dedupe migration.

**Tech Stack:** as Round (React 19 / Vite / Tailwind v4 / supabase-js 2.105 / Deno functions / Postgres 17 + pg_net + pg_cron + Vault / Vitest).

**Spec:** `docs/superpowers/specs/2026-09-14-round-parity-port-design.md` (+ `2026-09-14-tonda-live-db-reference.txt`). Round source tree: `C:\Users\Perng\projects\round-reservation` at `ce4f18b` (read-only reference — never modify it).

## Global Constraints

- Work only in the Tonda worktree; Round is read-only reference. Supabase ref `qeepslmexektwqhxzwqs`; vault `tonda_service_role_key`; env `TONDA_SERVICE_ROLE_KEY`, `ROUND_SUPABASE_URL`, `ROUND_SUPABASE_ANON_KEY`, `RESEND_API_KEY`, `SUPABASE_URL`.
- Customers/feedback are cross-project: browser → `src/supabaseCustomers.js` (`supabaseCustomers`), functions → `roundSupabase`. Never introduce a `customers(...)` embed.
- Preserve Tonda-only things: `BT`/bar-stool sizing+colours+legend rows, Bar Counter rect, external Feedback nav link, `'tonda'` visit tag, Fri/Sat weekend, brand colour `#E8420A`, email brand strings.
- Dates from parts, never `toISOString`/`getUTC*` for calendar values; SQL timestamps in `Asia/Kuala_Lumpur`.
- Lint gate: Tonda baseline 11 errors / 4 warnings — no new issues; `npm run build`; `npm test` all green (Vitest added in Task 1).
- `supabase db query --linked -f` only for the rollback-wrapped test; `db push --dry-run` allowed; never `db push` (without dry-run) / `functions deploy` / `secrets set` from a builder.
- Commits end with:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01N83egENk7MybAxTgY6LhEx
  ```
  (`git commit -F <tempfile>`; temp files under `C:\Users\Perng\AppData\Local\Temp\claude\`).

---

## File map (R = copy from Round verbatim, A = adapt, N = new)

| Tonda file | Kind | Source / delta |
|---|---|---|
| `package.json`, `vite.config.js` | A | add `"test": "vitest run"`, `vitest@^3` devDep, `test: { environment:'node', include:['src/**/*.test.js'] }` |
| `src/lib/bookingSummary.js` + `.test.js` | R | Round `src/lib/` |
| `src/lib/tableTimeline.js` + `.test.js` | R | Round `src/lib/` |
| `src/lib/useChime.js` | R | Round |
| `src/lib/tableAvailability.js` + `.test.js` | R | Round (test already uses `getLocalToday()` for the legacy case) |
| `src/lib/useReservationInserts.js` | A | Round, customer lookup via `supabaseCustomers` (`import { supabaseCustomers } from '../supabaseCustomers'`) |
| `src/components/NewBookingAlert.jsx` | A | Round, `BRAND = '#E8420A'` |
| `src/components/AdminNav.jsx` | A | Round's props/badge/toggle on Tonda's nav (keep external Feedback `<a>`) |
| `src/App.jsx` | A | mount `NewBookingAlert` instead of `AdminNav` |
| `src/pages/admin/Settings.jsx` | A | Round's staff field |
| `src/pages/admin/Bookings.jsx` | A | Round's hoisted components + triage + live list on Tonda's two-step join; `'tonda'` tag; import `getLocalToday` from lib |
| `src/pages/admin/Tables.jsx` | A | Round's status/legend/tick/live/timeline changes; Tonda fixtures (store room + door) |
| `src/pages/Reservations.jsx` | A | delete client auto-assign (lines 249-255, 257-403, 405-412, call at 640 + its comment) |
| `src/pages/ManageBooking.jsx` | A | cancel via RPC + inline `cancelError` |
| `supabase/config.toml` | N | two `verify_jwt = true` blocks |
| `supabase/functions/notify-staff-reservation/index.ts` | A | Round's with Tonda brand/env/URL, customer via `roundSupabase` |
| `supabase/functions/send-reminder-email/index.ts` | A | Round's bearer check + KL window |
| `supabase/migrations/20260914170000_staff_alert_new_reservation.sql` | A | Round `20260913120000` with Tonda URL/secret + seed address |
| `supabase/migrations/20260914170100_server_side_assignment.sql` | A | Round `20260914090000` with Tonda RPC body + URLs/secret |
| `supabase/migrations/20260914170200_realtime_tables_blocks.sql` | R | Round `20260914150000` |
| `supabase/migrations/20260914170300_dedupe_restaurant_tables.sql` | N | spec §3 rule |
| `supabase/tests/assignment_rollback_test.sql` | A | Round's + dedupe block |

---

### Task 1: Tooling + pure libs (copy)

**Files:** `package.json`, `vite.config.js`, `src/lib/bookingSummary.js`, `src/lib/bookingSummary.test.js`, `src/lib/tableTimeline.js`, `src/lib/tableTimeline.test.js`, `src/lib/useChime.js`, `src/lib/tableAvailability.js`, `src/lib/tableAvailability.test.js`, `src/lib/useReservationInserts.js`.

- [ ] Step 1: `npm install --save-dev vitest@^3`; add `"test": "vitest run"`; add the `test` key to `vite.config.js` (keep `plugins: [react(), tailwindcss()]`).
- [ ] Step 2: Copy from Round (`C:\Users\Perng\projects\round-reservation\src\lib\`) verbatim: `bookingSummary.js`, `bookingSummary.test.js`, `tableTimeline.js`, `tableTimeline.test.js`, `useChime.js`, `tableAvailability.test.js`. Replace Tonda's `src/lib/tableAvailability.js` with Round's (diff them first: the only pre-existing difference should be none — report if Tonda's has extra code; keep any Tonda-only export).
- [ ] Step 3: `src/lib/useReservationInserts.js` = Round's file with two edits: add `import { supabaseCustomers } from '../supabaseCustomers'` and use `supabaseCustomers.from('customers')…` for the name lookup (the Realtime channel stays on `supabase`).
- [ ] Step 4: `npm test` → all Round tests pass (6 + 16 + 9 + 2 = 33). `npm run lint` (11/4, no new), `npm run build`.
- [ ] Step 5: Commit "Port: vitest, summary/timeline/availability libs, chime, realtime insert hook".

---

### Task 2: Migrations + rollback test

**Files:** the four migrations and `supabase/tests/assignment_rollback_test.sql` (see file map). Sources: Round's `supabase/migrations/20260913120000_staff_alert_new_reservation.sql`, `20260914090000_server_side_assignment.sql`, `20260914150000_realtime_tables_blocks.sql`, `supabase/tests/assignment_rollback_test.sql`; Tonda's live RPC body in `docs/superpowers/specs/2026-09-14-tonda-live-db-reference.txt`.

- [ ] Step 1: `20260914170000_staff_alert_new_reservation.sql` = Round's with: vault name `tonda_service_role_key`; URL `https://qeepslmexektwqhxzwqs.supabase.co/functions/v1/notify-staff-reservation`; seed `insert into public.settings (key, value) values ('staff_alert_email', 'roundhappymansion@gmail.com') on conflict (key) do nothing;` (Tonda's `settings` has an `id` PK with default — confirm the insert needs no id; the reference lists `id uuid` — check for a default in the live reference COLS line; if none, use `gen_random_uuid()` explicitly).
- [ ] Step 2: `20260914170100_server_side_assignment.sql` = Round's file with: (a) section 2 = **Tonda's** `create_reservation_atomic` body from the reference, spliced exactly as Round's plan Task 1 Step 2 (declare `v_table_ids uuid[]; v_flagged boolean;`, the `assign_tables` call after `v_status := …`, the insert gaining `table_ids`/`needs_manual_assignment`, the post-insert lock update in KL time); (b) in `assign_tables` cast positions `coalesce(t.x_position, 0)::float8` (already so in Round — keep); (c) cron URL → Tonda's `send-reminder-email`, secret → `tonda_service_role_key`. Diff your pasted RPC body against the reference to prove only the splices differ.
- [ ] Step 3: `20260914170200_realtime_tables_blocks.sql` = Round's verbatim.
- [ ] Step 4: `20260914170300_dedupe_restaurant_tables.sql`:
```sql
-- Dedupe restaurant_tables: identical rows were double-inserted (B1-B8) and W1 exists twice.
-- Keep the row referenced by any reservation (else earliest created_at, then lowest id); if the
-- kept row is off-canvas and a doomed duplicate is on-canvas, take that duplicate's position.
do $$
declare
  grp record; keep_id uuid; pos record;
begin
  for grp in
    select table_number from public.restaurant_tables group by table_number having count(*) > 1
  loop
    with refs as (
      select (jsonb_array_elements_text(r.table_ids))::uuid as id
      from public.reservations r where jsonb_typeof(r.table_ids) = 'array'
    )
    select t.id into keep_id
    from public.restaurant_tables t
    left join (select id, count(*) n from refs group by id) x on x.id = t.id
    where t.table_number = grp.table_number
    order by coalesce(x.n, 0) desc, t.created_at asc, t.id asc
    limit 1;

    -- adopt a visible position from a doomed duplicate if the kept row is off-canvas
    select t.x_position, t.y_position into pos
    from public.restaurant_tables t
    where t.table_number = grp.table_number and t.id <> keep_id
      and t.x_position between 0 and 400 and t.y_position between 0 and 340
    order by t.created_at asc limit 1;
    if found then
      update public.restaurant_tables k
         set x_position = pos.x_position, y_position = pos.y_position
       where k.id = keep_id and not (k.x_position between 0 and 400 and k.y_position between 0 and 340);
    end if;

    delete from public.table_blocks where table_id in
      (select id from public.restaurant_tables where table_number = grp.table_number and id <> keep_id);
    update public.restaurant_tables set locked_until = null, locked_by_reservation = null, group_id = null
      where table_number = grp.table_number and id <> keep_id;
    delete from public.restaurant_tables where table_number = grp.table_number and id <> keep_id;
    raise notice 'dedupe %: kept %', grp.table_number, keep_id;
  end loop;
end;
$$;
```
- [ ] Step 5: `supabase/tests/assignment_rollback_test.sql` = Round's with Tonda adaptations (day_type for 2030-01-01 is a Wednesday → `'weekday'`; pick a time inside Tonda's configured sessions — read `operating_hours`/`slot_rules` in the scratch run first) **plus** a dedupe block before `rollback;`: insert two rows `ZZDUP` (one at (900,900) referenced by a temp reservation, one at (50,50) unreferenced), run the dedupe `do` block (paste it), assert exactly one `ZZDUP` remains, its id is the referenced one, and its position is now (50,50). Everything inside `begin … rollback`.
- [ ] Step 6: `npx supabase db push --dry-run --linked` → four migrations listed. Run the rollback test per Round's procedure (scratch file: `create extension if not exists pg_cron;` then `begin;` + the four migrations' contents in order + test body + `rollback;`) → expect `assign_tables: 4/4 passed`, `RPC + cancel: passed`, `dedupe: passed`.
- [ ] Step 7: Commit "Port: staff-alert trigger, server-side assignment, realtime publication, table dedupe".

---

### Task 3: Edge functions + config

**Files:** `supabase/functions/notify-staff-reservation/index.ts` (new), `supabase/functions/send-reminder-email/index.ts`, `supabase/config.toml` (new).

- [ ] Step 1: Copy Round's `notify-staff-reservation/index.ts`; edit: env const reads `TONDA_SERVICE_ROLE_KEY`; add `const roundSupabase = createClient(Deno.env.get("ROUND_SUPABASE_URL")!, Deno.env.get("ROUND_SUPABASE_ANON_KEY")!);` and use it for the `customers` lookup (settings + restaurant_tables stay on the Tonda client); header bar `#1B3A6B` with title `TONDA PIZZA ROMANA` (white text), accent `#E8420A` for h2/button/`Pending` colour stays amber; from `Tonda Pizza Romana <reservations.tonda@roundpizzanapoletana.com>`; button `https://tonda-reservation.vercel.app/admin/bookings`; ground `#F5F1EA` is fine to keep.
- [ ] Step 2: `send-reminder-email/index.ts`: add the bearer check at the top of the handler (`"Bearer " + SUPABASE_SERVICE_ROLE_KEY` where that const reads `TONDA_SERVICE_ROLE_KEY`); replace the three UTC lines with Round's `Intl.DateTimeFormat` KL block (`% 24`).
- [ ] Step 3: `supabase/config.toml`:
```toml
[functions.send-reminder-email]
verify_jwt = true

[functions.notify-staff-reservation]
verify_jwt = true
```
- [ ] Step 4: Static re-read (env names, escaping, no `getUTC*`/`toISOString` in the window). Commit "Port: staff alert function, reminder auth + KL window, function config".

---

### Task 4: Client wiring (alert shell, settings, manage, reservations)

**Files:** `src/components/NewBookingAlert.jsx` (new), `src/components/AdminNav.jsx`, `src/App.jsx`, `src/pages/admin/Settings.jsx`, `src/pages/ManageBooking.jsx`, `src/pages/Reservations.jsx`.

- [ ] Step 1: `NewBookingAlert.jsx` = Round's with `BRAND = '#E8420A'`.
- [ ] Step 2: `AdminNav.jsx`: keep Tonda's item list (incl. the external Feedback `<a>`), add props `{ unseenCount = 0, soundOn = false, onToggleSound }`, the badge on the Bookings `NavLink` and the sound toggle button at the right end exactly as Round's file (`ml-auto`, `🔔 Sound on` / `🔕 Sound off`), `BRAND` stays `#E8420A`.
- [ ] Step 3: `App.jsx`: import `NewBookingAlert` instead of `AdminNav`; the `/admin && !login` line renders `<NewBookingAlert />`.
- [ ] Step 4: `Settings.jsx`: Round's `staff_alert_email` key + section + subtitle change.
- [ ] Step 5: `ManageBooking.jsx`: keep the two-step fetch; replace `cancelBooking` with Round's RPC version (`supabase.rpc('cancel_reservation', { p_id: id })`, error → generic, `data === false` → `cancelError` "This booking can no longer be cancelled online — please call us.", else cancelled) with a new `cancelError` state rendered inline above the cancel buttons (same classes as the page's body text).
- [ ] Step 6: `Reservations.jsx`: delete `flagNeedsManualAssignment` (249-255), `autoAssignTables` (257-403), `getCombinations` (405-412), the comment + call at 639-640 (`autoAssignTables(booking.id, …)`); keep `durationMinutes`. Grep proves no references remain.
- [ ] Step 7: `npm run lint` (11/4, no new), `npm run build`, `npm test`. Commit "Port: in-app alert shell, staff email setting, RPC cancel, drop client auto-assign".

---

### Task 5: Bookings.jsx

**Files:** `src/pages/admin/Bookings.jsx`.

Read Round's `Bookings.jsx` (HEAD) and Tonda's fully. Reproduce Round's structure on Tonda:
- [ ] Step 1: Module scope: `STATUS_LABELS`, `statusColors`, `getTableNumbers(tableIds, tables)`, hoisted `EmptyState`, `StatusBadge`, `ActionButtons({ table, id, busyId, updateStatus })`, `ReservationRow({ r, tables, busyId, updateStatus })`, `EventRow`, `OffsiteRow`, `ListHeader` — markup identical to Tonda's current nested versions (keep Tonda's customer fields as merged by its join: `r.customers?.full_name` etc. remain valid because Tonda merges `customers` onto each row).
- [ ] Step 2: State: `filterDate` = `getLocalToday()` imported from `../../lib/tableAvailability` (delete the local copy at lines 8-11); add `busyId`, `toast`, `refetchTimer`.
- [ ] Step 3: `fetchAll({ silent })`: Tonda's two-step join kept; add the `.error` check on the four base queries and on the customers query → `showToast('Could not load bookings: …')` and **return before setting state**; `silent` skips `setLoading(true)`.
- [ ] Step 4: Mount effect with the `admin-bookings-list` Realtime channel (`event: '*'`, `reservations`) → debounced 500 ms `fetchAll({ silent: true })`; cleanup.
- [ ] Step 5: `updateStatus`: confirm on cancelled/no_show; `.error` → toast + clear busy; `await logVisitFromReservation(reservation, status, 'tonda')`; keep the lock-release/unmerge block; `await fetchAll({ silent: true })`; `setBusyId(null)`.
- [ ] Step 6: `renderTab()` plain function (not a component) passing the new props; toast JSX at the bottom (Round's fixed-bottom pill).
- [ ] Step 7: Gates (lint may drop by one if Tonda had the same component-in-render error — report exact counts). Commit "Port: Bookings triage — hoisted rows, confirm, toasts, busy state, live list".

---

### Task 6: Tables.jsx

**Files:** `src/pages/admin/Tables.jsx`. Read Round's HEAD `Tables.jsx` and Tonda's fully; apply Round's diff `eacc615..HEAD -- src/pages/admin/Tables.jsx` conceptually onto Tonda:
- [ ] Step 1: imports (`useCallback`; `buildTimeline, formatClock`); `blocks` state; `fetchAll` selects `start_time, end_time` on `table_blocks` and keeps `blocks`; `recomputeStatus` with `atMinutes`/`holdMinutes` on today; 60 s tick; `getTableColor` gains `arriving` amber `#f59e0b` and treats `occupied` like `reserved` (keep BT/bar-stool branches); legend on today = Free · Arriving soon (30 min) · Reserved now · Seated · Blocked + Tonda's Big Table / Bar Stool rows; no "Locked" row on today.
- [ ] Step 2: live refresh channel `admin-floorplan-live-${selectedDate}` (reservations filtered by date, restaurant_tables, table_blocks filtered by date) with the layout-mode hold + flush effect, exactly as Round.
- [ ] Step 3: timeline panel inserted after the assign-mode selected-table header (Tonda ≈ line 1085), using `blocks`, `holdDurationMinutes`, `todayView`, `getTableReservations`.
- [ ] Step 4: fixtures: replace the red `ENTRANCE` rect+text (≈731-732) with a `<g pointerEvents="none">` block containing the **store room** and **door** per spec §4.4 (keep the Bar Counter rect; keep `ENTRANCE` const only if referenced elsewhere).
- [ ] Step 5: Gates. Commit "Port: floor plan — time-aware status, live refresh, timeline, store room + door".

---

### Task 7: Rollout (controller/owner)

- [ ] 1. Verify `TONDA_SERVICE_ROLE_KEY` digest == vault `tonda_service_role_key` digest (`supabase secrets list` vs SQL sha256) before deploying.
- [ ] 2. Owner: `npx supabase functions deploy notify-staff-reservation send-reminder-email --project-ref qeepslmexektwqhxzwqs`.
- [ ] 3. Controller: `npx supabase db push --linked` (from the Tonda repo); verify functions/policies/cron/publication/dedupe (`select table_number, count(*) … having count(*)>1` → none).
- [ ] 4. Push `main`; Vercel deploys tonda-reservation.
- [ ] 5. pg_net smoke: staff email with `table_ids: [<BT id>]` and with `needs_manual_assignment: true`; reminder 200 / 401.
- [ ] 6. Owner: eyeball the Floor Plan (dedupe, store room, door), then a real booking.

---

## Self-review
- Spec §4.1 → T2; §4.2 → T3; §4.3 → T1, T4, T5, T6; §4.4 → T6 Step 4; §3 deltas each named in a task; §5 gates in every task + T7.
- No placeholders: verbatim copies name their source path; adaptations list exact edits; the dedupe SQL is complete.
- Names: `useReservationInserts` → `NewBookingAlert` (Round contract); `cancel_reservation(p_id)`; `buildTimeline/formatClock`; `getLocalToday` import path `../../lib/tableAvailability` in admin pages.
