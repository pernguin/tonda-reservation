# Ops tweaks — Tonda port (design)

Date: 2026-09-18. Ports Round package 01 to Tonda. The **contracts, class strings, JSX and
code blocks are the ones in Round's spec**
`C:\Users\User\Projects\round-reservation\docs\superpowers\specs\2026-09-18-ops-tweaks-design.md`
(sections §1–§6) plus Round's shipped files at `origin/main` (`cbe2367`). This document lists only
the Tonda deltas. Where this doc is silent, Round's spec and shipped file are binding.

Round shipped files to copy from (`git -C C:\Users\User\Projects\round-reservation show origin/main:<path>`):
`src/lib/slotRuleDays.js`, `src/lib/slotRuleDays.test.js`, `src/components/admin/AmountPrompt.jsx`,
`src/lib/customerVisits.js`, `src/lib/customerVisits.test.js`, `src/lib/voucher.js`,
`src/lib/voucher.test.js`, `src/lib/useChime.js`, and the diffs of `Dashboard.jsx`, `SlotRules.jsx`,
`dayType.js`, `Reservations.jsx`, `Bookings.jsx`, `Customers.jsx`, `Feedback.jsx`.

## 0. Decisions (locked by Perng, 2026-09-18)

Same six decisions as Round §0. Tonda-specific rulings:
- Tonda's own theme tokens (`BRAND = '#E8420A'`) — `AmountPrompt` reads `BRAND` from Tonda's
  `src/lib/adminTheme.js`; no colour is hard-coded.
- Tonda's weekend is **Friday/Saturday** (`dow in (5, 6)`); untouched everywhere.
- Tonda's `operating_hours.closed_days` is **jsonb**; the RPC keeps the `?` operator. Client reads it
  as a plain array, so SlotRules/Reservations changes are identical to Round.
- Item 4 needs **no Tonda migration** — Tonda writes to Round's `customers`/`customer_visits`
  through `src/supabaseCustomers.js`, where the three spend columns already exist (pushed
  2026-09-18). `restaurant: 'tonda'` stays.
- Include Round PR #4's fix (`isLatestVisit`, `>=` on same-day visits) — take Round's `customerVisits.js`
  at `cbe2367`.

## 1. Dashboard
`src/pages/admin/Dashboard.jsx`: line 16 query gains `.eq('reservation_date', getLocalToday())`
(import from `../../lib/tableAvailability`, which exists); line 32 label → `'Reservations Today'`.

## 2. Closed days
New `src/lib/slotRuleDays.js` + test: copies of Round's with Tonda's day lists: weekday Sun–Thu,
weekend Fri–Sat (Tonda's weekend is Friday/Saturday). `src/pages/admin/SlotRules.jsx`:
line 9 `DAYS_OF_WEEK` removed → import; gate at line 196 `c.day_type === 'weekday'` →
`DAYS_BY_TYPE[c.day_type]`; the `DAYS_OF_WEEK.map` below it → `DAYS_BY_TYPE[c.day_type].map`;
`saveAll()` loop (line 85) skips `HIDDEN_DAY_TYPES`; render `config.map` (line 191) → filtered.
Tonda's `DEFAULT_CONFIG` (Fri/Sat weekend, "All Day" sessions) untouched.

## 3. Public holiday
- `src/lib/dayType.js`: add `export const PUBLIC_HOLIDAYS_ENABLED = false` + the same comment; wrap
  the `try { fetch … }` in `if (PUBLIC_HOLIDAYS_ENABLED)`. Keep the Fri/Sat line and its comment.
- `src/pages/Reservations.jsx`: replace lines 22–30 (`let day_type = …` through the `catch` block,
  including the `// day 5 = Friday…` comment line) with `const day_type = await getDayType(date)`;
  add `import { getDayType } from '../lib/dayType'`.
- New migration `supabase/migrations/20260918100000_get_availability_no_ph.sql`: copy of
  `20260917200600_get_availability_fix.sql` with (a) a prepended line
  `-- Drops the public_holidays override from get_availability (spec 2026-09-18-ops-tweaks-port §3).`,
  (b) header lines 11–15 ("-- day_type: Fri/Sat … this table mirrors).") replaced by
  ```
  -- day_type: Fri/Sat = 'weekend' (dow 5 = Friday, 6 = Saturday), else 'weekday'. The
  -- public_holidays override was removed 2026-09-18 (PH behaves as a normal day; the table
  -- stays). To restore, re-add after the v_day_type assignment:
  --   if exists (select 1 from public_holidays where holiday_date = p_date) then
  --     v_day_type := 'public_holiday';
  --   end if;
  ```
  (c) lines 74–76 (`if exists (select 1 from public_holidays …` … `end if;`) deleted. Everything
  else — including `in (5, 6)` and the `?` operator — byte-identical.
- `supabase/tests/get_availability_test.sql`: add a PH assertion block (insert
  `public_holidays (holiday_date, name)` for `2030-01-07`, call `get_availability('2030-01-07', 2)`,
  assert ≥1 row, `insert into results values ('PH date returns weekday slots: passed')`) **after the
  T2 block and before the `-- T3:` comment at line 78** (T3's `blocked_dates` fixture closes the date).
- `README.md` lines 20–22: replace the sentence
  "`public.public_holidays` overrides a date's `day_type` to `'public_holiday'` inside `get_availability` (and should eventually replace the client's own fetch in `src/pages/Reservations.jsx`)."
  with
  "`public.public_holidays` is currently **not consulted** — the `get_availability` override and the client fetch were disabled on 2026-09-18 so public holidays behave as normal days (see `docs/superpowers/specs/2026-09-18-ops-tweaks-port-design.md` §3 to restore)."

## 4. Spend on completion + CRM
- `src/lib/customerVisits.js`: replace with Round's `cbe2367` version, then re-apply Tonda's two
  local differences: import path `'../supabaseCustomers'` and the guard `if (!reservation?.customer_id) return`.
  Tonda's per-call `console.error; return` style is superseded by Round's try/catch version (the
  file is replaced wholesale; that is the intended outcome). Copy `customerVisits.test.js` verbatim (8 tests).
- `src/components/admin/AmountPrompt.jsx`: byte-identical copy of Round's (imports `BRAND` from
  `../../lib/adminTheme`, `FILTER_INPUT_CLASS` from `./FilterBar` — both exist with the same shape).
- `src/pages/admin/Bookings.jsx`: import `AmountPrompt`; `pendingComplete` state; `updateStatus`
  (line 269) gains the 4th param and the Round §4c first-line guard; the call at line 283 becomes
  `logVisitFromReservation(reservation, status, 'tonda', amountSpent)`; render the Round §4c
  `<AmountPrompt …/>` after `{toastNode}` (line 435) inside `</AdminPage>`.
- `src/pages/admin/Customers.jsx`: `formatRM` after `formatDate` (line 34); the two `hidden lg:block
  … w-24 text-right` header cells after the **Visits** header (line 289) and the two data cells after
  the `visit_count` cell (line 316), class strings from Round §4e.

## 5. Voucher
New `src/lib/voucher.js` + `voucher.test.js` (copies). `src/pages/Feedback.jsx`: add
`import { voucherExpiry } from '../lib/voucher'`; lines 150–152 (`const expires = …` through
`voucherExpiresAt = expires.toISOString()`) → `voucherExpiresAt = voucherExpiry()`. Round's
`send-voucher-email` (invoked cross-project at line 182) only formats the passed date — unchanged.

## 6. Chime
`src/lib/useChime.js`: replace with Round's shipped file (byte-identical; no Tonda-specific content).

## 7. Verify
`npm test` (baseline 48 → 48 + 4 + 8 + 2 = 62), `npm run build`, `npm run lint` ≤ **14 problems
(10 errors / 4 warnings)** = Tonda baseline. Migration + SQL test owner-run against Tonda's project
from the main checkout. Owner smoke after deploy: same six checks as Round.

## 8. Out of scope
Tonda's UTC `today` in `Reservations.jsx`; its cross-project `fetchAll` customer merge in
Bookings; backfilling the two Tonda visits logged today without amounts; anon RLS.
