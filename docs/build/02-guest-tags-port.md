# 02 — Guest tags port: visit stage, birthday, no-show pills and Guest block on Manage Bookings

Round shipped staff guest tags and at-a-glance guest pills on its Manage Bookings page (Round PR #5,
then Round package 03 which narrowed the birthday rule). The data lives in Round's `customers`
table, which Tonda already shares — so Tonda staff can already *have* tags, they just cannot see or
edit them. After this package Tonda's Manage Bookings (`src/pages/admin/Bookings.jsx`) shows the same
pills on every reservation, event and offsite row, and the same **Guest** block in the expanded row.
No database change: `customers.tags` already exists in Round's project (migrated 2026-09-24).

Branch: `build/02-guest-tags-port`
Brainstormed: 2026-09-24. Decisions locked by Perng.
Source of truth: Round repo (`C:\Users\User\Projects\round-reservation`) at `origin/main` —
spec `docs/superpowers/specs/2026-09-24-guest-tags-design.md`, briefs `docs/build/02-guest-tags.md`
and `docs/build/03-birthday-exact-day.md` (03 overrides the spec's birthday rule).

---

## Decisions

| Question | Chosen | Rejected | Why |
|---|---|---|---|
| Scope | Same pills + Guest block as Round, all three row types | Pills only; reservations only | Owner: "port to tonda" of the approved Round design |
| Birthday rule | Pill `🎂 Birthday` only on a booking dated the guest's birthday (month-day; 29 Feb → 28 Feb in non-leap years) | Round's original ±15 days | Owner, 2026-09-24: "for both round and tonda, only show birthday if its on the exact day" (booking's date) |
| Birthday pill colour | Tonda tokens as-is: `CREAM` (#FFFFFF) fill, `BRAND` (#E8420A) text | Tinted `orange-50`; new colour | Owner chose A — no new colours |
| Other colours | Same classes as Round; `BRAND`/`CREAM` come from Tonda's own `src/lib/adminTheme.js` | — | Theme tokens per repo |
| Customer write client | `supabaseCustomers` (Round project, anon key) | Tonda's `supabase` client | Tonda's own project has no `customers` table; anon UPDATE on `customers` is how Tonda already writes visit counters |
| Customer read | Widen Tonda's existing separate `supabaseCustomers` select + JS merge | FK embed like Round | Reservations and customers are in different projects |
| Visit count | Shared Round+Tonda `visit_count` (unchanged) | — | Same as Round |

## Files

| Path | Change |
|---|---|
| `src/lib/guestPills.js` | new — copy of Round's (post-03) |
| `src/lib/guestPills.test.js` | new — copy of Round's (post-03), hex literals replaced by `BRAND` |
| `src/components/admin/GuestPills.jsx` | new — copy of Round's, unchanged |
| `src/components/admin/GuestBlock.jsx` | new — copy of Round's with the write client swapped to `supabaseCustomers` |
| `src/pages/admin/Bookings.jsx` | modify — widen customers select; pass props; render pills + Guest block in 3 row types |
| `docs/build/README.md` | modify — row 02 |

## Invariants touched

- Local date strings — copied logic splits `YYYY-MM-DD`; `today` from `getLocalToday()`.
- Customer counters on Round's `customers` — read only; `src/lib/customerVisits.js` untouched.
- Admin theme tokens — only Tonda's `BRAND` / `CREAM` / `SUCCESS` and colour families already used.
- Round's `customers` is written with the anon key (tags/notes/birthdate). **Follow-up for the deferred
  anon-RLS hardening:** Tonda admin must keep UPDATE on those three columns.

## Tasks

Global: work only in the files named; `npm test` must pass; `npm run lint` ≤ **16 problems
(11 errors / 5 warnings)** — Tonda's measured baseline on 2026-09-24 (CLAUDE.md still says 14); `npm run build` must succeed. Stage by path. Commit
message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Match surrounding style.
Copy Round files from `C:\Users\User\Projects\round-reservation` (`origin/main`), never from memory.

### T1 — Copy the pure module and tests
**Do:** Copy Round's `src/lib/guestPills.js` and `src/lib/guestPills.test.js` to the same paths.
In the test file replace every hardcoded Round hex (`#8B1A1A`, `#F0EBE1`) with the imported
`BRAND` / `CREAM` (import from `./adminTheme`), e.g. `` { border: `1px solid ${BRAND}`, color: BRAND } ``.
No logic changes.
**Verify:** `npm test` passes (new file included); `grep -n "8B1A1A\|F0EBE1" src/lib/guestPills.test.js` empty.

### T2 — Copy `GuestPills.jsx`
**Do:** Copy Round's `src/components/admin/GuestPills.jsx` verbatim.
**Verify:** `npm run build`; `npm run lint` ≤ 16.

### T3 — Port `GuestBlock.jsx` with the Round-project client
**Do:** Copy Round's `src/components/admin/GuestBlock.jsx`. Replace
`import { supabase } from '../../supabase'` with
`import { supabaseCustomers } from '../../supabaseCustomers'` and every `supabase.from('customers')`
with `supabaseCustomers.from('customers')`. Nothing else changes (heading text "Round & Tonda" is
correct as is).
**Verify:** `npm run build`; `npm run lint` ≤ 16; `grep -c "supabaseCustomers.from('customers')" src/components/admin/GuestBlock.jsx` equals the number of `.update(` calls in the file; `grep -n "from '../../supabase'" src/components/admin/GuestBlock.jsx` empty.

### T4 — Wire into `Bookings.jsx`
**Do:** Mirror Round PR #5's `src/pages/admin/Bookings.jsx` changes (`git -C C:/Users/User/Projects/round-reservation show 1c47601 -- src/pages/admin/Bookings.jsx`), adapted:
- Import `GuestPills` and `GuestBlock` from `../../components/admin/…`.
- `fetchAll` line ~275: `.select('id, full_name, phone, email')` →
  `.select('id, full_name, phone, email, visit_count, no_show_count, birthdate, notes, tags')`.
  The Tonda-side `reservations` / `events` / `offsite_bookings` selects stay `'*'`; the existing
  JS merge (lines ~285-287) is unchanged.
- `ReservationRow`, `EventRow`, `OffsiteRow` gain props `today, showToast, onGuestSaved`; render
  `<GuestPills customer={x.customers} booking={{ status: x.status, date: <reservation_date | event_date> }} today={today} />`
  directly under the phone line, and
  `<GuestBlock customer={x.customers} onSaved={onGuestSaved} showToast={showToast} />` immediately
  before `<ActionButtons …>` in each expanded block.
- `renderTab()` passes `today={today} showToast={showToast} onGuestSaved={() => fetchAll({ silent: true })}`
  to every row in every tab. `today` is the existing `getLocalToday()` value.
**Verify:** `npm run build`; `npm run lint` ≤ 16; `grep -c "<GuestPills" src/pages/admin/Bookings.jsx` = 3;
`grep -c "<GuestBlock" src/pages/admin/Bookings.jsx` = 3;
`grep -c "visit_count, no_show_count, birthdate, notes, tags" src/pages/admin/Bookings.jsx` = 1.

### T5 — Index row
**Do:** `docs/build/README.md`: set row 02's status to `built — awaiting smoke`.
**Verify:** `grep "02 |" docs/build/README.md`.

## Verify (whole package)

- `npm test`, `npm run build`, `npm run lint` ≤ 16.
- No migration. Owner smoke on Tonda's dev server against real data: pills appear; tagging a guest in
  Tonda shows the same tag on that guest's Round bookings (shared record); a booking dated a guest's
  birthday shows `🎂 Birthday`; notes survive a collapse.

## Out of scope

- Customers-page tag filter/editor; floor-plan pills.
- Anon RLS hardening (deferred; see Invariants follow-up).
- Any change to Round.
