# tonda-reservation

React 19 + Vite + Tailwind v4 front end for Tonda's reservations, with its own Supabase project
(ref `qeepslmexektwqhxzwqs`). Sibling of `round-reservation` — **not a mirror**. Tonda's `customers`,
`customer_visits` and `feedback` tables live in **Round's** Supabase project, reached through
`src/supabaseCustomers.js` (`VITE_ROUND_SUPABASE_URL`); `send-voucher-email` is deployed only on
Round. Build in Round first, then port here deliberately (see `docs/build/`).

## Architecture invariants
- Availability and table assignment are server-side (`get_availability`, `create_reservation_atomic`,
  `assign_tables`); the client never locks tables itself.
- Tonda's weekend is **Friday/Saturday** (`dow in (5, 6)`) everywhere; `day_type` is
  `'weekday' | 'weekend'` only (PH branch disabled 2026-09-18, see
  `docs/superpowers/specs/2026-09-18-ops-tweaks-port-design.md` §3 to restore).
- `operating_hours.closed_days` is **jsonb** here (Round's is text[]): SQL uses the `?` operator.
- Dates compare as local `YYYY-MM-DD` strings from `getLocalToday()`.
- Customer counters on Round's `customers` are maintained by `src/lib/customerVisits.js` with
  `restaurant: 'tonda'` and must stay consistent with `customer_visits` rows.
- Admin theme tokens from `src/lib/adminTheme.js` (`BRAND = #E8420A`, `CREAM = #FFFFFF`); no new colours.

## Build harness
- default branch: main
- env files to copy into a worktree: .env.local
- install: npm install
- verify: npm run build
- test: npm test
- lint: npm run lint — not clean on main (14 problems: 10 errors / 4 warnings as of 2026-09-18); gate on "no new problems"
- migrations dir: supabase/migrations   (owner runs `supabase db push` against Tonda's project; never from a worktree)
- invariant greps: toISOString\(\)\.slice\(0, ?10\) ; day_type === 'public_holiday' ; = any\(v_hours\.closed_days\)
- dev server: npm run dev -- --port 31NN
- worktree Bash quirk: inside a worktree the Bash tool refuses `&&`, `$(...)`, `for`, `cd`, `git -C`; single plain commands. Stage by path, never `git add -A`.
