# 11 — Staff-approved bookings get the "Reservation Confirmed" email (Round + Tonda)

A `pending` booking (one that needs staff approval) gets no email when staff approve it. After this
package, the moment a booking's status goes `pending` → `confirmed`, the guest gets the "Reservation
Confirmed" email, at most once per booking. On Round, the confirmation function first gets Tonda's
package 04 treatment (pending bookings get "Request Received" instead of "Confirmed"), otherwise a
pending guest would get "Confirmed" twice. **The build does not apply migrations or deploy functions;
Perng does both.**

Shared spec, built with `perng-harness:parallel-port`. Round first, then Tonda.
Brainstormed: 2026-10-22. Decisions approved by Perng 2026-10-22 (Round scope: confirmation function
only; divergences table below approved).
Branch in both repos: `build/11-approval-confirmed-email`.

## Per-site divergences (approved 2026-10-22)

| | Round | Tonda |
|---|---|---|
| Project ref / function URL host | `gvncofccucoejwawjvdv` | `qeepslmexektwqhxzwqs` |
| Vault secret / function env key | `round_service_role_key` / `ROUND_SERVICE_ROLE_KEY` | `tonda_service_role_key` / `TONDA_SERVICE_ROLE_KEY` |
| Customer lookup | Round's own `customers` table (service-role client) | Round's project via `createRoundClient()` |
| Confirmation function today | Not hardened: no bearer check, trusts payload `record`, no escaping, no send-once, always "Confirmed" | Hardened (package 04): bearer check, re-reads booking, escapes, pending → "Request Received", claims `confirmation_sent_at` |
| Template | Inline `buildEmail` in `index.ts`; colours `#8B1A1A` / `#F0EBE1`; sender `Round Pizza Napoletana <reservations.round@roundpizzanapoletana.com>`; manage URL `https://round-reservation.vercel.app/booking/` | `_shared/emails.ts` `buildConfirmationEmail`; sender `reservations.tonda@` |
| New columns | `confirmation_sent_at` **and** `approval_sent_at` | `approval_sent_at` only |
| Weekdays / Grab / holidays / menus | Not relevant (fires on a status change only) | Not relevant |

Anything that differs between the two implementations and is not in this table is a parity bug.

## Identical on both sites

### Migration `supabase/migrations/20261022100000_approval_confirmed_email.sql`

Idempotent (safe to run twice):

1. `alter table public.reservations add column if not exists approval_sent_at timestamptz;`
   (Round also adds `confirmation_sent_at timestamptz` the same way.) Null = not sent; no backfill.
2. `create or replace function public.notify_reservation_approved()` — `returns trigger`,
   `language plpgsql`, `security definer`, `set search_path to 'public', 'vault', 'pg_temp'`. Same shape
   as the site's existing `notify_reservation_insert()` (read the vault key; if null `raise warning` and
   return NEW; `net.http_post` to the site's `/functions/v1/send-confirmation-email` with headers
   `Content-Type` + `Authorization: Bearer <key>` and body
   `jsonb_build_object('record', row_to_json(NEW), 'event', 'approved')`; whole thing wrapped in
   `exception when others then raise warning ...` so a failed call can never block the status change).
3. `drop trigger if exists on_reservation_approved on public.reservations;`
   `create trigger on_reservation_approved after update of status on public.reservations for each row
   when (OLD.status = 'pending' and NEW.status = 'confirmed') execute function public.notify_reservation_approved();`

Leave `notify_reservation_insert`, `notify_reservation_completed` and the live insert/completed
triggers untouched.

### `send-confirmation-email` behaviour

- `const approval = payload.event === "approved"`.
- Bearer check, re-read the booking by `payload.record.id`, skip statuses other than pending/confirmed
  (as Tonda does today).
- Approval path: if the re-read status is not `confirmed`, return 200 `{ skipped: ... }` and send nothing.
- Claim column: `approval_sent_at` on the approval path, `confirmation_sent_at` otherwise. Claim with
  `update ... set <col> = now() where id = ... and <col> is null returning id`; no row → 200
  `{ skipped: "already sent" }`. Release (set back to null) the same column if Resend fails, exactly as
  Tonda does today.
- Template: chosen from the re-read status (approval path is therefore always "Confirmed"). No new
  template.

Known edge, accepted: if staff approve within seconds of the booking, before the insert call re-reads
it, the insert call also sees `confirmed` and both emails say "Confirmed". Do not add machinery for it.

### Tests

- PGlite (`npm run test:sql`), new file `supabase/tests/pglite/approval_email.test.mjs`, using the
  `net.http_calls` / `vault.decrypted_secrets` stubs the way `triggers.test.mjs` does:
  1. `notify_reservation_approved` is security definer with `search_path=public, vault, pg_temp`.
  2. pending → confirmed makes exactly one call to `/send-confirmation-email` with `event = 'approved'`
     in the body and `Authorization: Bearer <key>`.
  3. No call for: confirmed → confirmed (non-status update), pending → cancelled, confirmed → pending,
     a booking inserted as `confirmed`.
  4. Vault key missing → status update succeeds, no call. `net.http_post` raising → status update
     still succeeds.
  5. Columns exist and are nullable.
- Vitest: template choice and claim-column choice live in small pure helpers under
  `supabase/functions/_shared/` and are tested from `src/lib/*.test.js` (Tonda pattern, see Tonda
  `docs/build/04-edge-function-hardening.md` discrepancy 5). Cover: approval + confirmed → confirmed
  template + `approval_sent_at`; approval + pending → skip; insert + pending → "Request Received" +
  `confirmation_sent_at`; insert + confirmed → "Confirmed" + `confirmation_sent_at`.

## Round only

Port the confirmation half of Tonda 04 into Round's `send-confirmation-email`:

- `supabase/functions/_shared/escapeHtml.ts`: same content as Tonda's.
- `supabase/functions/_shared/emails.ts`: `buildConfirmationEmail(reservation, customer)` holding
  Round's existing HTML **verbatim** (colours, address, footer, "Manage My Booking" button), every
  interpolated value through `escapeHtml`, plus the pending variant: heading "Reservation Request
  Received", intro "Hi <first>, thanks for your request. Our team will confirm your booking shortly.",
  subject "We've received your reservation request at Round Pizza Napoletana". Confirmed subject stays
  "Your reservation at Round Pizza Napoletana is confirmed".
- `index.ts`: restructure to match Tonda's `send-confirmation-email/index.ts` (bearer check against
  `ROUND_SERVICE_ROLE_KEY`, re-read, status filter, build-before-claim, claim/release), with Round's own
  `customers` lookup and sender.
- Thank-you, reminder, notify-staff and voucher functions: unchanged.

## Tonda only

`approval_sent_at` column + the approval path in the existing function. Nothing else changes.

## Gates (each repo)

`npm test`, `npm run build`, `npm run test:sql` all green; `npm run lint` no new problems against the
CLAUDE.md baseline; the CLAUDE.md invariant greps find nothing new.

## Rollout (Perng)

Per repo, Round first: merge → `git pull` → `npx supabase db push --dry-run` → `npx supabase db push`
→ `npx supabase functions deploy send-confirmation-email`. Migration before function (the function
writes the new columns). Round check after deploy: make one test booking and confirm the email
arrives; the new bearer check returns 401 if the vault `round_service_role_key` differs from the
function's `ROUND_SERVICE_ROLE_KEY` secret.
