# 07 — Admin: Round login, `log_visit`, and Bookings fixes

Tonda staff sign in to Tonda's Supabase project only, so every admin call to Round's shared tables
(`customers`, `customer_visits`, `feedback`) runs with the anon key. That is why Round 06 cannot lock those
tables yet. Visit counting is also done in the browser: `logVisitFromReservation`
(`src/lib/customerVisits.js:15`) reads the customer, adds one, writes it back, and only runs for
`completed` / `no_show`; cancelling or un-completing a booking never reverses a counter, and every error
is swallowed into `console.error`. On the Tonda side, `Bookings.jsx` `updateStatus` (line 302) releases table
locks and unmerges table groups only for `completed` (lines 321–350), so a cancelled or no-show booking keeps
its tables locked, and none of those five writes checks its error. The page also loads every reservation
ever made (line 259) and sends every customer id in one `.in()` (line 286). After this package: login signs
in to both projects (Round failure shows a persistent banner but never blocks Tonda), sign-out signs out of
both, Bookings calls Round's `log_visit` RPC on every reservation status change and toasts failures,
cancel/no-show release tables like completed does with every error checked, reservations load from 60 days ago
with a "Load older" button, customer lookups are chunked to 100 ids, and the list partitions are memoised.

Branch: `build/07-admin-round-auth-and-visits`
Brainstormed: 2026-10-17. Decisions made by Claude under Perng's 2026-10-17 'work autonomously' instruction; see docs/build/2026-10-17-audit-plan.md.
Depends on: Round 04 migration applied before deploy (`log_visit` must exist). Also, before this merges,
Round logins must exist for every Tonda staff account (same email and password; plan "Morning list" item 2),
otherwise those users see the banner and visit recording fails. Builders can build and unit-test without
Round 04: `log_visit` and auth calls are mocked in vitest. No migration in this package.

---

## Plan discrepancies

1. **Sign-out is not in a file this package owns.** The plan says "Sign-out signs out of both", but the only
   `signOut` calls are in `src/components/Navbar.jsx:22` and `src/pages/Home.jsx:21`, both owned by Tonda 09.
   So this package does not edit them. Instead `RequireAuth.jsx` (07-owned) registers a module-level
   listener on Tonda's auth client: on `SIGNED_OUT` it signs the Round client out (`scope: 'local'`).
   `App.jsx` imports `RequireAuth` statically, so the listener is live on every page, including `/` where
   `Home.jsx` shows its own Log out. This also covers token-expiry sign-outs and sign-out from another tab.
   Report it if Tonda 09 makes `RequireAuth` lazy: the listener would then register late.
2. **Round sign-out must be `scope: 'local'`.** Supabase's default is a global sign-out, which revokes the
   user's refresh tokens everywhere, including the Round admin app on other devices (same Round user).
3. **`CLAUDE.md` goes stale.** Its invariant "Customer counters … are maintained by
   `src/lib/customerVisits.js`" stays true in name but the maintenance moves into Round's `log_visit`
   function. `CLAUDE.md` is owned by Tonda 09, so this package does not edit it; the PR body flags it.
4. **"Bookings load window" covers reservations only.** The plan says "reservations from 60 days ago
   onward". `events` and `offsite_bookings` are low volume and stay fully loaded, so the Past tab's count
   still includes all of them. The "Load older" button therefore loads older **reservations**.
5. **A date filter older than the window would silently show nothing.** The default filter is today, but
   picking an older date (or the Status filter on Past) would hit an unloaded range. The window start is
   therefore `min(loadFrom, filterDate)` (T1, T8). Not in the plan; required for correctness.
6. **`logVisitFromReservation` had a quiet idempotency guard** (skip if the visit row already has the same
   status, lines 24–30). `log_visit` is specified to reverse and re-apply, so the guard is dropped on
   purpose: completing again with a corrected amount now fixes `total_spent`.
7. **`nextSpend` and `isLatestVisit` (and their tests) become dead code** once the counters move to the RPC,
   so this package removes them.
8. **Lint baseline:** CLAUDE.md says 14 problems; Tonda 02 measured 16 (11/5). Record the number on a clean
   checkout (T0); the gate is no more than that.

## Decisions

| Question | Chosen | Rejected | Why |
|---|---|---|---|
| Round auth | Tonda staff sign in to Round's project too: `Login.jsx` calls `supabaseCustomers.auth.signInWithPassword` with the same credentials after Tonda succeeds. If Round fails, Tonda login still succeeds and a persistent admin banner says "Customer data unavailable: no Round login for this account". Sign-out signs out of both. **(Claude)** | Proxying every admin customer call through a Tonda edge function with Round's service key | Much bigger, and adds a second secret |
| Visit recording | `customerVisits.js` calls Round `log_visit`, and Bookings calls it on every reservation status change (not only completed/no_show), surfacing failures as a toast. | Keep browser-side counter updates | Not atomic, never reverses, swallows errors |
| Table release | Admin cancel/no-show releases table locks and merged groups exactly like completed does, and checks every error. | Release only on completed | Cancelled/no-show bookings keep their tables locked |
| Bookings load | Reservations from 60 days ago onward, with a "Load older" button that pages back 60 days at a time. Customer lookup is chunked (≤ 100 ids per `.in()`). Partitions are memoised. **(Claude)** | Load everything; server pagination | Smallest change that bounds the query |
| `log_visit` contract | `log_visit(p_reservation_id uuid, p_customer_id uuid, p_restaurant text, p_status text, p_pax int, p_visited_at date, p_amount_spent numeric) returns void`, authenticated only. It reverses the previous visit row's effect, then applies the new one (completed/no_show upsert the visit row; any other status deletes it). | — | Plan "Round 04"; use exactly these parameter names |

## Files

Exhaustive. File ownership (plan): `Bookings.jsx`, `customerVisits.js`, `Login.jsx`, `RequireAuth.jsx` belong
to this package. `AdminNav.jsx` is not in anyone's list; this package adds the banner there.

| Path | Change |
|---|---|
| `src/lib/bookingsList.js` | new — `LOAD_WINDOW_DAYS`, `CUSTOMER_ID_CHUNK`, `windowStart`, `olderWindowStart`, `effectiveWindowStart`, `chunk`, `partitionBookings`, `releasesTables` |
| `src/lib/bookingsList.test.js` | new |
| `src/lib/customerVisits.js` | rewrite — `buildLogVisitArgs`, `logVisit(client, …)`; delete `nextSpend`, `isLatestVisit`, `logVisitFromReservation` |
| `src/lib/customerVisits.test.js` | rewrite — tests for the new exports (old tests deleted with their functions) |
| `src/lib/adminSession.js` | new — `signInBoth`, `shouldSignOutRound`, `installRoundSignOutSync` (no client imports; clients are passed in) |
| `src/lib/adminSession.test.js` | new |
| `src/lib/useRoundSession.js` | new — hook: does the Round client hold a session? |
| `src/pages/admin/Login.jsx` | modify — `signInBoth` |
| `src/components/RequireAuth.jsx` | modify — module-level sign-out sync |
| `src/components/AdminNav.jsx` | modify — persistent banner |
| `src/pages/admin/Bookings.jsx` | modify — `logVisit`, `releaseTables`, load window, chunking, memoised partitions |

## Invariants touched

- **Customer counters on Round's `customers` must stay consistent with `customer_visits` rows:** now done
  atomically by Round's `log_visit` (it updates both), called with `restaurant: 'tonda'`. The client never
  writes counters again. Counters are never recomputed from scratch (the plan notes 5,119 customers have
  counters without visit rows); that is the RPC's job, not this package's.
- **Dates compare as local `YYYY-MM-DD` strings from `getLocalToday()`:** the window math uses `addDays` from
  `src/lib/experienceSeries.js` (local-date based, no `toISOString`).
- **Availability and table assignment are server-side:** the table release on cancel/no-show only clears
  locks and groups on `restaurant_tables` / `table_groups`, exactly as the completed path does today; no
  assignment logic is added to the client.
- **Admin theme tokens:** the banner and "Load older" button reuse `BRAND` and the amber classes already used
  by the "Needs Table" badge in `Bookings.jsx`. No new colours.
- `day_type`, `closed_days`: not touched.

## Tasks

Global: work only in the files named; stage by path; `npm test` must pass; lint no worse than the T0 count;
commit messages end with the attribution lines the harness gives you. Match surrounding style (no
semicolons, single quotes, 2-space indent). Do not run anything against the live Supabase projects;
`log_visit` and the auth calls are mocked in tests.

### T0 — Baseline
**Do:** In the worktree copy `.env.local`, `npm install`. Record the lint count with
`npm run lint 2>&1 | tail -3`. Do not change files.
**Verify:** you have the number; `npm test` and `npm run build` pass on the untouched branch.

### T1 — Bookings list helpers with tests
**Do:** Create `src/lib/bookingsList.js` (import `addDays` from `./experienceSeries`):
- `export const LOAD_WINDOW_DAYS = 60`, `export const CUSTOMER_ID_CHUNK = 100`.
- `windowStart(today, days = LOAD_WINDOW_DAYS)` returns `addDays(today, -days)`.
- `olderWindowStart(currentStart, days = LOAD_WINDOW_DAYS)` returns `addDays(currentStart, -days)`.
- `effectiveWindowStart(loadFrom, filterDate)` returns `filterDate` when it is a non-empty string earlier than
  `loadFrom`, else `loadFrom`.
- `chunk(items, size)` splits an array into arrays of at most `size` (empty input returns `[]`; `size` < 1
  throws a `RangeError`).
- `partitionBookings(items, dateField, today)` returns `{ upcoming, past }`: `upcoming` when
  `item[dateField] >= today && item.status !== 'cancelled'`, otherwise `past` (so every item lands in exactly
  one list; same rule as lines 358–363 of `Bookings.jsx`).
- `releasesTables(status)` is true for `'completed'`, `'cancelled'`, `'no_show'`, false otherwise.
Create `src/lib/bookingsList.test.js`: `windowStart('2026-10-17')` is `'2026-08-18'`; across a year boundary
(`windowStart('2026-01-10')` is `'2025-11-11'`); `olderWindowStart('2026-08-18')` is `'2026-06-19'`;
`effectiveWindowStart` with an older filter date, a newer one, `''` and `undefined`; `chunk` of 0, 1, 100, 101
and 250 ids with size 100 (chunk lengths `[]`, `[1]`, `[100]`, `[100, 1]`, `[100, 100, 50]`) and the `RangeError`; `partitionBookings` puts
a cancelled future booking and a yesterday booking in `past`, today and future in `upcoming`, and loses no item;
`releasesTables` for all six statuses.
**Verify:** `npx vitest run src/lib/bookingsList.test.js` passes.

### T2 — `customerVisits.js` calls `log_visit`
**Do:** Replace the contents of `src/lib/customerVisits.js` with two exports and **no import of the Supabase
client** (the client is passed in, so tests need no env):
```js
export function buildLogVisitArgs(reservation, newStatus, restaurant, amountSpent = null) {
  if (!reservation?.customer_id) return null
  return {
    p_reservation_id: reservation.id,
    p_customer_id: reservation.customer_id,
    p_restaurant: restaurant,
    p_status: newStatus,
    p_pax: reservation.guest_count ?? null,
    p_visited_at: reservation.reservation_date,
    p_amount_spent: newStatus === 'completed' ? (amountSpent ?? null) : null,
  }
}

// Returns null on success or skip, otherwise the error. Never throws.
export async function logVisit(client, reservation, newStatus, restaurant, amountSpent) {
  const args = buildLogVisitArgs(reservation, newStatus, restaurant, amountSpent)
  if (!args) return null
  try {
    const { error } = await client.rpc('log_visit', args)
    return error || null
  } catch (err) {
    return err
  }
}
```
Rewrite `src/lib/customerVisits.test.js` (delete the `nextSpend` / `isLatestVisit` cases): no customer id returns
`null` args and `logVisit` returns `null` without calling `rpc`; `completed` with an amount sends it; `completed`
with `undefined` amount sends `null`; `no_show` ignores a supplied amount (`null`); each of `pending`,
`confirmed`, `seated`, `cancelled` passes its status through with a `null` amount; the full arg object for one
case is asserted with `toEqual`; `logVisit` with `client = { rpc: vi.fn().mockResolvedValue({ error: { message: 'x' } }) }`
returns that error and with `mockRejectedValue(new Error('boom'))` returns the error instead of throwing, and
`rpc` was called with `'log_visit'`.
**Verify:** `npx vitest run src/lib/customerVisits.test.js` passes; `grep -n "supabase" src/lib/customerVisits.js` empty.
(`Bookings.jsx` will not build until T7 imports `logVisit`; do not run `npm run build` between T2 and T7.)

### T3 — Admin session helpers with tests
**Do:** Create `src/lib/adminSession.js` (no client imports; callers pass the `auth` objects):
- `export async function signInBoth({ tondaAuth, roundAuth }, credentials)`: `await tondaAuth.signInWithPassword(credentials)`;
  if it returns an `error`, return `{ tondaOk: false, roundOk: false }` without touching Round. Otherwise try
  `await roundAuth.signInWithPassword(credentials)` inside `try/catch`; `roundOk = !error` (a throw counts as
  failure). If Round failed, `try { await roundAuth.signOut({ scope: 'local' }) } catch {}` so no stale Round
  session of another user lingers. Return `{ tondaOk: true, roundOk }`.
- `export function shouldSignOutRound(event)` is `event === 'SIGNED_OUT'`.
- `export function installRoundSignOutSync(tondaAuth, roundAuth)` calls
  `tondaAuth.onAuthStateChange(event => { if (shouldSignOutRound(event)) roundAuth.signOut({ scope: 'local' }) })`
  and returns what `onAuthStateChange` returned (the `{ data: { subscription } }` object). Catch a rejected
  `signOut` promise with `.catch(() => {})` so it cannot raise an unhandled rejection.
Create `src/lib/adminSession.test.js` with fake auth objects: Tonda fails → Round never called, `{ tondaOk: false, roundOk: false }`;
both succeed → `{ tondaOk: true, roundOk: true }` and Round `signOut` not called; Round returns `{ error }` →
`{ tondaOk: true, roundOk: false }` and `signOut` called with `{ scope: 'local' }`; Round throws → same;
`installRoundSignOutSync` registers one handler, `SIGNED_OUT` triggers `roundAuth.signOut({ scope: 'local' })`,
`SIGNED_IN`, `TOKEN_REFRESHED` and `INITIAL_SESSION` do not.
**Verify:** `npx vitest run src/lib/adminSession.test.js` passes.

### T4 — Login signs in to both
**Do:** In `src/pages/admin/Login.jsx` import `supabaseCustomers` from `../../supabaseCustomers` and
`signInBoth` from `../../lib/adminSession`. In `handleLogin` (line 14) replace the single
`supabase.auth.signInWithPassword` call with
`const { tondaOk } = await signInBoth({ tondaAuth: supabase.auth, roundAuth: supabaseCustomers.auth }, { email, password })`;
`if (!tondaOk)` show the existing "Incorrect email or password." and `setLoading(false)`; else `navigate('/admin')`.
Do not show a Round-specific error on this screen (the banner does that).
**Verify:** `npm run build` is deferred to T7 (Bookings); here `npm run lint` not worse than T0 and
`grep -n "signInBoth" src/pages/admin/Login.jsx` shows the import and one call.

### T5 — Sign-out sync in `RequireAuth.jsx`
**Do:** In `src/components/RequireAuth.jsx` import `supabaseCustomers` and `installRoundSignOutSync`, and add one
module-level line after the imports: `installRoundSignOutSync(supabase.auth, supabaseCustomers.auth)`. Add a
one-line comment saying why it is module-level (Home's Log out runs where `RequireAuth` is not mounted). Do not
change the component.
**Verify:** `npm run lint` not worse than T0; `grep -n "installRoundSignOutSync" src/components/RequireAuth.jsx` shows import + call.

### T6 — Round session hook and banner
**Do:** Create `src/lib/useRoundSession.js` exporting `useRoundSession()`: `useState(undefined)`; in `useEffect`
call `supabaseCustomers.auth.getSession()` (set `!!session` unless unmounted, same pattern as
`src/components/RequireAuth.jsx`) and subscribe with `supabaseCustomers.auth.onAuthStateChange((_event, session) => setHasSession(!!session))`;
unsubscribe on cleanup; return the state (`undefined` while loading, then `true` / `false`). In
`src/components/AdminNav.jsx` call the hook and wrap the return in a fragment: the existing `<nav>` unchanged,
followed by, only when the value is exactly `false`,
`<div role="status" className="px-6 py-2 text-xs bg-amber-100 text-amber-700">Customer data unavailable: no Round login for this account</div>`
(amber classes already exist in `Bookings.jsx` "Needs Table"). The banner is derived from the live Round
session, never stored.
**Verify:** `npm run lint` not worse than T0; `grep -n "Customer data unavailable: no Round login for this account" src/components/AdminNav.jsx` one hit.

### T7 — Bookings: `log_visit` on every status change, table release, checked errors
**Do:** In `src/pages/admin/Bookings.jsx`: replace the `logVisitFromReservation` import (line 4) with
`logVisit` from `../../lib/customerVisits`; add `releasesTables` from `../../lib/bookingsList`. Add a module-level
helper above `Bookings`:
```js
// Returns null on success, otherwise the first error. Mirrors what the completed path did, with every step checked.
async function releaseTables(reservation) {
  const ids = reservation?.table_ids
  if (!Array.isArray(ids) || ids.length === 0) return null
  const { error: lockError } = await supabase.from('restaurant_tables')
    .update({ locked_until: null, locked_by_reservation: null }).in('id', ids)
  if (lockError) return lockError
  const { data: grouped, error: groupError } = await supabase.from('restaurant_tables')
    .select('id, group_id').in('id', ids).not('group_id', 'is', null)
  if (groupError) return groupError
  if (!grouped?.length) return null
  const groupIds = [...new Set(grouped.map(t => t.group_id))]
  const { error: clearError } = await supabase.from('restaurant_tables').update({ group_id: null }).in('group_id', groupIds)
  if (clearError) return clearError
  const { error: deleteError } = await supabase.from('table_groups').delete().in('id', groupIds)
  return deleteError || null
}
```
Replace lines 314–350 of `updateStatus` (from `const reservation =` through the end of the completed-only
block) with: `const reservation = table === 'reservations' ? reservations.find(r => r.id === id) : null`;
`const problems = []`; when `reservation`: `const visitError = await logVisit(supabaseCustomers, reservation, status, 'tonda', amountSpent)`
and push `` `guest visit not recorded (${visitError.message})` `` if set; if `releasesTables(status)` then
`const releaseError = await releaseTables(reservation)` and push `` `tables not released (${releaseError.message})` ``
if set. Then `await fetchAll({ silent: true })`; if `problems.length` call
`showToast('Status updated, but ' + problems.join(' and '))`; then `setBusyId(null)`. Everything before
(`pendingComplete`, confirm prompt, the status `update` and its error toast) is unchanged.
**Verify:** `npm run build`; `npm run lint` not worse than T0; `npm test` passes;
`grep -n "logVisitFromReservation" src/pages/admin/Bookings.jsx` empty;
`grep -c "if (.*[Ee]rror) return" src/pages/admin/Bookings.jsx` is at least 3 (the last step returns `deleteError || null`).

### T8 — Bookings: 60-day window, "Load older", chunked customer lookup
**Do:** In `Bookings.jsx` import `windowStart`, `olderWindowStart`, `effectiveWindowStart`, `chunk`,
`CUSTOMER_ID_CHUNK` from `../../lib/bookingsList`. After the `filterDate` line (237) add
`const [loadFrom, setLoadFrom] = useState(() => windowStart(getLocalToday()))`,
`const windowFrom = effectiveWindowStart(loadFrom, filterDate)` and `const windowFromRef = useRef(windowFrom)`.
`fetchAll` is also called from the realtime handler captured at mount, so it must read
`windowFromRef.current`, not the state. Change the effect at line 240: remove its `fetchAll()` call (keep the
channel setup), and add a second effect: `useEffect(() => { windowFromRef.current = windowFrom; fetchAll() }, [windowFrom])`
with the same `// eslint-disable-next-line react-hooks/exhaustive-deps` the first effect already uses. In
`fetchAll`, the reservations query gains `.gte('reservation_date', windowFromRef.current)` (before the
`.order` calls). Replace the single customers query (lines 282–293) with chunks:
`const results = await Promise.all(chunk(customerIds, CUSTOMER_ID_CHUNK).map(ids => supabaseCustomers.from('customers').select('id, full_name, phone, email, visit_count, no_show_count, birthdate, notes, tags').in('id', ids)))`;
if any result has an `error`, show the same `'Could not load bookings: ' + message` toast and stop; build
`customersById` from all `data`. Keep the same select column list (it must stay identical to Tonda 02's).
In the Past tab only, below `renderTab()` and outside the loading check, render (when not loading):
a muted line `Showing reservations from {windowFrom}.` and a button "Load older reservations" that calls
`setLoadFrom(olderWindowStart(windowFrom))`, styled like the "Edit reservation" button (outline with `BRAND`).
Events and off-site queries are unchanged.
**Verify:** `npm run build`; `npm run lint` not worse than T0;
`grep -n "\.gte('reservation_date'" src/pages/admin/Bookings.jsx` one hit;
`grep -c "\.in('id', customerIds)" src/pages/admin/Bookings.jsx` is 0.

### T9 — Bookings: memoised partitions
**Do:** In `Bookings.jsx` import `useMemo` and `partitionBookings`. Replace lines 356–365 (the `today` constant
and the nine `filter` constants) with `const today = getLocalToday()`, then
`const { upcoming: upcomingRes, past: pastRes } = useMemo(() => partitionBookings(reservations, 'reservation_date', today), [reservations, today])`,
the same for events and off-site with `'event_date'`, and
`const activeEvents = useMemo(() => events.filter(e => e.status !== 'cancelled'), [events])` (same for
`activeOffsite`). The `applyFilters` calls below stay as they are. The hooks must stay above `renderTab` and
before any conditional return (there is none).
**Verify:** `npm run build`; `npm run lint` not worse than T0; `npm test` passes;
`grep -c "useMemo" src/pages/admin/Bookings.jsx` is at least 5.

## Verify (whole package)

- `npm run build` exit 0; `npm test` exit 0 (new and rewritten test files included).
- `npm run lint`: no more problems than the T0 baseline.
- Invariant greps, all empty: `grep -rnE "toISOString\(\)\.slice\(0, ?10\)" src`;
  `grep -rn "day_type === 'public_holiday'" src`; `grep -rn "= any(v_hours.closed_days)" supabase`.
- Dead-code greps, all empty: `grep -rn "logVisitFromReservation\|nextSpend\|isLatestVisit" src`;
  `grep -rn "from('customer_visits')" src`.
- Manual check, **owner only, with Round 04 applied and a Round login for the test account** (builders do not
  run it against live data). `npm run dev -- --port 3107`:
  1. Sign in with an account that has a Round login: `/admin` loads, no banner. In devtools Application →
     Local Storage both the Tonda auth key and `supabase-customers-auth` exist.
  2. Log out from the navbar on an admin page, then sign in again and log out from the home page (`/`): after each,
     `supabase-customers-auth` is gone as well.
  3. Sign in with an account that has **no** Round login: you reach `/admin`, the amber banner "Customer data unavailable: no Round login for this account" shows on every admin page; Bookings shows the "Could not load bookings" toast or guests without names (expected until that login exists), and completing a booking toasts "Status updated, but guest visit not recorded (…)".
  4. Bookings, test reservation with a test customer: Completed with an amount → Customers page shows visit count +1 and the spend; Cancel it (accept the prompt) → count −1, spend reverted; No Show → no-show count +1; Confirmed again → no-show count back.
  5. Give a test reservation an assigned table (Floor Plan), Cancel it: the table's lock is cleared. Repeat with a merged-table booking and No Show: group unmerged.
  6. Past tab: "Showing reservations from <60 days ago>."; "Load older reservations" moves the date back 60 days and the list grows; selecting a date filter older than the window loads that range.
  7. Network tab on load: one `reservations` request with `reservation_date=gte.…` and one or more `customers` requests with ≤ 100 ids each.
  8. Switching tabs/filters does not re-run list partitioning work visibly (no flicker); a realtime new booking still appears.

## Out of scope

- Round's `log_visit` and the Round-side logins (Round 04; Perng creates the logins).
- Navbar/Home sign-out buttons (Tonda 09); `CLAUDE.md` text about counters (Tonda 09, flagged in the PR body).
- Locking Round's tables (Round 06) and Tonda's (Tonda 10).
- Windowing events/off-site; a "no more older reservations" indicator; server-side pagination.
- Other admin pages' error handling (Tonda 08); the Dashboard's "past bookings still open" count (Tonda 08).
- Backfilling or repairing counter drift (cleanup SQL, run by Perng).
- `docs/build/README.md` index rows (the orchestrator adds them to avoid parallel-branch conflicts).
