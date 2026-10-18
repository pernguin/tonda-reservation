# 03 — Booking guards: server-side validation fixes, amend fixes, and the PGlite SQL test harness

Tonda's booking RPCs trust the client and mishandle a few edges. `create_reservation_atomic` takes
`p_day_type` from the browser (a Tuesday sent as `'weekend'` skips the weekday closed-days check),
accepts `p_guest_count` of 0 or less, accepts past dates and same-day times already gone, and
`amend_reservation_atomic` loses the booking's *own* table when moved within the same service (the
overlap check in `assign_tables` counts the booking's old row against itself), never recomputes
`table_type`, can amend completed/no-show bookings, and leaves `reminder_sent = true` after a move.
`get_availability` answers for 0 guests and re-reads blackouts and reservations for every slot. The
two alert triggers can abort a booking if the email call fails. After this package all of that is
fixed in one new migration, and Tonda has an offline SQL test harness (PGlite, `npm run test:sql`)
that every later SQL package adds cases to. **Nothing is applied to a live database by this build.**

Branch: `build/03-booking-guards`
Brainstormed: 2026-10-17. Decisions made by Claude under Perng's 2026-10-17 "work autonomously" instruction; see docs/build/2026-10-17-audit-plan.md
Source of truth for the plan: `docs/build/2026-10-17-audit-plan.md`, section "Tonda 03".

## Plan discrepancies

The plan is right in intent; these are places where the code differs from what it implies.

1. **`assign_tables` cannot just gain a parameter.** `create or replace` with a 5th argument creates a
   second overload next to `assign_tables(date, time, integer, integer)`; the old one would linger and
   the revoke would not cover the new one. The migration must `drop function if exists
   public.assign_tables(date, time, integer, integer)` first, then create the 5-argument version and
   repeat the `revoke`. The old 4-argument call form keeps working through the default.
2. **The amend "own table" bug is in `assign_tables`, not in the lock release.** `amend_reservation_atomic`
   already clears `restaurant_tables.locked_*` for the old tables (migration `20260922150000`, lines
   89-100), but `assign_tables` ignores locks entirely and decides conflicts from `reservations` rows
   (`status in ('confirmed','pending','seated')`, source `20260914170100` lines 22-33). The booking's own
   row is still there with its old time, so it conflicts with itself. Hence `p_exclude_reservation_id`.
3. **Amend does not recompute `table_type` today, and also never sets `tables_count`.** Both columns are
   set only by create. The brief recomputes both in amend (see T7) so the two stay consistent.
4. **`notify_reservation_insert` / `notify_reservation_completed` exist only in
   `20260813131000_vault_service_role_key.sql`, and the triggers that call them
   (`on_reservation_insert`, `on_reservation_completed`) are in no migration** (they were created live;
   `20260914170000` line 3 refers to them by name). `notify_staff_new_reservation` (the third trigger
   function) is already `security definer`, has the search_path and has the exception wrapper, so it is
   **not** re-declared. The PGlite tests create the two missing triggers locally inside their transaction.
5. **The `%s` typo renders as "Tuesdays".** `create_reservation_atomic` line 181 of `20260914170100`
   passes `v_day_name` to `'... closed on %s.'`, so staff and guests see "closed on Tuesdays.". The plan says
   fix it; this brief follows the plan, so the visible text becomes "closed on Tuesday." (matches the
   amend message). Flagged because the old text read slightly better by accident.
6. **`create extension if not exists pg_cron` (20260914170100 line 317) cannot run in PGlite.** The
   runner needs a per-file *rewrite* list as well as the per-file skip list (T3). Without it the one
   migration that defines `assign_tables` and `create_reservation_atomic` would have to be skipped.
7. **Lint baseline disagrees.** CLAUDE.md says 14 problems (10 errors / 4 warnings); package 02 measured
   16 (11 / 5) on 2026-09-24. Record `npm run lint` on a clean `main` before starting and gate on "no new
   problems" against that number. (This package adds no lint-scanned files: ESLint's config only matches
   `**/*.{js,jsx}`, and the new harness files are `.mjs`/`.sql`.)
8. **The existing `supabase/tests/*.sql` are live-database scripts** (they read live `restaurant_tables`
   capacity). They are not PGlite-compatible and are left alone; the new PGlite cases re-express their
   intent against a stub schema.

---

## Decisions

| Question | Chosen | Rejected | Why |
|---|---|---|---|
| Day type in `create_reservation_atomic` **(Claude)** | Derive from the date (`extract(dow from p_reservation_date) in (5, 6)` → `'weekend'`, else `'weekday'`). Keep `p_day_type` in the signature and ignore it | Dropping the parameter | Dropping breaks the deployed front end before Tonda 05 lands |
| Guest count / past / lead time | Reject `p_guest_count < 1`; a date before KL today; a same-day time earlier than KL now + 30 min (mirrors `LEAD_TIME_MINUTES` in `src/lib/slotCutoff.js`). Error prefixes follow the existing `code: message` style so the client's existing error display (`/^\w+: (.+)$/`) keeps working | — | Plan |
| `get_availability` | Return no rows for `p_guest_count < 1`; hoist the per-slot blackout and reservation reads out of the loop if it stays readable; mark `STABLE` | — | Plan |
| `amend_reservation_atomic` | Exclude the booking's own row when choosing tables (new optional `p_exclude_reservation_id uuid default null` on `assign_tables`; create passes null). Recompute `table_type` the same way create does. Allow amending only `pending` / `confirmed` / `seated`. Reset `reminder_sent = false` when the date or time changes | — | Plan |
| Big table (BT) and the 9–10 pax approval rule **(Claude)** | Unchanged | Touching it | Business rule, out of scope; on Perng's morning list |
| Trigger functions `notify_reservation_insert` / `notify_reservation_completed` | Re-declare with `security definer`, `set search_path = public, vault, pg_temp` (matches live) and an `exception when others then raise warning` wrapper so a failed email cannot abort a booking | — | Plan |
| Constraints and indexes | `check (guest_count > 0)` on `reservations` (added `not valid`, then validated); `unique (table_number)` on `restaurant_tables` only if no duplicates exist (DO block, else `raise notice`); index on `reservations (reservation_date, status)` | — | Plan |
| Housekeeping cron | Weekly purge of `cron.job_run_details` older than 14 days (idempotent schedule) | — | Plan |
| `%s` typo | Fix the `%s` typo in the `date_closed` message | — | Plan |
| PGlite harness | `supabase/tests/pglite/` (stub schema for the tables/extensions the functions touch: `vault`, `net`, `cron` stubs), runner script, `npm run test:sql`, devDependency `@electric-sql/pglite`. Every SQL package after this adds cases to it | — | Plan |

## Files

| Path | Change |
|---|---|
| `package.json` | modify — devDependency `@electric-sql/pglite`; script `"test:sql": "node supabase/tests/pglite/run.mjs"` |
| `package-lock.json` | modify — `npm install` output only |
| `supabase/tests/pglite/stub-schema.sql` | new — minimal tables/columns, roles, `vault` / `net` / `cron` stubs, `supabase_realtime` publication |
| `supabase/tests/pglite/run.mjs` | new — loads stub, applies migrations in filename order (skip + rewrite lists with reasons), runs every `*.test.mjs` |
| `supabase/tests/pglite/fixtures.mjs` | new — `seed(db)`: operating hours, slot rules, tables used by every test |
| `supabase/tests/pglite/harness.test.mjs` | new — sanity: functions exist, `?` works, baseline booking works |
| `supabase/tests/pglite/assign_tables.test.mjs` | new |
| `supabase/tests/pglite/create_guards.test.mjs` | new |
| `supabase/tests/pglite/amend.test.mjs` | new |
| `supabase/tests/pglite/availability.test.mjs` | new |
| `supabase/tests/pglite/triggers.test.mjs` | new |
| `supabase/tests/pglite/housekeeping.test.mjs` | new — check constraint, unique, index, cron purge, migration idempotence |
| `supabase/migrations/20261017100000_booking_guards.sql` | new — all SQL changes (not applied by the build) |

Not touched: every existing migration, `supabase/tests/*.sql`, all `src/` files, `supabase/functions/`.

## Invariants touched

- **Availability and table assignment are server-side** — this package hardens exactly those functions
  (`get_availability`, `create_reservation_atomic`, `assign_tables`, plus `amend_reservation_atomic`).
  The client still never locks tables.
- **Weekend is Friday/Saturday (`dow in (5, 6)`)** — create now derives it from the date with exactly
  that expression; `day_type` stays `'weekday' | 'weekend'` only. No `public_holiday` branch is added.
- **`operating_hours.closed_days` is jsonb, SQL uses `?`** — every copied body keeps
  `v_hours.closed_days ? v_day_name`. Invariant grep `= any\(v_hours\.closed_days\)` must find nothing in
  the new migration.
- **Dates are local strings** — SQL "today" is `(now() at time zone 'Asia/Kuala_Lumpur')::date`, the same
  expression `cancel_reservation` and `amend_reservation_atomic` already use. The `toISOString` grep is
  not relevant (no JS changes).
- Customer counters, admin theme tokens: not touched.

## Tasks

Global: work only in the files named. Branch from `main`. Record the `npm run lint` problem count on
clean `main` first; the package must not raise it. Stage by path (`git add <path>`), never `git add -A`.
Commit messages end with the `Co-Authored-By` line Claude Code adds. **Do not run `supabase db push` and
do not connect to any live database.** Write SQL for PostgreSQL as Supabase runs it; PGlite (Postgres in
WASM) is only the offline check.

Source map for every "full body" below (copy the body verbatim, then apply the listed edit; never retype
from memory):

| Function | Source migration (newest definition) | Lines in that file |
|---|---|---|
| `assign_tables(date, time, integer, integer)` | `20260914170100_server_side_assignment.sql` | 8-133 (revoke at 134) |
| `create_reservation_atomic(...)` | `20260914170100_server_side_assignment.sql` | 139-270 (`$function$` closes at 269-270) |
| `amend_reservation_atomic(...)` | `20260922150000_amend_reservation_atomic.sql` | 18-127 (revoke/grant at 130-131) |
| `get_availability(date, int)` | `20260918100000_get_availability_no_ph.sql` | 30-164 (grant at 166) |
| `notify_reservation_insert()` | `20260813131000_vault_service_role_key.sql` | 15-30 |
| `notify_reservation_completed()` | `20260813131000_vault_service_role_key.sql` | 32-49 |

### T1 — Add PGlite and the npm script
**Do:** `npm install --save-dev @electric-sql/pglite`. In `package.json` add the script
`"test:sql": "node supabase/tests/pglite/run.mjs"` after `"test"`. Create the empty directory by adding
nothing else yet.
**Verify:** `node -e "import('@electric-sql/pglite').then(async m=>{const d=new m.PGlite();const r=await d.query(\"select '[\\\"a\\\"]'::jsonb ? 'a' as ok\");console.log(r.rows[0])})"` prints `{ ok: true }`; `grep '"test:sql"' package.json`.

### T2 — Stub schema
**Do:** Create `supabase/tests/pglite/stub-schema.sql`. Idempotent plain SQL, no data. It must contain
only what the migrations and function bodies touch (inferred from the migrations above and `src/` usage):
- `create role anon nologin; create role authenticated nologin;` (migrations `revoke`/`grant`/`create policy ... to anon`).
- `create schema vault; create table vault.decrypted_secrets (name text, decrypted_secret text);`
- `create schema net; create table net.http_calls (id bigserial primary key, url text, headers jsonb, body jsonb);`
  and `net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{"Content-Type":"application/json"}', timeout_milliseconds integer default 5000) returns bigint` that inserts into `net.http_calls` and returns the id. (Named-argument calls in the migrations must resolve.)
- `create schema cron;` with `cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text)`,
  `cron.job_run_details (runid bigserial primary key, jobid bigint, status text, start_time timestamptz, end_time timestamptz)`,
  `cron.schedule(job_name text, schedule text, command text) returns bigint` (insert, or update when the name exists) and `cron.unschedule(job_name text) returns boolean` (delete, true if a row was removed).
- `create publication supabase_realtime;`
- `public.settings (key text primary key, value text)`
- `public.blocked_dates (blocked_date date, is_closed boolean default false, max_pax integer, date_type text)`
- `public.operating_hours (day_type text, is_closed boolean default false, closed_days jsonb, sessions jsonb)`
- `public.slot_rules (day_type text, rule_type text, sessions jsonb, hold_duration_minutes integer)`
- `public.blackout_dates (block_date date, start_time time, end_time time)`
- `public.restaurant_tables (id uuid primary key default gen_random_uuid(), table_number text, capacity integer, x_position double precision, y_position double precision, is_bookable boolean default true, locked_until timestamptz, locked_by_reservation uuid, group_id uuid, created_at timestamptz default now())` — **no unique on `table_number`** (the migration adds it).
- `public.table_blocks (id uuid primary key default gen_random_uuid(), table_id uuid)`
- `public.reservations (id uuid primary key default gen_random_uuid(), customer_id uuid, reservation_date date, reservation_time time, guest_count integer, notes text, baby_chairs integer default 0, pets boolean default false, status text default 'confirmed', table_type text, tables_count integer, table_ids jsonb, needs_manual_assignment boolean default false, reminder_sent boolean default false, created_at timestamptz default now())` — **no check on `guest_count`** (the migration adds it).
`public_holidays` is created by migration `20260917200300`, not the stub. Comment at the top of the file:
"Replace with `supabase db dump --schema-only` once Perng takes the snapshot (audit plan, morning list 3)."
**Verify:** `node -e "import('@electric-sql/pglite').then(async m=>{const d=new m.PGlite();await d.exec(require('fs').readFileSync('supabase/tests/pglite/stub-schema.sql','utf8'));const r=await d.query(\"select count(*)::int n from information_schema.tables where table_schema in ('public','vault','net','cron')\");console.log(r.rows[0])})"` prints `n` ≥ 11 with no error.

### T3 — Runner and fixtures
**Do:** Create `supabase/tests/pglite/run.mjs` (ESM, Node, `import.meta.url` paths, no globals):
1. `new PGlite()`; `exec` the stub schema.
2. List `supabase/migrations/*.sql`, sorted by filename. Two constants at the top, each entry with a one-line reason:
   `SKIP = {}` (filename → reason; migrations that cannot run in PGlite) and `REWRITE = [...]`
   (`{ file, find, replace, reason }`, applied to the SQL text before exec). Seed `REWRITE` with exactly one entry:
   file `20260914170100_server_side_assignment.sql`, find `create extension if not exists pg_cron;`, replace `''`,
   reason "pg_cron is not available in PGlite; the `cron` schema stub provides what the migration calls".
   Apply each file with `db.exec`, outside any transaction. On failure print the filename and error and `process.exit(1)`.
   If another migration fails, fix it only by adding a SKIP or REWRITE entry with a reason, and list every entry you added in your report.
   Print `applied N, skipped M`.
3. List `supabase/tests/pglite/*.test.mjs` sorted. For each: `await db.exec('begin')`, `await seed(db)` (from `fixtures.mjs`),
   call the file's default export `async (ctx) => {}`, then always `await db.exec('rollback')`. Print `PASS name` / `FAIL name: message`.
   `ctx = { db, q, expectError, readMigration }` where `q(sql, params)` returns `rows`;
   `expectError(sql, params, pattern)` runs inside `savepoint`/`rollback to savepoint`, asserts it threw and that `error.message` matches `pattern` (RegExp), and fails if it did not throw;
   `readMigration(filename)` returns the file text. Use `node:assert/strict` inside tests.
4. Exit code 1 if any test failed or if zero test files were found.
Create `supabase/tests/pglite/fixtures.mjs` exporting `async function seed(db)` (runs inside the test's transaction):
- `operating_hours`: weekday `closed_days '[]'`, sessions `[{"label":"Dinner","start":"18:00","end":"20:00","last_booking":"19:30"}]`; weekend `closed_days '[]'`, sessions `[{"label":"Lunch","start":"12:00","end":"14:00","last_booking":"13:30"}]` (deliberately different so tests can tell which row was used).
- `slot_rules`: both `rule_type 'open'`, `hold_duration_minutes 120`, `sessions '[]'`.
- `restaurant_tables`: `('T1', 2, x 0)`, `('T2', 4, x 10)`, `('T3', 4, x 20)`, `('BT', 8, x 30)`, all bookable, y 0.
- Fixed test dates (document in a comment): Mon 2030-01-07 (weekday), Tue 2030-01-08, Fri 2030-01-11 (weekend).
**Verify:** `npm run test:sql` prints `applied 10, skipped 0` (or the listed skips), reaches the test step, and exits 1 with "no test files" (no tests exist yet). `grep -c "reason" supabase/tests/pglite/run.mjs` ≥ 1.

### T4 — Harness sanity test
**Do:** Create `supabase/tests/pglite/harness.test.mjs`: default export asserting (a) `to_regprocedure` is non-null for `public.assign_tables(date,time,integer,integer)`, `public.create_reservation_atomic(date,time,text,integer,uuid,text,integer,boolean)`, `public.amend_reservation_atomic(uuid,date,time,integer,text,integer,boolean)`, `public.get_availability(date,integer)`, `public.notify_reservation_insert()`; (b) `'["Tuesday"]'::jsonb ? 'Tuesday'` is true; (c) baseline: `select * from public.create_reservation_atomic('2030-01-07','19:00','weekday',2,null,null,0,false)` returns a row with `status = 'confirmed'`, `table_type = 'small'` and a non-null `table_ids`; (d) `public_holidays` exists (migration ran).
**Verify:** `npm run test:sql` prints `PASS harness` and exits 0.

### T5 — `assign_tables` with `p_exclude_reservation_id` (migration part 1)
**Do:** Create `supabase/migrations/20261017100000_booking_guards.sql` with a header comment (what the file does, "not applied by the build; owner runs `supabase db push`", and the source map above). First statement:
`drop function if exists public.assign_tables(date, time, integer, integer);`
then the **full** body of `assign_tables` copied from `20260914170100` lines 8-133 with the signature changed to
`(p_date date, p_time time, p_guest_count integer, p_hold_minutes integer, p_exclude_reservation_id uuid default null)`
and one added predicate in the `conflicting` CTE `where`: `and (p_exclude_reservation_id is null or r.id <> p_exclude_reservation_id)`. Then
`revoke execute on function public.assign_tables(date, time, integer, integer, uuid) from public, anon, authenticated;`
Create `assign_tables.test.mjs`: (1) `select count(*) from pg_proc where proname = 'assign_tables'` equals 1; (2) `has_function_privilege('anon', 'public.assign_tables(date,time,integer,integer,uuid)', 'execute')` is false, same for `authenticated`; (3) set T2, T3, BT `is_bookable = false` so only T1 remains; insert a reservation Mon 2030-01-07 19:00, 2 guests, `status 'confirmed'`, `table_ids` = `jsonb_build_array(<T1 id>::text)`; `assign_tables('2030-01-07','19:30',2,120)` returns `flagged = true`; `assign_tables('2030-01-07','19:30',2,120,<that reservation id>)` returns `flagged = false` and `table_ids = {T1}`; (4) the 4-argument form with a free time (`'12:00'`) still works.
**Verify:** `npm run test:sql` — `PASS assign_tables`, `PASS harness`, exit 0.

### T6 — `create_reservation_atomic` guards (migration part 2)
**Do:** Append to the migration the **full** body of `create_reservation_atomic` copied from `20260914170100` lines 139-270 (signature unchanged: `p_reservation_date date, p_reservation_time time without time zone, p_day_type text, p_guest_count integer, p_customer_id uuid, p_notes text, p_baby_chairs integer, p_pets boolean`; keep `RETURNS reservations`, `SECURITY DEFINER`, `SET search_path TO 'public'`). Edits:
1. Declare `v_day_type text; v_today date; v_now_mins integer;`.
2. Immediately after `begin` (before the `blocked_dates` read), in this order:
   - `if p_guest_count is null or p_guest_count < 1 then raise exception 'invalid_guest_count: Guest count must be at least 1.';`
   - `v_today := (now() at time zone 'Asia/Kuala_Lumpur')::date;` then `if p_reservation_date < v_today then raise exception 'past_date: Sorry, that date has already passed.';`
   - `if p_reservation_date = v_today then v_now_mins := extract(hour from (now() at time zone 'Asia/Kuala_Lumpur'))::int * 60 + extract(minute from (now() at time zone 'Asia/Kuala_Lumpur'))::int; if extract(hour from p_reservation_time)::int * 60 + extract(minute from p_reservation_time)::int < v_now_mins + 30 then raise exception 'time_passed: Sorry, that time has already passed. Please choose a later time.';` with a comment "30 = LEAD_TIME_MINUTES in src/lib/slotCutoff.js". Whole-minute comparison, same as `isSlotBookable`.
3. After the `v_day_name` assignment add `v_day_type := case when extract(dow from p_reservation_date)::int in (5, 6) then 'weekend' else 'weekday' end;` with a comment that `p_day_type` is accepted for signature compatibility and ignored. Replace the two `day_type = p_day_type` reads (`operating_hours` at line 179, `slot_rules` at line 183) with `v_day_type`.
4. Fix the typo: the message at line 181 becomes `'date_closed: Sorry, we are closed on %.'`.
5. The `assign_tables` call (lines 249-250) passes the 5th argument explicitly: `..., v_duration_minutes, null::uuid)`.
Re-state the existing grants: there are none on create today (keep it that way; do not add or remove grants).
Create `create_guards.test.mjs`, each case via `expectError` unless noted, calls with `p_day_type` as given:
- guest 0 and -1 on Mon 2030-01-07 19:00 → `/^invalid_guest_count/`.
- date `2020-01-06` → `/^past_date/`.
- same day (read KL date and minutes with `select ... at time zone 'Asia/Kuala_Lumpur'`), time = now + 10 minutes → `/^time_passed/`; time = now − 5 minutes when KL minutes ≥ 5 → `/^time_passed/`. (Do not assert the success side of the cutoff: it would depend on the wall clock and the fixture sessions.)
- Tuesday 2030-01-08 19:00 passed as `'weekend'` after `update operating_hours set closed_days = '["Tuesday"]' where day_type = 'weekday'` → `/^date_closed: Sorry, we are closed on Tuesday\.$/`.
- Friday 2030-01-11 12:30 passed as `'weekday'` **succeeds** (proves weekend hours were used, since weekday sessions are 18:00-20:00); Friday 19:00 passed as `'weekend'` → `/^invalid_time_slot/`.
- 7 guests Mon 19:00 → `status 'confirmed'`, `table_type 'big'`; 9 guests Mon 19:00 (fresh test) → `status 'pending'`, `table_type 'big'`, `tables_count 1` (the pending-confirmation path stays unchanged).
- 11 guests → `/^party_too_large/`.
**Verify:** `npm run test:sql` — `PASS create_guards`; `grep -c "= any(v_hours.closed_days)" supabase/migrations/20261017100000_booking_guards.sql` is 0; `grep -c "p_day_type" ` of the migration shows only the signature and the comment.

### T7 — `amend_reservation_atomic` fixes (migration part 3)
**Do:** Append the **full** body of `amend_reservation_atomic` copied from `20260922150000` lines 18-127, then the revoke/grant from lines 130-131 (same signature, so `create or replace` is fine). Edits:
1. Declare `v_table_type text; v_tables_count integer; v_big_table_booked boolean; v_booking_start_mins integer; v_booking_end_mins integer;`.
2. Replace the cancelled check (lines 48-49) with: `cancelled` stays as is (`'cancelled: A cancelled booking cannot be amended.'`), then
   `if v_reservation.status not in ('pending', 'confirmed', 'seated') then raise exception 'not_amendable: A % booking cannot be amended.', v_reservation.status;`
3. After the `pg_advisory_xact_lock` and the old-table release, compute the type exactly as create does:
   `v_booking_start_mins := hour*60+minute of p_reservation_time; v_booking_end_mins := v_booking_start_mins + v_duration_minutes;`
   `select coalesce(bool_or(r.table_type = 'big'), false) into v_big_table_booked from reservations r where r.reservation_date = p_reservation_date and r.id <> p_id and r.status in ('confirmed','pending','seated') and (start mins of r) < v_booking_end_mins and (start mins of r) + v_duration_minutes > v_booking_start_mins;`
   then `if p_guest_count > 5 and not v_big_table_booked then v_table_type := 'big'; v_tables_count := 1; else v_table_type := 'small'; v_tables_count := case when p_guest_count <= 2 then 1 else ceil((p_guest_count - 2) / 2.0)::int end; end if;`
   (create's rule: 6-8 and >8 both choose big when no big table is booked; >10 only raises in create, amend never raises on size.) Do **not** change `status`.
4. The `assign_tables` call (lines 102-103) passes `p_id` as the 5th argument.
5. In the `update reservations` add `table_type = v_table_type, tables_count = v_tables_count,` and
   `reminder_sent = case when p_reservation_date is distinct from reservations.reservation_date or p_reservation_time is distinct from reservations.reservation_time then false else reservations.reminder_sent end` (table-qualified columns read the pre-update values).
Create `amend.test.mjs`: (1) set T2, T3, BT `is_bookable = false` (only T1 left); `create_reservation_atomic` Mon 19:00 2 guests → T1; amend to 19:30 (same date, 2 guests) → returned `table_ids = [T1]` and `needs_manual_assignment = false`; (2) amend 2→7 guests: `table_type 'big'`, `tables_count 1`; amend back to 2: `'small'`, `tables_count 1`; (3) `status` set to `'completed'` → `/^not_amendable/`, `'no_show'` → `/^not_amendable/`, `'cancelled'` → `/^cancelled/`, `'seated'` and `'pending'` amend OK; (4) `reminder_sent = true` then amend notes only → still true, amend time 19:00→19:30 → false, amend date → false; (5) guest 0 → `/^invalid_guest_count/`, date 2020-01-06 → `/^past_date/`, `/^not_found/` for a random uuid.
**Verify:** `npm run test:sql` — `PASS amend`, all earlier PASS.

### T8 — `get_availability` (migration part 4)
**Do:** Append the **full** body of `get_availability(p_date date, p_guest_count int)` copied from `20260918100000` lines 30-164 plus `grant execute ... to anon, authenticated` (line 166); same signature and `returns table (slot time, day_type text, requires_approval boolean)`. Edits:
1. `if p_guest_count < 1 or p_guest_count > 10 then return; end if;` (was `> 10` only).
2. Add `stable` after `language plpgsql`.
3. Hoist: before the session loop read once into `jsonb` variables (a) blackout rows as `{whole, s, e}` — `whole` = both times null, `s`/`e` minutes with the same `coalesce(... '00:00' / '23:59')` rule — and (b) the day's active reservations (`status in ('confirmed','pending','seated')`) as `{start, guests, big}` (`start` = minutes, `big` = `coalesce(table_type = 'big', false)`, `guests` = `guest_count`). Per slot, compute `v_is_blacked_out` and `v_booked_small_seats` / `v_big_table_booked` from those arrays with `jsonb_array_elements` using the identical overlap predicates (`start < slot_end and start + v_duration > slot_start`; a null `table_type` still counts as small). Remove the per-slot `for ... from blackout_dates` loop and per-slot `from reservations` read. If this makes the function harder to follow than the original, keep the per-slot reads and ship only items 1-2 (say so in the report).
Create `availability.test.mjs` (Mon 2030-01-07, fixture capacity small = 10): guest 0 → 0 rows; baseline 2 guests → 4 slots (18:00, 18:30, 19:00, 19:30); 8 guests booked at 18:00 (`table_type 'small'`) → 2 guests still 4 slots, 3 guests → 0; a `blackout_dates` row 18:00-19:00 → slots 19:00 and 19:30 remain; a row with both times null → 0 rows; `blocked_dates` closed → 0 rows; Tuesday with weekday `closed_days '["Tuesday"]'` → 0 rows; Friday 2030-01-11 returns the weekend `12:00`-`13:30` slots with `day_type = 'weekend'`; `select provolatile from pg_proc where proname = 'get_availability'` is `'s'`.
**Verify:** `npm run test:sql` — `PASS availability`.

### T9 — Trigger functions (migration part 5)
**Do:** Append full re-declarations of `public.notify_reservation_insert()` (source lines 15-30) and `public.notify_reservation_completed()` (source lines 32-49) of `20260813131000`, each `returns trigger language plpgsql security definer set search_path to 'public', 'vault', 'pg_temp'`. Keep each body's logic and URL; wrap the vault read and `net.http_post` in `begin ... exception when others then raise warning '<function name>: http_post failed: %', sqlerrm; end;` and, if the key is null, `raise warning '<fn>: tonda_service_role_key missing from vault; alert skipped'` and `return NEW` (copy the pattern from `20260914170000` lines 6-40). `notify_reservation_completed` keeps its `status = 'completed' and (OLD.status is null or OLD.status <> 'completed')` guard. Do not touch `notify_staff_new_reservation` or any trigger definition.
Create `triggers.test.mjs`: (1) `pg_proc.prosecdef` is true and `proconfig` contains `search_path=public, vault, pg_temp` for both; (2) inside the test create the two missing triggers (`after insert on public.reservations ... notify_reservation_insert()`, `after update on public.reservations ... notify_reservation_completed()`) and `insert into vault.decrypted_secrets values ('tonda_service_role_key','k')`; inserting a reservation logs one `net.http_calls` row whose url ends `/send-confirmation-email` and whose `headers->>'Authorization'` is `Bearer k`; updating it to `'completed'` logs one `/send-thankyou-email` row; updating again logs no more; (3) with the vault row deleted, an insert succeeds and logs no call; (4) after `create or replace function net.http_post(...)` redefined to `raise exception 'boom'` (same signature as the stub; rolled back with the test), an insert and a status update still succeed.
**Verify:** `npm run test:sql` — `PASS triggers`.

### T10 — Constraints, index, cron housekeeping (migration part 6)
**Do:** Append, each idempotent:
- `check (guest_count > 0)`: guarded `do $$` adding constraint `reservations_guest_count_positive` `not valid` when absent, then `validate constraint` inside a nested `begin ... exception when check_violation then raise notice '...left NOT VALID: existing rows violate it' end` so live bad rows cannot roll the whole migration back.
- `unique (table_number)`: `do $$` — if any `table_number` has `count(*) > 1`, `raise notice 'restaurant_tables has duplicate table_number values; unique constraint not added'`; else add constraint `restaurant_tables_table_number_key` if absent.
- `create index if not exists reservations_date_status_idx on public.reservations (reservation_date, status);`
- Weekly purge: `do $$` — if `cron.job` has `jobname = 'purge-cron-run-details'`, `cron.unschedule(...)`; then `cron.schedule('purge-cron-run-details', '0 3 * * 0', $cmd$ delete from cron.job_run_details where end_time < now() - interval '14 days' $cmd$)` (same shape as the reminder job in `20260914170100` lines 319-336; Supabase cron runs in UTC, so Sunday 03:00 UTC).
Create `housekeeping.test.mjs`: (1) inserting a reservation with `guest_count 0` fails `/violates check constraint/`; `pg_constraint.convalidated` is true; (2) a duplicate `table_number` insert fails `/unique|duplicate/i`; (3) `pg_indexes` has `reservations_date_status_idx`; (4) `cron.job` has exactly one `purge-cron-run-details` row and exactly one `send-reminder-email` row; running its `command` deletes a `job_run_details` row ended 20 days ago and keeps one ended 1 day ago; (5) idempotence: `await db.exec(readMigration('20261017100000_booking_guards.sql'))` a second time does not throw and still leaves one purge job and one constraint; (6) duplicate branch: drop the unique constraint, insert a second `T1`, re-run the migration, expect no throw and no `restaurant_tables_table_number_key` constraint.
**Verify:** `npm run test:sql` — all files PASS, exit 0.


## Verify (whole package)

- `npm run build` exit 0.
- `npm test` passes (unchanged vitest suite; nothing in `src/` changes).
- `npm run test:sql` exit 0: migrations applied, every `*.test.mjs` PASS (harness, assign_tables, create_guards, amend, availability, triggers, housekeeping).
- `npm run lint`: no new problems against the count recorded on clean `main` (CLAUDE.md: 14 = 10 errors / 4 warnings; package 02 measured 16 = 11 / 5).
- `git diff --name-only main` lists only the Files table.
- `grep -c "= any(v_hours.closed_days)" supabase/migrations/20261017100000_booking_guards.sql` is 0; `grep -n "day_type === 'public_holiday'" -r src` unchanged (empty).
- No migration applied, no function deployed. Owner review before `supabase db push`: read the migration top to bottom; the first `drop function` and the `validate constraint` block are the two statements that touch existing objects.

## Out of scope

- Big-table/BT and the 9-10 pax approval rule (Perng's morning list, item 4).
- Dropping `p_day_type` from `create_reservation_atomic`; the booking page's switch to `get_availability` (Tonda 05).
- Making `get_availability` drop same-day past slots (create now rejects them; the client still filters with `isSlotBookable` until Tonda 05).
- Creating `on_reservation_insert` / `on_reservation_completed` in a migration (they exist live; the tests create them locally).
- A same-day lead-time check in `amend_reservation_atomic` (staff may amend off-grid on purpose).
- RLS lockdown (Tonda 10), edge functions and send-once columns (Tonda 04), Round-side ports.
- Replacing the stub schema with a real `supabase db dump --schema-only` (needs Perng's snapshot).
- Cleaning live data (expired table locks, stale bookings, counter drift).
