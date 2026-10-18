# 04 — Edge function hardening: authenticated, escaped, send-once emails

Tonda's four email edge functions have gaps. `send-confirmation-email` and `send-thankyou-email` accept
any caller and send mail to whatever `record` is in the request body (anyone who knows the function URL
can email a stranger from Tonda's address). Guest-supplied text is concatenated into HTML unescaped in
three of the four functions. Every booking gets a "Reservation Confirmed" email, even `pending` ones that
still need staff approval. Nothing stops an email being sent twice, and the reminder marks a booking as
reminded even when Resend rejects it and always says "today" although it runs 12 hours ahead. After this
package: confirmation and thank-you require the service-role bearer key and re-read the booking from the
database, every interpolated value is escaped through one shared helper, pending bookings get a "request
received" email, and confirmation/thank-you/reminder are each claimed atomically before sending and
released if Resend fails. **The build does not deploy any function and does not apply the migration.**

Branch: `build/04-edge-function-hardening`
Brainstormed: 2026-10-17. Decisions made by Claude under Perng's 2026-10-17 "work autonomously" instruction; see docs/build/2026-10-17-audit-plan.md
Source of truth for the plan: `docs/build/2026-10-17-audit-plan.md`, section "Tonda 04".

## Plan discrepancies

1. **Hidden dependency on package 03.** The plan table lists no dependency, but this package's migration
   must be verified with `npm run test:sql` (the PGlite harness is built in 03). Create the branch from
   the tip of `build/03-booking-guards` (or from `main` once 03 is merged). If
   `supabase/tests/pglite/run.mjs` is not on your branch, stop and report.
2. **`send-reminder-email` already checks the bearer key** (`index.ts` lines 57-59), and
   **`notify-staff-reservation` already escapes every interpolated value** (lines 48-60 of its
   `index.ts`; its subject line is plain text, not HTML). For those two only the shared-helper swap
   applies, plus the reminder claim/wording work and the Round client key.
3. **`supabase/config.toml` sets `verify_jwt = true` only for `send-reminder-email` and
   `notify-staff-reservation`.** `send-confirmation-email` and `send-thankyou-email` have no entry, so they
   take the Supabase CLI default. The new bearer check is the real gate; `config.toml` is left unchanged
   (not in the plan).
4. **The reminder already uses the right KL date for the query, but not for the wording.** It selects
   reservations on the KL date of now + 12 h (`index.ts` lines 254-273), which is *tomorrow* for evening
   runs; the email body (line 223) and subject (line 305) both hardcode "today".
5. **Unit-test location.** `vite.config.js` has `test: { environment: 'node', include: ['src/**/*.test.js'] }`.
   Vitest therefore only sees `src/**/*.test.js`. Tests for the shared `.ts` helpers go in
   `src/lib/*.test.js` and import the helpers by relative path
   (`../../supabase/functions/_shared/<file>.ts`; Vite transpiles TypeScript on import). No change to
   `vite.config.js`. There is no Deno test runner in the repo, so function-level behaviour (auth, claim,
   revert) cannot be run offline; it is covered by pure-helper tests plus code-reading checks (T6-T9).
6. **A pending booking promised "we'll confirm shortly" gets no follow-up email.** The confirmation trigger
   fires on insert only (`20260813131000`), so when staff later approve a pending booking nothing is sent.
   Not fixed here (see Out of scope), but worth knowing when you read the new wording.
7. **Thank-you idempotence changes shape.** Today it skips when `old_record.status = 'completed'`. The new
   function takes only `record.id`, so it uses `thankyou_sent_at` instead: un-completing and re-completing
   a booking no longer re-sends.

---

## Decisions

| Question | Chosen | Rejected | Why |
|---|---|---|---|
| Auth on confirmation / thank-you | Require `Authorization: Bearer <TONDA_SERVICE_ROLE_KEY>` like `notify-staff-reservation`. Take only `record.id` from the payload and re-read the reservation with the service-role client | Trusting the payload `record` | Plan: closes the open mail relay |
| HTML escaping | Shared `escapeHtml` for every interpolated value in all four functions (copy the notify-staff helper into `supabase/functions/_shared/escapeHtml.ts`) | Per-function copies | Plan |
| Pending confirmation wording | `status = 'pending'` says "request received, we'll confirm shortly" rather than "confirmed" | Same email for all | Plan |
| Send-once columns | `reservations.confirmation_sent_at`, `thankyou_sent_at` (migration). Claim atomically (`update … set x_sent_at = now() where id = … and x_sent_at is null returning id`) before sending; clear it again if Resend fails | Check-then-send | Plan |
| Reminder | Claim with `update … set reminder_sent = true where id = … and reminder_sent = false returning`; check `res.ok` and revert on failure; wording says "today" or "tomorrow" from the real KL dates; a customer with no email is marked sent so it isn't re-queried | Mark after sending regardless of result | Plan |
| Round customer reads **(Claude)** | Read with `ROUND_SERVICE_ROLE_KEY` when set, falling back to the anon key with a `console.warn` (the fallback keeps working until Round 06). Perng must set the secret before Round 06 | Requiring the secret now | A missing secret must not break emails before the Round lockdown; Perng's morning list item 2 |

## Files

| Path | Change |
|---|---|
| `supabase/functions/_shared/escapeHtml.ts` | new — `escapeHtml(s: unknown): string` (pure TS) |
| `supabase/functions/_shared/klTime.ts` | new — `klDateString(d: Date)`, `reminderDayWord(reservationDate, now)` (pure TS) |
| `supabase/functions/_shared/emails.ts` | new — `buildConfirmationEmail`, `buildThankyouEmail`, `buildReminderEmail` (pure TS, import only `./escapeHtml.ts`) |
| `supabase/functions/_shared/roundClient.ts` | new — `createRoundClient()` (Deno-only; imports `jsr:@supabase/supabase-js@2`; not unit tested) |
| `supabase/functions/send-confirmation-email/index.ts` | modify — auth, re-read, pending wording, claim/release, shared helpers |
| `supabase/functions/send-thankyou-email/index.ts` | modify — auth, re-read, claim/release, shared helpers |
| `supabase/functions/send-reminder-email/index.ts` | modify — claim/revert, `res.ok`, today/tomorrow wording, no-email handling, shared helpers |
| `supabase/functions/notify-staff-reservation/index.ts` | modify — import shared `escapeHtml` (delete local copy lines 28-32) and `createRoundClient` |
| `supabase/migrations/20261017100100_email_send_once.sql` | new — two nullable timestamptz columns (not applied by the build) |
| `supabase/tests/pglite/email_send_once.test.mjs` | new — columns exist, claim is single-winner, migration idempotent |
| `src/lib/edgeHelpers.test.js` | new — vitest for `escapeHtml`, `klDateString`, `reminderDayWord` |
| `src/lib/edgeEmails.test.js` | new — vitest for the three email builders |

Not touched: `supabase/config.toml`, `vite.config.js`, `package.json`, every other migration, all other `src/` files.

## Invariants touched

- **Dates compare as local `YYYY-MM-DD` strings** — the reminder wording compares the reservation's date
  string to the KL date strings from `klDateString` (`Intl.DateTimeFormat` with `timeZone: 'Asia/Kuala_Lumpur'`,
  same technique the reminder uses today at lines 258-264). No `toISOString().slice(0, 10)`, no
  `new Date('YYYY-MM-DD')` for comparisons (invariant greps must stay empty).
- **Customer counters on Round's `customers`** — read only (`full_name, email`); never written.
- **Availability / assignment server-side, weekend Fri/Sat, `closed_days` jsonb** — not near.
- **Admin theme tokens** — the email HTML keeps its existing colours (`#E8420A` etc.); no new colours.

## Tasks

Global: work only in the files named. Branch from the tip of `build/03-booking-guards` (see discrepancy 1).
Record the `npm run lint` problem count on the branch point before starting; it must not increase.
Stage by path. Commit messages end with the `Co-Authored-By` line Claude Code adds. **Do not deploy any
function, do not run `supabase db push`, do not connect to any live database or call Resend.** Edge
functions run on Deno: use `jsr:`/`npm:` specifiers only for Deno-only code (`roundClient.ts`, the four
`index.ts`). Everything in `_shared/escapeHtml.ts`, `klTime.ts` and `emails.ts` must be plain TypeScript
with **no `Deno.*`, no `jsr:` imports, no top-level environment reads**, and relative imports written with
the `.ts` extension, so Vitest can import them.

### T1 — Shared `escapeHtml` + test
**Do:** Create `supabase/functions/_shared/escapeHtml.ts` exporting `escapeHtml(s: unknown): string`, copied
exactly from `notify-staff-reservation/index.ts` lines 28-32 (`&`, `<`, `>`, `"`, `'` → entities; `null`/`undefined` → `""`).
Create `src/lib/edgeHelpers.test.js` importing `{ escapeHtml } from '../../supabase/functions/_shared/escapeHtml.ts'`
with cases: `<script>alert('x')</script>` escaped fully; `Tom & "Jerry"` → `Tom &amp; &quot;Jerry&quot;`; `null` → `''`; number `4` → `'4'`; already-escaped `&amp;` becomes `&amp;amp;`.
**Verify:** `npx vitest run src/lib/edgeHelpers.test.js` passes.

### T2 — KL date helpers + test
**Do:** Create `supabase/functions/_shared/klTime.ts` exporting:
- `klDateString(d: Date): string` — `YYYY-MM-DD` in `Asia/Kuala_Lumpur` via `Intl.DateTimeFormat('en-GB', { timeZone, year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(d)` (same parts technique as `send-reminder-email/index.ts` lines 258-264).
- `reminderDayWord(reservationDate: string, now: Date): string` — `'today'` when `reservationDate === klDateString(now)`; `'tomorrow'` when it equals `klDateString(new Date(now.getTime() + 24 * 60 * 60 * 1000))`; otherwise `'on ' + reservationDate`.
Add tests to `src/lib/edgeHelpers.test.js`: `klDateString(new Date('2026-10-17T17:30:00Z'))` is `'2026-10-18'` (01:30 KL next day) while `new Date('2026-10-17T15:59:00Z')` is `'2026-10-17'`; `reminderDayWord('2026-10-18', new Date('2026-10-18T01:00:00Z'))` is `'today'`; same date with `now` = `2026-10-17T05:00:00Z` is `'tomorrow'`; `'2026-10-25'` → `'on 2026-10-25'`; the case where UTC date and KL date differ (`now = 2026-10-17T17:00:00Z`, date `'2026-10-18'`) is `'today'`.
**Verify:** `npx vitest run src/lib/edgeHelpers.test.js` passes.

### T3 — Email builders + test
**Do:** Create `supabase/functions/_shared/emails.ts` importing only `{ escapeHtml } from './escapeHtml.ts'`. Move the three HTML templates out of the functions **verbatim** (same markup, colours, copy) and make every dynamic value pass through `escapeHtml`, including values inside `href` attributes. Each builder returns `{ subject: string; html: string }`:
- `buildConfirmationEmail(reservation, customer)` — from `send-confirmation-email/index.ts` lines 12-56. If `reservation.status === 'pending'`: heading "Reservation Request Received", intro "Hi {firstName}, thanks for your request. Our team will confirm your booking shortly.", subject "We've received your reservation request at Tonda Pizza Romana". Otherwise exactly today's "Reservation Confirmed" copy and subject "Your reservation at Tonda Pizza Romana is confirmed". Date/time/guests/extras/manage link stay in both.
- `buildThankyouEmail(customer, feedbackUrl)` — from `send-thankyou-email/index.ts` lines 14-43, subject "Thank you for dining with us at Tonda Pizza Romana".
- `buildReminderEmail(reservation, customer, dayWord)` — from `send-reminder-email/index.ts` lines 12-53; "reminder about your reservation today." becomes `"…reservation " + escapeHtml(dayWord) + "."`; subject `"Reminder: Your reservation at Tonda Pizza Romana is " + dayWord`.
Types: define small local interfaces (`Reservation`, `Customer`) rather than `any`.
Create `src/lib/edgeEmails.test.js` (import from `../../supabase/functions/_shared/emails.ts`): a customer named `<b>Eve</b> O'Neil` and `notes`-free reservation → html contains `&lt;b&gt;Eve&lt;/b&gt;` and not `<b>Eve`; first-name `there` fallback when `full_name` is null; confirmation `status:'confirmed'` html contains `Reservation Confirmed` and subject ends `is confirmed`; `status:'pending'` html contains `Reservation Request Received`, `confirm your booking shortly`, does **not** contain `Reservation Confirmed`; manage link `https://tonda-reservation.vercel.app/booking/<id>` present; `baby_chairs: 2, pets: true` shows `Baby chairs: 2` and `Pets: Yes`; thank-you html contains the feedback URL with `&` escaped as `&amp;`; reminder with `'tomorrow'` has `reservation tomorrow` in html and `is tomorrow` in subject, with `'today'` the same for today. Do not assert the locale-formatted date string (Deno and Node ICU may differ).
**Verify:** `npx vitest run src/lib/edgeEmails.test.js` passes; `grep -nE "Deno|jsr:|npm:" supabase/functions/_shared/escapeHtml.ts supabase/functions/_shared/klTime.ts supabase/functions/_shared/emails.ts` prints nothing.

### T4 — Round client helper
**Do:** Create `supabase/functions/_shared/roundClient.ts`:
```ts
import { createClient } from "jsr:@supabase/supabase-js@2";
export function createRoundClient() { /* ... */ }
```
It reads `ROUND_SUPABASE_URL`; uses `ROUND_SERVICE_ROLE_KEY` when set and non-empty; otherwise `console.warn("ROUND_SERVICE_ROLE_KEY not set; falling back to ROUND_SUPABASE_ANON_KEY")` and uses `ROUND_SUPABASE_ANON_KEY`. Returns the client. Reads env inside the function (not at module top level).
**Verify:** `grep -n "ROUND_SERVICE_ROLE_KEY\|console.warn\|ROUND_SUPABASE_ANON_KEY" supabase/functions/_shared/roundClient.ts` shows all three; `npm test` unaffected.

### T5 — Migration and PGlite test
**Do:** Create `supabase/migrations/20261017100100_email_send_once.sql`:
```sql
alter table public.reservations
  add column if not exists confirmation_sent_at timestamptz,
  add column if not exists thankyou_sent_at timestamptz;
```
with a header comment: "claimed by send-confirmation-email / send-thankyou-email before sending (update … where x_sent_at is null returning id) and cleared if Resend fails; null = not sent. Existing rows stay null (no backfill). Not applied by the build; apply this before deploying the functions."
Create `supabase/tests/pglite/email_send_once.test.mjs` (default export `async (ctx)`; harness from package 03): both columns exist with type `timestamp with time zone` and `is_nullable = 'YES'` (query `information_schema.columns`); insert a reservation; running `update public.reservations set confirmation_sent_at = now() where id = $1 and confirmation_sent_at is null returning id` returns one row the first time and zero rows the second; set it to null and the claim succeeds again; same for `thankyou_sent_at`; `await ctx.db.exec(ctx.readMigration('20261017100100_email_send_once.sql'))` a second time does not throw.
**Verify:** `npm run test:sql` — all PASS including `email_send_once`, exit 0.

### T6 — `send-confirmation-email`
**Do:** Rewrite `supabase/functions/send-confirmation-email/index.ts` (currently 99 lines) to:
1. Imports: `createClient` as today, `buildConfirmationEmail` from `../_shared/emails.ts`, `createRoundClient` from `../_shared/roundClient.ts`. Replace the module-level `roundSupabase` with `createRoundClient()`; delete the local `buildEmail`.
2. First thing in the handler (inside the `try`): `if (req.headers.get("Authorization") !== "Bearer " + SUPABASE_SERVICE_ROLE_KEY) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });` (identical to `notify-staff-reservation` lines 91-93).
3. Read only `payload.record?.id`; 400 `{ error: "No reservation id" }` if absent. Re-read with the service-role client: `.from("reservations").select("*").eq("id", id).maybeSingle()`; 404 if missing; if `status` is not `'pending'` or `'confirmed'` return 200 `{ skipped: "status <x>" }`.
4. Look up the customer by the re-read row's `customer_id` on the Round client (`full_name, email`); no customer or no email → 200 `{ error: "No email" }` **before** claiming.
5. Claim: `update reservations set confirmation_sent_at = now() where id = <id> and confirmation_sent_at is null` with `.select("id")`; zero rows → 200 `{ skipped: "already sent" }`.
6. Build with `buildConfirmationEmail(reservation, customer)`; send to Resend as today with the builder's `subject` and `html`. If `!res.ok`, or `fetch` throws: clear the claim (`update … set confirmation_sent_at = null where id = <id>`) and return 502 with the Resend body (or 500 for a throw). On success return 200 with Resend's JSON.
**Verify:** `grep -c "unauthorized" supabase/functions/send-confirmation-email/index.ts` ≥ 1; `grep -n "payload.record\b" supabase/functions/send-confirmation-email/index.ts` shows only the `?.id` read; `grep -c "confirmation_sent_at" ` ≥ 3 (claim, clear, comment/select); `grep -nE "reservation\.(guest_count|notes)" ` finds nothing outside `_shared/emails.ts`; `npm test` and `npm run build` pass. (No Deno runner exists; do not deploy.)

### T7 — `send-thankyou-email`
**Do:** Rewrite `supabase/functions/send-thankyou-email/index.ts` (94 lines) the same way: shared Round client and `buildThankyouEmail`; the same bearer check as the first thing in the handler; take only `record.id`; re-read the reservation; if re-read `status !== 'completed'` return 200 `{ skipped: "not completed" }`; no `customer_id` → 200 `{ error: "No customer_id" }`; customer lookup, no email → 200 `{ error: "No email" }` before claiming; claim `thankyou_sent_at` exactly like T6; `feedbackUrl = `${FEEDBACK_BASE_URL}?reservation=${reservation.id}&restaurant=tonda`` built from the **re-read** id; send; on failure clear `thankyou_sent_at` and return 502/500. Delete the `old_record` handling.
**Verify:** `grep -c "old_record" supabase/functions/send-thankyou-email/index.ts` is 0; `grep -c "unauthorized"` ≥ 1; `grep -c "thankyou_sent_at"` ≥ 3; `npm run build` passes.

### T8 — `send-reminder-email`
**Do:** Edit `supabase/functions/send-reminder-email/index.ts` (131 lines). Keep the existing bearer check (lines 57-59), the KL target-time computation (lines 254-266 of the original; keep the logic, you may replace the date formatting with `klDateString`) and the ±60-minute window (line 284). Replace the module-level `roundSupabase` with `createRoundClient()` and delete local `buildEmail`. Per reservation inside a `try/catch` that never stops the loop:
1. Claim first: `update reservations set reminder_sent = true where id = <id> and reminder_sent = false` with `.select("id")`; zero rows → `continue` (another run has it).
2. Customer lookup (Round client, `full_name, email`). No row or no email → leave `reminder_sent = true` (so it is not re-queried) and `continue`. A real query error (not "no rows") → revert the claim (`reminder_sent = false`) and `continue`.
3. `dayWord = reminderDayWord(reservation.reservation_date, new Date())`; `{ subject, html } = buildReminderEmail(reservation, customer, dayWord)`; send to Resend.
4. If `!res.ok` or `fetch` throws: revert `reminder_sent = false`, record `{ id, error }` in `results` and continue. Otherwise push `{ id, resend: data }`.
Response stays `{ sent: <count of successful sends>, results }`.
**Verify:** `grep -c "res.ok" supabase/functions/send-reminder-email/index.ts` ≥ 1; `grep -c "reminder_sent: false" ` ≥ 2 (revert paths) and `grep -c "reminder_sent: true"` = 1 (the claim); `grep -n "is today\|reservation today" supabase/functions/send-reminder-email/index.ts` prints nothing; `npm run build` passes.

### T9 — `notify-staff-reservation` swap
**Do:** In `supabase/functions/notify-staff-reservation/index.ts`: add `import { escapeHtml } from "../_shared/escapeHtml.ts";` and `createRoundClient` import; delete the local `escapeHtml` (lines 28-32); replace the module-level `roundSupabase` (line 10) with `createRoundClient()`. No other change (it already escapes every value and checks the bearer key).
**Verify:** `grep -c "function escapeHtml" supabase/functions/notify-staff-reservation/index.ts` is 0; `grep -c "_shared/escapeHtml.ts"` = 1; `grep -c "Bearer " supabase/functions/notify-staff-reservation/index.ts` ≥ 1 (auth kept).


## Verify (whole package)

- `npm run build` exit 0.
- `npm test` passes, including the new `src/lib/edgeHelpers.test.js` and `src/lib/edgeEmails.test.js`.
- `npm run test:sql` exit 0, including `email_send_once` (needs package 03's harness).
- `npm run lint`: no new problems against the count recorded at the branch point (CLAUDE.md: 14 = 10 errors / 4 warnings; package 02 measured 16 = 11 / 5). The new test files are `.js` and are linted; the `.ts`/`.mjs` files are not.
- Greps over `supabase/functions`: no `.replace(/&/g` outside `_shared/escapeHtml.ts`; no `toISOString().slice(0, 10)`; `grep -rn "Authorization" supabase/functions/*/index.ts` shows the bearer check in all four `index.ts`.
- `git diff --name-only` lists only the Files table.
- Not run by the build, owner-only after review, in this order: (1) `supabase db push` for `20261017100000` (03) then `20261017100100`; (2) `supabase secrets set ROUND_SERVICE_ROLE_KEY=…` on Tonda's project; (3) `supabase functions deploy send-confirmation-email send-thankyou-email send-reminder-email notify-staff-reservation`. Apply the migration before deploying: the new function code writes the new columns. The existing triggers already send the service-role bearer key from Vault, so they pass the new auth check unchanged.

## Out of scope

- Deploying functions, applying migrations, setting secrets (owner, see above).
- Sending a confirmation email when staff approve a `pending` booking (the insert-only trigger; Perng's call).
- Backfilling `confirmation_sent_at` / `thankyou_sent_at` for existing rows.
- `supabase/config.toml` `verify_jwt` entries for the two functions that lack them.
- Switching the voucher email (`send-voucher-email`) — it lives on Round (Round 05).
- Round's lockdown (Round 06), which is why the anon-key fallback in `roundClient.ts` stays for now.
- Retry queues or a dead-letter table for failed sends; a Deno test runner.
