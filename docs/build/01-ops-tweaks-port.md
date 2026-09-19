# 01 — Ops tweaks port (from Round package 01)

Round shipped six admin/ops changes on 2026-09-18 (Round PR #3 + #4). Tonda still has the old
behaviour: all-time Dashboard count, no weekend closed-days picker, a Public Holiday card whose
config is never used, Completed with no spend capture (so Tonda visits show `—` in the shared
CRM), 3-month vouchers, and the quiet two-tone chime. After this package Tonda matches Round on
all six, using Tonda's own theme, Fri/Sat weekend and jsonb `closed_days`.

Spec (binding, Tonda deltas): `docs/superpowers/specs/2026-09-18-ops-tweaks-port-design.md`.
Round's spec and shipped files (binding for everything the Tonda spec is silent on):
`C:\Users\User\Projects\round-reservation` at `origin/main` (`cbe2367`) —
`docs/superpowers/specs/2026-09-18-ops-tweaks-design.md`. Read a Round file with
`git -C C:\Users\User\Projects\round-reservation show origin/main:<path>` **from the main checkout
only if the worktree Bash tool refuses `git -C`; otherwise read it directly from that path on disk
(the Round checkout is at `cbe2367`).**

Branch: `build/01-ops-tweaks-port`
Brainstormed: 2026-09-18. Decisions locked by Perng.

---

## Decisions

| Question | Chosen | Rejected | Why |
|---|---|---|---|
| Scope | all six items | spend prompt only | Perng: "port everything to tonda" |
| Theme | Tonda `BRAND` `#E8420A` via `adminTheme.js` | Round maroon | existing token rule |
| Weekend | Fri/Sat kept everywhere | — | Tonda's operating model |
| `closed_days` | jsonb + `?` operator kept in SQL | — | Tonda column type |
| Item 4 migration | none | copy Round's | tables live in Round's project; columns exist |
| `customerVisits.js` | Round `cbe2367` version incl. `isLatestVisit` fix | port pre-fix version | same-day bug already found on Round |

## Files

| Path | Change |
|---|---|
| `src/lib/slotRuleDays.js` | new (copy) |
| `src/lib/slotRuleDays.test.js` | new (copy) |
| `src/pages/admin/SlotRules.jsx` | modify — per-type picker, hide PH, skip in saveAll |
| `src/lib/dayType.js` | modify — `PUBLIC_HOLIDAYS_ENABLED` gate |
| `src/pages/Reservations.jsx` | modify — use `getDayType` |
| `supabase/migrations/20260918100000_get_availability_no_ph.sql` | new |
| `supabase/tests/get_availability_test.sql` | modify — PH assertion |
| `README.md` | modify — PH note |
| `src/pages/admin/Dashboard.jsx` | modify — today filter + label |
| `src/lib/customerVisits.js` | replace with Round version + Tonda import/guard |
| `src/lib/customerVisits.test.js` | new (copy, 8 tests) |
| `src/components/admin/AmountPrompt.jsx` | new (copy) |
| `src/pages/admin/Bookings.jsx` | modify — prompt wiring |
| `src/pages/admin/Customers.jsx` | modify — two columns + `formatRM` |
| `src/lib/voucher.js` | new (copy) |
| `src/lib/voucher.test.js` | new (copy) |
| `src/pages/Feedback.jsx` | modify — `voucherExpiry()` |
| `src/lib/useChime.js` | replace with Round version |
| `docs/build/README.md` | status row |

## Invariants touched

Fri/Sat weekend — preserved in `dayType.js`, `Reservations.jsx` (only the PH block is replaced), and the
migration copy. jsonb `?` — preserved in the migration copy. `day_type` weekday/weekend only —
established by T2–T4. Counters consistent with visits — T6 brings Round's guard + upsert error check.
Theme tokens — T7 copies a file that only references `BRAND`.

## Tasks

Global: only the files named per task; `npm test` green; `npm run lint` ≤ **14 problems (10 errors /
4 warnings)**; `npm run build` ok. Stage by path; one commit per task `01.TN: …`; message ends with
`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Inside the worktree: single plain Bash
commands only (no `&&`, `$(...)`, `for`, `cd`, `git -C`). Round's files are read from
`C:\Users\User\Projects\round-reservation\<path>` on disk.

### T1 — Slot-rule day constants (copy)
**Do:** Copy Round's `src/lib/slotRuleDays.js` and `src/lib/slotRuleDays.test.js` with Tonda's day
lists: weekday Sun–Thu, weekend Fri–Sat (Tonda's weekend is Friday/Saturday).
**Verify:** `npm test` — 52 pass (48 + 4).

### T2 — SlotRules page
**Do:** Tonda spec §2. Delete line 9, add the import, change the gate (line 196) and the `.map`
below it, add `if (HIDDEN_DAY_TYPES.includes(c.day_type)) continue` as the first line of the
`saveAll` loop (line 85), filter the render map (line 191). Nothing else.
**Verify:** `npm run build`; `npm run lint` ≤ 14; `grep -n "DAYS_OF_WEEK\|public_holiday" src/pages/admin/SlotRules.jsx` shows only the `DEFAULT_CONFIG` entry.

### T3 — Client PH gate
**Do:** Tonda spec §3 first two bullets (`dayType.js` flag + comment; `Reservations.jsx` lines
22–30 → `const day_type = await getDayType(date)` + import). Keep the Fri/Sat lines untouched.
**Verify:** `npm run build`; `grep -n "nager.at" src/pages/Reservations.jsx` empty; `grep -n "day === 5" src/pages/Reservations.jsx` empty (that line was inside the replaced block — the `day` variable and `dayName` above it stay); `grep -n "dow === 5" src/lib/dayType.js` = 1.

### T4 — RPC migration, SQL test, README
**Do:** Tonda spec §3 last three bullets. Migration = copy of `20260917200600_get_availability_fix.sql`
with the three specified deltas only; PH assertion block between T2 and the `-- T3:` comment
(line 78); README sentence swap.
**Verify:** `diff --strip-trailing-cr supabase/migrations/20260917200600_get_availability_fix.sql supabase/migrations/20260918100000_get_availability_no_ph.sql` shows only the header/comment change and three deleted lines (the `in (5, 6)` line and `?` line must be unchanged); test file still ends with the summary select + `rollback;`.

### T5 — Dashboard
**Do:** Tonda spec §1.
**Verify:** `npm run build`; `npm run lint` ≤ 14.

### T6 — customerVisits (replace) + test
**Do:** Tonda spec §4 first bullet: copy Round's `src/lib/customerVisits.js` (`cbe2367`), then change
the import to `'../supabaseCustomers'` and the guard to `if (!reservation?.customer_id) return`.
Copy `customerVisits.test.js` verbatim.
**Verify:** `npm test` — 60 pass; `npm run build`; `diff` against Round's file shows exactly those two lines.

### T7 — AmountPrompt (copy) + Bookings wiring
**Do:** Copy Round's `src/components/admin/AmountPrompt.jsx` byte-for-byte. Then Tonda spec §4
third bullet in `src/pages/admin/Bookings.jsx` (import, `pendingComplete`, 4th param + guard as
first line of `updateStatus` at line 269, 4th arg at line 283, `<AmountPrompt …/>` after
`{toastNode}` line 435).
**Verify:** `npm run build`; `npm run lint` ≤ 14; `grep -c "AmountPrompt" src/pages/admin/Bookings.jsx` = 2; `diff` of AmountPrompt.jsx vs Round's is empty.

### T8 — Customers columns
**Do:** Tonda spec §4 last bullet (`formatRM` after line 34; header cells after line 289; data cells after line 316), class strings from Round spec §4e.
**Verify:** `npm run build`; `grep -c "lg:block" src/pages/admin/Customers.jsx` = 4.

### T9 — Voucher
**Do:** Copy Round's `src/lib/voucher.js` + `voucher.test.js`; Tonda spec §5 edit in `Feedback.jsx` (lines 150–152).
**Verify:** `npm test` — 62 pass; `grep -n "setMonth" src/pages/Feedback.jsx` empty.

### T10 — Chime
**Do:** Replace `src/lib/useChime.js` with Round's file byte-for-byte.
**Verify:** `npm run build`; `npm run lint` ≤ 14; `diff` vs Round's file empty.

## Verify (whole package)

- `npm test` 62/62; `npm run build`; `npm run lint` ≤ 14 (10/4).
- `git diff --stat origin/main...HEAD` ⊆ Files.
- Owner after merge (Tonda main checkout): `npx supabase db push` (one migration), then
  `npx supabase db query --linked -f supabase/tests/get_availability_test.sql` (4 labels passed),
  deploy, then the six smoke checks on Tonda's admin.

## Out of scope

Tonda's UTC `today` in `Reservations.jsx`; Bookings' cross-project customer merge; backfilling the
two Tonda visits logged 2026-09-18 without amounts; anon RLS; anything not in Round package 01.
