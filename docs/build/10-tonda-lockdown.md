# 10 — Tonda lockdown: row-level security on Tonda's Supabase project

**MERGE LAST, only after 05, 06, 07 are deployed.** Merging or applying this earlier breaks the public booking site (slots, manage-booking and feedback pages stop loading) and parts of admin.

**Perng's prerequisites (nothing here is automated):**
1. **Disable public sign-ups** in Supabase Auth on both projects (Tonda `qeepslmexektwqhxzwqs` and Round): Authentication -> Sign In / Providers -> turn off "Allow new users to sign up", and confirm "Allow anonymous sign-ins" is off. RLS below treats *any* signed-in user as staff, so an open sign-up would be a staff account for anyone.
2. Tonda 05, 06 and 07 are merged **and deployed to production** and smoke-tested (booking page uses `get_availability`; manage/feedback pages use RPCs; admin sign-in works), and Round 04 is applied (06 and 07 call its RPCs).
3. Before applying, save the current policies: `select schemaname, tablename, policyname, cmd, roles, qual, with_check from pg_policies where schemaname = 'public' order by tablename, policyname;` (the migration drops every existing policy, so this is the only record).
4. Apply with `supabase db push` yourself, from the main checkout (never from a worktree). Emergency rollback if a public page breaks: `alter table public.<table> disable row level security;` for the table involved (no policies needed to restore the old open behaviour).

Today anon can read Tonda `reservations` (48 rows, count-only probe 2026-10-17) and `restaurant_tables` (including `locked_by_reservation` ids, which are booking-cancel capabilities; `Reservations.jsx:56` reads it), and Round's 2026-09-14 audit recorded anon writes on several config tables. After this package every Tonda table has RLS on and exactly the policies below; the public site
only touches the tables it needs, through RPCs or insert-only. This closes Tonda's side of the hole; Round's shared tables are closed by Round 06.

Branch: `build/10-tonda-lockdown`
Brainstormed: 2026-10-17. Decisions made by Claude under Perng's 2026-10-17 "work autonomously" instruction; see docs/build/2026-10-17-audit-plan.md
Depends on: Tonda 05, 06, 07 deployed (and 03 merged: this package uses its PGlite harness, `npm run test:sql`).

---

## Plan discrepancies

- This brief was drafted before `05-*.md`, `06-*.md`, `07-*.md` existed in `docs/build/`, so the per-table access map below is derived from the plan and from
  the code on main `00a0bf6`. **T1 re-derives it from the merged code and the three briefs; if they disagree with the map, stop and report.**
- The plan says `customers` is "Tonda's empty copy". No migration in `supabase/migrations` creates Tonda's `customers` (the pre-2026-09 schema is not versioned) and no Tonda code reads it
  (every `from('customers')` goes through `supabaseCustomers` to Round). The migration still locks it as planned.
- Schema for most of these tables is not in the repo, so the PGlite stubs declare only the columns the tests need (`create table if not exists`).
- Public inserts do **not** chain `.select()` (checked on main): `Events.jsx:48-63` (`events`), `Offsite.jsx:55-77` (`offsite_bookings`) and `ExperienceDetail.jsx:85-91`
  (`experience_registrations`) call `.insert([...])` and read only `{ error }`. Insert-only anon policies are therefore sufficient and no change to those pages is needed.
  (A future `.insert().select()` there would fail with an RLS error because anon has no SELECT; T6 asserts that behaviour so nobody adds it unknowingly.)
  The `.insert().select().single()` in `supabaseCustomers.js:89-93` targets **Round's** `customers`, not a table in this migration (Round 04/06).
- `experiences` anon SELECT (per plan) returns draft experiences too, since `ExperienceDetail.jsx:36` fetches by id with no status filter. Locked by the plan; listed for Perng's morning review, not changed here.
- `assign_tables` is revoked from anon/authenticated and runs inside the `security definer` functions, `amend_reservation_atomic` is granted to `authenticated` only,
  and `claim_restaurant_tables` (live-only, `docs/superpowers/specs/2026-09-14-tonda-live-db-reference.txt`) is `security definer`. Function grants are out of scope; whether `claim_restaurant_tables`
  is executable by anon should be checked on the live project (see Out of scope).

## Decisions

| Question | Chosen | Rejected | Why |
|---|---|---|---|
| Existing policies | A loop over `pg_policies` drops **every** policy on each listed table, then RLS is enabled and exactly the policies below are created | Dropping known policy names | Plan; unknown legacy policies are how the holes survived |
| `reservations`, `table_groups`, `customers`, `restaurant_tables`, `table_blocks` | `authenticated` all; anon none. (`restaurant_tables` exposes `locked_by_reservation` ids, which are cancel capabilities) | Anon read for availability | Plan; availability is `get_availability` (security definer) |
| `operating_hours`, `slot_rules`, `blocked_dates`, `blackout_dates`, `experiences`, `public_holidays` | `anon` select; `authenticated` all | — | Plan |
| `settings` | `anon` select only where `key like 'confirmation\_message\_%'`; `authenticated` all | Anon select all (leaks `staff_alert_email`) | Plan |
| `events`, `offsite_bookings`, `experience_registrations` | `anon` insert only; `authenticated` all | Anon select (customer data) | Plan |
| Realtime | Unaffected for admins (they are `authenticated`); no public page subscribes | — | Plan |
| Sign-ups | Perng disables public sign-ups on both projects before merge | Policy that checks an `is_staff` claim | Plan: "RLS treats any signed-in user as staff" |
| Coverage notice | The migration ends with a block that `raise notice`s any other `public` table without RLS **(Claude)** | Silent | Tables outside the list (unknown pre-2026-09 schema) should be visible to Perng in the push output |
| Test of the policies | PGlite via `npm run test:sql` using `set role anon` / `set role authenticated` | Testing against the live project | Plan ground rules: no live DB access, migrations verified offline |

## Files

Exhaustive. Anything else needs the PR body to declare it.

| Path | Change |
|---|---|
| `supabase/migrations/20261017100300_tonda_rls_lockdown.sql` | new — the migration (written below) |
| `supabase/tests/pglite/stub_rls_roles_and_tables.sql` | new — stub roles `anon`/`authenticated`, grants, minimal `create table if not exists` for the 15 tables (name/location follows Tonda 03's layout; if 03 already creates the roles, drop the duplicates) |
| `supabase/tests/pglite/rls_lockdown.test.js` | new — the cases (file name/extension and registration follow Tonda 03's runner convention: read the runner first; if cases are discovered differently, follow that and say so in the PR) |

No application code changes. If T1 finds a public page that still touches a locked table, do not patch it here: stop and report which package missed it.

## Invariants touched

- Availability and table assignment are server-side (`get_availability`, `create_reservation_atomic`, `assign_tables`): this package makes that true at the database level; the `security definer` functions bypass RLS (owner `postgres`), the client no longer can.
- `operating_hours.closed_days` jsonb, weekend = Fri/Sat, local date strings, customer counters on Round's `customers`: not touched. The migration must not contain `= any(v_hours.closed_days)` or `public_holiday` logic.
- Admin theme tokens: not applicable.

## Access map after Tonda 05 / 06 / 07 (verify in T1)

"Anon" = public pages with the anon key. "Auth" = admin pages signed in. Edge functions and `pg_cron` use the service role / `security definer` and bypass RLS.

| Table | Anon reads/writes after 05/06/07 | Authenticated code | Policy | Covered |
|---|---|---|---|---|
| `reservations` | None directly. Reads removed by 05 (`Reservations.jsx` `from('reservations')` at 137/153) and 06 (`ManageBooking.jsx:24`, `Feedback.jsx:103` become `get_booking` / `feedback_reservation`). Writes only via RPCs `create_reservation_atomic`, `cancel_reservation` (both `security definer`) | `Bookings.jsx:259` select, `:307` status update, `EditReservationForm.jsx` (rpc `amend_reservation_atomic`), `Tables.jsx` select/update `table_ids`, `Dashboard.jsx` counts, `tableAvailability.js:128`, Realtime in `Bookings`, `Tables`, `useReservationInserts.js` | auth all | yes |
| `restaurant_tables` | None after 05 (`Reservations.jsx:56` deleted). `get_availability` reads it as definer | `Tables.jsx` select/update/insert/delete + Realtime, `Bookings.jsx:262`, `Experiences.jsx:79`, `tableAvailability.js:126`, rpc `claim_restaurant_tables` | auth all | yes |
| `table_blocks` | None | `Tables.jsx` insert/delete/select + Realtime, `Experiences.jsx` insert/delete, `tableAvailability.js:133` | auth all | yes |
| `table_groups` | None | `Tables.jsx` (`mergeTables` insert, `unmergeTables` delete) | auth all | yes |
| `customers` (Tonda copy) | None | None (all customer access is Round via `supabaseCustomers`) | auth all | yes |
| `operating_hours` | `Reservations.jsx:27` `getDateInfo` (select) | `SlotRules.jsx` select/insert/update | anon select + auth all | yes |
| `slot_rules` | `Reservations.jsx:37` (select) | `SlotRules.jsx`, `Tables.jsx:261` (select) | anon select + auth all | yes |
| `blocked_dates` | `Reservations.jsx:16` (select) | `SlotRules.jsx` insert/delete/select | anon select + auth all | yes |
| `blackout_dates` | `Reservations.jsx:67` read removed by 05; policy kept per plan | `SlotRules.jsx` | anon select + auth all | yes |
| `experiences` | `Reservations.jsx:293` (select published), `ExperienceDetail.jsx:36,44` (select) | `Experiences.jsx` all writes | anon select + auth all | yes |
| `public_holidays` | None today (PH logic disabled 2026-09-18); `get_availability` is definer | None | anon select + auth all | yes |
| `settings` | `Reservations.jsx:483` key `confirmation_message_reservation`, `Events.jsx:66` `confirmation_message_event`, `Offsite.jsx:80` `confirmation_message_offsite` (all match `confirmation\_message\_%`) | `Settings.jsx` select `*`, upsert (includes `staff_alert_email`) | anon select (key filter) + auth all | yes |
| `events` | `Events.jsx:48` insert, no `.select()` | `Bookings.jsx:260` select, `:307` update, `Dashboard.jsx:18` count | anon insert + auth all | yes |
| `offsite_bookings` | `Offsite.jsx:55` insert, no `.select()` | `Bookings.jsx:261`, `:307`, `Dashboard.jsx:19` | anon insert + auth all | yes |
| `experience_registrations` | `ExperienceDetail.jsx:85` insert, no `.select()` | `Experiences.jsx:78,221,240,318` select | anon insert + auth all | yes |

## The migration (exact)

`supabase/migrations/20261017100300_tonda_rls_lockdown.sql`:

```sql
-- Tonda lockdown (package 10): row-level security on Tonda's project.
-- APPLY LAST: only after Tonda 05, 06 and 07 are deployed, and public sign-ups are disabled.
-- Drops EVERY existing policy on the listed tables, enables RLS, creates exactly the policies below.
-- Idempotent: safe to run twice.

do $$
declare
  t text;
  p record;
  locked text[] := array[
    'reservations', 'table_groups', 'customers', 'restaurant_tables', 'table_blocks',
    'operating_hours', 'slot_rules', 'blocked_dates', 'blackout_dates', 'experiences', 'public_holidays',
    'settings', 'events', 'offsite_bookings', 'experience_registrations'
  ];
  anon_select text[] := array[
    'operating_hours', 'slot_rules', 'blocked_dates', 'blackout_dates', 'experiences', 'public_holidays'
  ];
  anon_insert text[] := array['events', 'offsite_bookings', 'experience_registrations'];
begin
  foreach t in array locked loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy staff_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;

  foreach t in array anon_select loop
    execute format('create policy anon_select on public.%I for select to anon using (true)', t);
  end loop;

  foreach t in array anon_insert loop
    execute format('create policy anon_insert on public.%I for insert to anon with check (true)', t);
  end loop;
end;
$$;

create policy anon_select_confirmation_messages on public.settings
  for select to anon using (key like 'confirmation\_message\_%');

-- Visibility only: any other public table still without RLS shows up in the push output.
do $$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    raise notice 'public.% has RLS disabled and is not covered by this migration', r.relname;
  end loop;
end;
$$;
```

Do not add grants or revokes: Supabase's default table grants to `anon`/`authenticated` stay; RLS is the gate.

One function-grant exception (Opus review): `claim_restaurant_tables` is `security definer` (live snapshot
`docs/superpowers/specs/2026-09-14-tonda-live-db-reference.txt` line 4) and only the admin Tables page calls it,
so a definer function left executable by anon would bypass the lockdown. Append to the migration:

```sql
revoke execute on function public.claim_restaurant_tables(uuid[], uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.claim_restaurant_tables(uuid[], uuid, timestamptz, timestamptz) to authenticated;
```

The stub schema needs a stub `claim_restaurant_tables` with that signature (body `select null::uuid where false`)
so the statement applies in PGlite; T6 asserts `has_function_privilege('anon', 'public.claim_restaurant_tables(uuid[],uuid,timestamptz,timestamptz)', 'execute')` is false.

## Tasks

Global: work only in the files named; `npm run test:sql`, `npm test`, `npm run build` must pass; `npm run lint` no new problems (no JS under `src/` changes, so the count must be identical to main).
Stage by path, never `git add -A`. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. **The migration is a file only: never run `supabase db push` or touch the live project.** Working-tree text files are CRLF; keep them.

### T1 — Re-derive the access map from merged code
**Do:** Branch from a `main` that contains 03, 05, 06, 07. Read `docs/build/05-*.md`, `06-*.md`, `07-*.md` and run, from the repo root:
`grep -rnE "\.from\('(reservations|restaurant_tables|table_blocks|table_groups)'\)" src/pages/Reservations.jsx src/pages/ManageBooking.jsx src/pages/Feedback.jsx src/pages/ExperienceDetail.jsx src/pages/Events.jsx src/pages/Offsite.jsx src/pages/Home.jsx src/components/Navbar.jsx src/components/Footer.jsx src/supabaseCustomers.js`
(must be empty), `grep -rn "\.from('settings')" src/pages` (public hits must filter on a `confirmation_message_*` key), and `grep -rnE "\.insert\(" -A12 src/pages/Events.jsx src/pages/Offsite.jsx src/pages/ExperienceDetail.jsx | grep "\.select("` (must be empty: no chained `.select()`).
Also `grep -rn "\.rpc(" src` and confirm every public RPC (`get_availability`, `create_reservation_atomic`, `cancel_reservation`, `get_booking`, `feedback_reservation`) is `security definer` in `supabase/migrations/` (06's migration for the last two).
Update nothing; paste the result and any difference from the access map above into the PR body.
**Verify:** all three greps behave as stated; if any public page still touches a locked table, stop and report the package that missed it.

### T2 — Stub roles and tables for the harness
**Do:** First read `supabase/tests/pglite/` (runner, existing stub schema, one case file) as merged by Tonda 03 and follow its conventions. Create `supabase/tests/pglite/stub_rls_roles_and_tables.sql`: `create role anon nologin;` and `create role authenticated nologin;` (guard with `do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') ...`), `grant usage on schema public to anon, authenticated;`, then `create table if not exists public.<t> (...)` for the 15 tables with only: `reservations(id uuid primary key default gen_random_uuid(), status text, reservation_date date)`, `settings(key text primary key, value text)`, `events(id uuid primary key default gen_random_uuid(), event_type text)`, same shape with `event_type` for `offsite_bookings`, `experience_registrations(id ..., name text)`, `operating_hours(id ..., day_type text)`, `slot_rules(id ..., day_type text)`, `blocked_dates(id ..., blocked_date date)`, `blackout_dates(id ..., block_date date)`, `experiences(id ..., name text)`, `public_holidays(id ..., holiday_date date)`, `restaurant_tables(id ..., table_number text)`, `table_blocks(id ...)`, `table_groups(id ...)`, `customers(id ..., full_name text)`; finish with `grant select, insert, update, delete on all tables in schema public to anon, authenticated;`. `create table if not exists` lets 03's richer stubs win.
**Verify:** `npm run test:sql` still passes (existing cases unaffected); the new SQL file loads on its own in the harness without error.

### T3 — Test scaffolding, red first
**Do:** Create `supabase/tests/pglite/rls_lockdown.test.js` (shape per 03's runner). Setup: load 03's stub schema, then `stub_rls_roles_and_tables.sql`; as the superuser seed one row each: a `reservations` row (`status 'confirmed'`), `settings` rows `confirmation_message_event` and `staff_alert_email`, one row in every other listed table; simulate the live state by creating permissive legacy policies, e.g. `alter table public.reservations enable row level security; create policy "Allow public read" on public.reservations for select to anon using (true);` and `create policy "Allow public insert" on public.events for insert to anon with check (true);`. Add one case "migration file exists and applies" that reads `supabase/migrations/20261017100300_tonda_rls_lockdown.sql` and executes it (it will fail until T4, which is the red step). Helper `asRole(role, fn)`: `set role <role>`, run, `reset role` in a `finally`.
**Verify:** `npm run test:sql` fails only on the new "applies" case (file missing).

### T4 — Write the migration
**Do:** Create `supabase/migrations/20261017100300_tonda_rls_lockdown.sql` containing exactly the SQL in "The migration (exact)" above (comments included). Do not rename policies or reorder.
**Verify:** `npm run test:sql` — the "applies" case passes; `grep -c "create policy" supabase/migrations/20261017100300_tonda_rls_lockdown.sql` = 4; `grep -n "any(v_hours" supabase/migrations/20261017100300_tonda_rls_lockdown.sql` empty.

### T5 — Structure cases
**Do:** In the test file add cases (run the migration once in a `beforeAll`): (1) every one of the 15 tables has `relrowsecurity = true` (`select relname from pg_class where relname = any(...) and not relrowsecurity` is empty); (2) the legacy policies are gone: `select count(*) from pg_policies where policyname in ('Allow public read', 'Allow public insert')` = 0; (3) policy set per table equals the plan: `reservations`/`table_groups`/`customers`/`restaurant_tables`/`table_blocks` have exactly `{staff_all}`; the six config tables `{staff_all, anon_select}`; `settings` `{staff_all, anon_select_confirmation_messages}`; the three enquiry tables `{staff_all, anon_insert}`; (4) idempotent: execute the migration file a second time, then the same counts hold and there is no error.
**Verify:** `npm run test:sql` all green; mutate the migration locally (remove one table from `locked`) and watch case 1 or 3 fail, then revert.

### T6 — Anon cases
**Do:** Using `asRole('anon', ...)`: (a) `select count(*) from public.reservations` = 0 although the superuser seed has 1 row (anon cannot select reservations); (b) `insert into public.reservations (status) values ('pending')` rejects with `/row-level security/`; `update public.reservations set status = 'cancelled'` affects 0 rows and `delete` affects 0 rows (verify as superuser the seed row is untouched); (c) `insert into public.events (event_type) values ('birthday')` succeeds, and `insert into public.events (event_type) values ('x') returning id` rejects with `/row-level security/` (documents why public inserts must not chain `.select()`); same plain insert succeeds for `offsite_bookings` and `experience_registrations`; (d) `select count(*)` is 0 for `events`, `offsite_bookings`, `experience_registrations`, `restaurant_tables`, `table_blocks`, `table_groups`, `customers`; (e) `settings`: `select key from public.settings` returns only `confirmation_message_event`; (f) `select count(*)` is >= 1 for `operating_hours`, `slot_rules`, `blocked_dates`, `blackout_dates`, `experiences`, `public_holidays`, and `insert into public.slot_rules (day_type) values ('x')` rejects with `/row-level security/`; (g) anon cannot insert into `restaurant_tables`.
**Verify:** `npm run test:sql` green; each rejected statement asserts the error text, not just "throws".

### T7 — Authenticated and definer-path cases
**Do:** Using `asRole('authenticated', ...)`: select/insert/update/delete succeed on `reservations` and `restaurant_tables`; `select key from public.settings` returns both seeded keys (incl. `staff_alert_email`); can read `events`. Definer path: if 03's stub schema defines `get_availability` and `cancel_reservation` (check with `grep -n "get_availability\|cancel_reservation" supabase/tests/pglite/*`), call each as `anon` and assert it succeeds and returns data/true although anon has no direct table access (RLS bypassed by the definer owner); if 03 did not stub them, add a one-line `skip` with the reason and say so in the PR.
**Verify:** `npm run test:sql` green.

## Verify (whole package)

- `npm run test:sql`, `npm test`, `npm run build` all exit 0; `npm run lint` identical to main (no JS changed).
- Invariant greps (CLAUDE.md) unchanged: `grep -rnE "toISOString\(\)\.slice\(0, ?10\)" src` empty; `grep -rn "day_type === 'public_holiday'" src` empty; `grep -rnE "= any\(v_hours\.closed_days\)" supabase/migrations` only the historical hit in `20260917200400_get_availability.sql`.
- The PR body lists: the T1 grep results; the confirmation that no public insert chains `.select()` (Events, Offsite, ExperienceDetail); the 15-table access map with any deviation; the "applies twice" result.
- **Owner steps after merge (Perng), in this order:** complete the prerequisites at the top; `supabase db push` (read the notices: any table named there is a Tonda table this migration does not cover); then smoke on production: make a booking (slots load, confirmation shows), open the manage link and cancel, submit a feedback, submit an Events enquiry and an Experience registration, then admin: Bookings, Floor Plan (drag, assign), Slot Rules, Settings, Experiences, Customers, Dashboard. Finally an anon-key count-only probe of `reservations` and `restaurant_tables` should return 0 rows.

## Out of scope

- Round's shared tables (`customers`, `customer_visits`, `feedback`): Round 06. Round's own `reservations`/config tables: follow-up port.
- Function grants (e.g. whether anon can execute `claim_restaurant_tables`): check on the live project and fix in a separate package; storage bucket `event-posters` policies; hiding draft `experiences` from anon.
- Splitting "staff" from "any authenticated user" (custom claim / `is_staff` table): depends on sign-ups being disabled instead (plan).
- Any change to `src/` application code; if T1 finds a gap, the owning package (05/06/07) fixes it.
- Schema snapshot (`supabase db dump --schema-only`) to replace the PGlite stubs: on Perng's morning list.
