# Audit remediation plan — 2026-10-17

Source: the 2026-10-17 audit of tonda-reservation (4 Sonnet auditors, findings verified by Opus) plus
Round's deferred `round-reservation/docs/superpowers/specs/2026-09-14-anon-policy-audit.md`.
Perng asked for every problem and every suggested improvement to be planned and worked
**autonomously overnight**. Perng was not available to answer questions, so every decision below
marked **(Claude)** was made by Claude under that instruction. Review those first in the morning.

## Ground rules for the overnight run
- PRs only. Nothing merged, nothing deployed, **no migration applied, no edge function deployed**.
- Migrations are written as files and verified offline in PGlite (`npm run test:sql`, built in
  Tonda 03 / Round 04). This overrides the `overnight` skill's "skip any package with a migration"
  rule: that rule exists so nothing touches the live DB unattended, and nothing does here.
- No live DB reads or writes from builders (the auto-mode classifier blocks prod reads; respect it).

## Live state (verified 2026-10-17, count-only reads with the anon key)
Anon can read Round `customers` (6,462 rows incl. phone/email/birthdate), `customer_visits` (31),
`feedback` (3, incl. live voucher codes) and Tonda `reservations` (48). Round's 2026-09-14 audit
also recorded anon INSERT/UPDATE on `customers` and anon writes on several config tables.

## Packages and merge order

| Order | Repo | # | Package | Migration | Depends on (must be merged + deployed first) |
|---|---|---|---|---|---|
| 1 | Tonda | 03 | booking-guards (SQL fixes + PGlite harness) | yes | — |
| 2 | Tonda | 04 | edge-function-hardening | yes (sent_at columns) | — |
| 3 | Round | 04 | customer-rpcs (shared-table RPCs + PGlite harness) | yes (Round) | — |
| 4 | Round | 05 | round-switch-to-rpcs (Round app + send-voucher-email) | no | Round 04 |
| 5 | Tonda | 05 | server-availability (booking page uses `get_availability`) | no | Tonda 03 |
| 6 | Tonda | 06 | public-pages-rpcs (manage/feedback/prefill/find-or-create via RPCs) | yes | Round 04 |
| 7 | Tonda | 07 | admin-round-auth-and-visits (dual sign-in, `log_visit`, Bookings fixes) | no | Round 04 |
| 8 | Tonda | 08 | admin-reliability (Tables/SlotRules/Experiences/Settings/Dashboard) | no | — |
| 9 | Tonda | 09 | public-perf-and-polish | no | — |
| 10 | Tonda | 10 | tonda-lockdown (RLS on Tonda project) | yes | Tonda 05, 06, 07 deployed |
| 11 | Round | 06 | shared-tables-lockdown (RLS on customers/customer_visits/feedback) | yes | Round 05, Tonda 04, 06, 07 deployed, Round-side logins for Tonda staff exist |

Packages 10 and 11 are the ones that actually close the holes. Merging them early breaks both
public sites. Their briefs repeat this.

File ownership (so parallel branches don't conflict): `Reservations.jsx` → 05 (and 06 only for
`handlePhoneBlur` + the `findOrCreateCustomer` call, nothing else); `ManageBooking.jsx`,
`Feedback.jsx`, `ExperienceDetail.jsx`, `supabaseCustomers.js` → 06; `Bookings.jsx`,
`customerVisits.js`, `Login.jsx`, `RequireAuth.jsx` → 07; `Tables.jsx`, `SlotRules.jsx`,
`Experiences.jsx`, `Settings.jsx`, `admin/Feedback.jsx`, `Dashboard.jsx` → 08; `App.jsx`,
`index.html`, `index.css`, `Home.jsx`, `Navbar.jsx`, `Events.jsx`, `Offsite.jsx`, `vercel.json`,
`README.md`, `src/assets/*`, `CLAUDE.md` → 09. Edge functions → 04.

## Locked decisions

### Tonda 03 — booking-guards
- `create_reservation_atomic` derives day type from the date (`dow in (5,6)` → weekend). It keeps the
  `p_day_type` parameter for signature compatibility and ignores it. **(Claude)** Rejected: dropping
  the param (breaks the deployed front end before 05 lands).
- Reject `p_guest_count < 1`, a date before KL today, and a same-day time earlier than KL now + 30
  min (mirrors `LEAD_TIME_MINUTES` in `src/lib/slotCutoff.js`). Error prefixes follow the existing
  `code: message` style so the client's existing error display keeps working.
- `get_availability`: return no rows for `p_guest_count < 1`; hoist the per-slot blackout and
  reservation reads out of the loop if it stays readable; mark `STABLE`.
- `amend_reservation_atomic`: exclude the booking's own row when choosing tables (add an optional
  `p_exclude_reservation_id uuid default null` to `assign_tables`; create passes null). Recompute
  `table_type` the same way create does. Allow amending only `pending`/`confirmed`/`seated`. Reset
  `reminder_sent = false` when the date or time changes.
- Big-table/BT and the 9–10 pax approval rule: **unchanged**. That's a business rule, so it's
  out of scope and on Perng's morning list. **(Claude)**
- Trigger functions `notify_reservation_insert` / `notify_reservation_completed`: re-declare with
  `security definer`, `set search_path = public, vault, pg_temp` (matches live) and an
  `exception when others then raise warning` wrapper so a failed email can't abort a booking.
- Constraints and indexes: `check (guest_count > 0)` on reservations (added `not valid`, then validated);
  `unique (table_number)` on restaurant_tables only if no duplicates exist (DO block, else
  `raise notice`); index `reservations (reservation_date, status)`.
- Housekeeping cron: weekly purge of `cron.job_run_details` older than 14 days (idempotent
  schedule).
- Fix the `%s` typo in the `date_closed` message.
- PGlite harness: `supabase/tests/pglite/` (stub schema for the tables/extensions the functions touch:
  `vault`, `net`, `cron` stubs), runner script, `npm run test:sql`, devDependency
  `@electric-sql/pglite`. Every SQL package after this adds cases to it.

### Tonda 04 — edge-function-hardening
- `send-confirmation-email` and `send-thankyou-email` require `Authorization: Bearer
  <TONDA_SERVICE_ROLE_KEY>` like `notify-staff-reservation` does. They take only `record.id` from the
  payload and re-read the reservation with the service-role client.
- Shared `escapeHtml` for every interpolated value in all four functions (copy the
  notify-staff helper into `supabase/functions/_shared/escapeHtml.ts`).
- Confirmation email for `status = 'pending'` says "request received, we'll confirm shortly" rather than
  "confirmed".
- Send-once columns: `reservations.confirmation_sent_at`, `thankyou_sent_at` (migration). Claim
  atomically (`update … set x_sent_at = now() where id = … and x_sent_at is null returning id`)
  before sending; clear it again if Resend fails.
- Reminder: claim with `update … set reminder_sent = true where id = … and reminder_sent = false
  returning`; check `res.ok` and revert on failure; wording says "today" or "tomorrow" from the
  real KL dates; a customer with no email is marked sent so it isn't re-queried.
- Round customers are read with `ROUND_SERVICE_ROLE_KEY` when set, falling back to the anon key
  with a `console.warn` (fallback keeps working until Round 06). Perng must set the secret before
  Round 06. **(Claude)**

### Round 04 — customer-rpcs (Round project, additive only)
All `security definer`, `set search_path = public, pg_temp`.
- `find_or_create_customer(p_full_name text, p_phone text, p_email text, p_birthdate date) returns
  uuid`: anon+authenticated. Ports `findOrCreateCustomer` exactly (server-side normalise + validate
  with the same pattern, placeholder `601112288686` never matched, email fallback, fill-missing-
  fields only, 23505 race handled with `on conflict`/retry).
- `customer_prefill(p_phone text) returns table(first_name text, has_birthdate boolean)`:
  anon+authenticated. **Only the first name, never email or phone.** **(Claude)** Rejected:
  returning email (that is the leak); dropping prefill entirely (worse for returning guests).
- `customer_display_name(p_id uuid) returns text` (**first name only**, because `find_or_create_customer` hands out ids for any phone, so a full name here would be a phone→name oracle): anon+authenticated. Used by
  the manage-booking page. Customer ids stop being listable after Round 06.
- `feedback_state(p_reservation_id uuid, p_customer_id uuid, p_restaurant text) returns text`
  (`'submitted' | 'repeat' | 'new'`), and `submit_feedback(p_reservation_id, p_customer_id,
  p_restaurant, p_nps_score int, p_tags text[], p_comment text) returns table(voucher_code text,
  voucher_expires_at timestamptz)`: anon+authenticated. The voucher is generated server-side (same
  PIZZA_WORDS + 2 digits, 1-month expiry, retry on collision), null for repeat feedback; one row per
  reservation (existing unique). `restaurant in ('round','tonda')`.
- `log_visit(p_reservation_id uuid, p_customer_id uuid, p_restaurant text, p_status text, p_pax int,
  p_visited_at date, p_amount_spent numeric) returns void`: **authenticated only**. It locks the
  customer row and reverses the previous visit row's effect (completed: `visit_count-1`,
  `total_spent - old amount`; no_show: `no_show_count-1`, floor 0), then applies the new one
  (completed/no_show upsert the visit row; any other status deletes it). It recomputes
  `last_visited_at`/`last_visit_spent` from the customer's completed visit rows when that row was
  the latest, and otherwise leaves them alone (pre-2026 history has no visit rows). Counters are never
  recomputed from scratch, because 5,119 customers have counters with no visit rows. **(Claude)**
- Column `feedback.voucher_email_sent_at timestamptz`.

### Round 05 — round-switch-to-rpcs (Round repo)
- `src/lib/supabaseCustomers.js` stops creating a second anon client: it re-exports the main
  `supabase` client, so Round admin customer access runs authenticated. `findOrCreateCustomer` calls
  the RPC.
- Public pages use `customer_prefill`, `customer_display_name` (ManageBooking drops the
  `customers(...)` embed), `feedback_state` / `submit_feedback` (Feedback.jsx stops the raw REST
  insert and the client voucher).
- `customerVisits.js` calls `log_visit`, and Bookings calls it for every status change of a
  reservation that has a customer (so cancel/un-complete reverses counters).
- `send-voucher-email` takes `{reservation_id}` only, reads the code/customer from `feedback`,
  escapes HTML, sends once (`voucher_email_sent_at`), and requires the anon or service JWT (keep
  `verify_jwt`). The voucher code no longer comes from the client.
- Round's own reservations lockdown, `get_availability` switch and booking guards are **out of
  scope**. They're a follow-up port of Tonda 03–05/10 (Perng's morning list).

### Tonda 05 — server-availability
- `Reservations.jsx` gets slots from `supabase.rpc('get_availability', {p_date, p_guest_count})`
  for both the slot list and the pre-submit check. Delete `computeAvailability`,
  `getSmallTableCapacity`, `getBlackoutWindows` and the anon `reservations` / `restaurant_tables`
  reads. Keep `getDateInfo` only for closed/blocked messaging, run its three reads in
  `Promise.all`, and cache `operating_hours`/`slot_rules` for the page's lifetime.
- `p_day_type` sent to create is the `day_type` returned by `get_availability`.
- Experiences filter uses `getLocalToday()` (fixes the UTC bug at `Reservations.jsx:291`).
- Validate the phone before the availability check. Add a `useRef` double-submit guard. Hoist
  `CopyButton` out of the component (lint `static-components`).

### Tonda 06 — public-pages-rpcs
- Tonda migration: `get_booking(p_id uuid)` returns the columns ManageBooking renders (no `notes`
  beyond what it shows today), and `feedback_reservation(p_id uuid) returns table(customer_id
  uuid, status text)`. Both are anon+authenticated security definer.
- ManageBooking uses `get_booking` + Round `customer_display_name`, and `isPast` uses
  `getLocalToday()`. The manage link stays `/booking/<uuid>`: the uuid stays the credential and stops
  being listable after Tonda 10. **(Claude)** Rejected: a new token column (it would break every link
  already emailed).
- Feedback.jsx uses `feedback_reservation` + Round `feedback_state` / `submit_feedback`, and
  `send-voucher-email` gets `{reservation_id}` only. It keeps the BRANDS check, and the `restaurant`
  must be `'tonda'` for a Tonda reservation.
- `supabaseCustomers.js` `findOrCreateCustomer` calls Round `find_or_create_customer`, with the same
  exported signature so Events/Offsite/Reservations callers are untouched. `handlePhoneBlur`
  (Reservations) and the ExperienceDetail prefill use `customer_prefill` and fill the first name
  only. The birthday prompt uses `has_birthdate`.
- ExperienceDetail registration validates the phone with `isValidPhone` and rejects pax < 1.

### Tonda 07 — admin-round-auth-and-visits
- Tonda staff sign in to Round's project too: `Login.jsx` calls
  `supabaseCustomers.auth.signInWithPassword` with the same credentials after Tonda succeeds. If
  Round fails, Tonda login still succeeds and a persistent admin banner says "Customer data
  unavailable: no Round login for this account". Sign-out signs out of both. **(Claude)** Rejected:
  proxying every admin customer call through a Tonda edge function with Round's service key (much
  bigger, and adds a second secret).
- `customerVisits.js` calls Round `log_visit`, and Bookings calls it on every reservation status
  change (not only completed/no_show), surfacing failures as a toast.
- Admin cancel/no-show releases table locks and merged groups exactly like completed does, and
  checks every error.
- Bookings load window: reservations from 60 days ago onward, with a "Load older" button that
  pages back 60 days at a time. Customer lookup is chunked (≤ 100 ids per `.in()`).
  Partitions are memoised. **(Claude)**

### Tonda 08 — admin-reliability
- Tables: `saveTables` batched (one `upsert`), the delete-table check limited to
  `reservation_date >= today`, errors checked and toasted. SlotRules/Experiences/Settings: errors
  checked and toasted. Lint fetch-before-declare fixed in `admin/Feedback.jsx`, `Settings.jsx`,
  `Tables.jsx`.
- Dashboard shows a derived "N past bookings still open" count (status confirmed/pending/seated and
  date < KL today) linking to Bookings. It is derived at read time, never stored (repo rule). This is how
  the 6 stale bookings get closed out. **(Claude)**

### Tonda 09 — public-perf-and-polish
- `React.lazy` for every `/admin*` page plus `Suspense`. Google Fonts moves from the CSS `@import` to
  preconnect + `<link>` in `index.html`. Real `<title>` and meta description.
- Images become WebP (sharp, run once, dev-only): logo resized to 2× its largest rendered size. The
  hero is at most 1600 px wide and gets `width`/`height`, `fetchpriority="high"` on the hero and
  `decoding="async"`.
- `vercel.json`: `Cache-Control: public, max-age=31536000, immutable` on `/assets/(.*)`.
- Events/Offsite show the "valid phone" error message and set a `min` on the date input.
- README replaced with a real one (keep the public_holidays re-seed section). CLAUDE.md
  invariant greps gain `toISOString\(\)\.split` and the lint baseline is updated to the new count.

### Tonda 10 — tonda-lockdown (merge last)
Migration that drops **every** existing policy on each listed table (loop over `pg_policies`), then
creates exactly:
- `reservations`, `table_groups`, `customers` (Tonda's empty copy), `restaurant_tables`,
  `table_blocks`: authenticated all; anon none. (`restaurant_tables` exposes
  `locked_by_reservation` ids, which are cancel capabilities.)
- `operating_hours`, `slot_rules`, `blocked_dates`, `blackout_dates`, `experiences`,
  `public_holidays`: anon select; authenticated all.
- `settings`: anon select where `key like 'confirmation\_message\_%'`; authenticated all.
- `events`, `offsite_bookings`, `experience_registrations`: anon insert only; authenticated all.
- The builder must grep the post-05/06/07 code paths named in those briefs to confirm no public page
  needs more. Any public insert that does `.select()` after insert is listed in the PR as needing a
  change.
- Realtime is unaffected for admins (authenticated).
- Perng: turn off public sign-ups in Supabase Auth for both projects before merging. RLS treats
  any signed-in user as staff.

### Round 06 — shared-tables-lockdown (merge last)
- `customers`, `customer_visits`, `feedback`: drop all policies; authenticated all; anon none (anon
  goes through the Round 04 RPCs only).
- Round's own `reservations`/config tables: out of scope here (follow-up port).

## Data cleanup (Perng, not overnight)
- 6 past bookings still `confirmed`: close out in admin (Dashboard count from Tonda 08 lists them).
- 6 expired table locks: `docs/build/2026-10-17-cleanup.sql` (written overnight, run by Perng).
- 3 customers with Tonda-only counter drift: listed with ids in the same SQL file as `select`s to
  inspect, plus commented fix statements.
- 228 placeholder-phone customers: leave as is. **(Claude)**

## Morning list for Perng
1. Review the **(Claude)** decisions above.
2. Set `ROUND_SERVICE_ROLE_KEY` as a Tonda edge-function secret; create Round logins for Tonda staff
   (same email/password); turn off public sign-ups on both projects.
3. Take a schema snapshot of both projects (`supabase db dump --schema-only`) so the PGlite stubs
   can be replaced with the real schema.
4. Decide the 9–10 pax / big-table approval rule.
5. Merge and deploy in the order above. Tonda 10 and Round 06 go last.
6. After Tonda 07 merges: update the CLAUDE.md counters invariant (counters are now maintained by Round's
   `log_visit` RPC, called from `src/lib/customerVisits.js`). Do the same in Round's CLAUDE.md after Round 05.
7. Known gaps left open (found while writing the briefs):
   - A `pending` booking that staff later approve gets no confirmation email (the trigger fires on insert only).
   - Voucher codes come from 20 words × 100 numbers = 2,000 codes, so collisions grow as vouchers pile up.
   - `send-voucher-email` reads `ROUND_SUPABASE_*` secret names while Tonda's functions use
     `SUPABASE_URL`/`ROUND_SERVICE_ROLE_KEY`. Round 05 accepts either; check which secrets exist.
   - `find_or_create_customer` still fills a missing email on an existing customer from public input
     (same as today). Someone who knows a guest's phone can attach their own email to that guest once.
   - Anon can still read draft `experiences` after Tonda 10.
   - Round's own `reservations` and config tables keep their open anon policies until Tonda 03/05/06/10 are
     ported to Round.
8. Confirm the Round schema assumptions listed in `round-reservation/docs/build/04-customer-rpcs.md`
   (unique indexes on `customers.phone`/`email` and `feedback`) with the three read-only queries there.
