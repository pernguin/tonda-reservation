# 05 — Server availability: the booking page asks `get_availability`, not the browser

Tonda's public booking page (`src/pages/Reservations.jsx`) works out availability in the browser: it
reads every reservation for the date and every bookable table from Supabase with the anon key
(`searchAvailability` line 150, `checkAvailability` line 134, `getSmallTableCapacity` line 54), then does
the capacity maths itself in `computeAvailability` (line 93). That duplicates the server's rules (the
copy can drift from `get_availability` / `create_reservation_atomic`), forces anon read access on
`reservations` and `restaurant_tables` (Tonda 10 cannot lock those down while this page reads them), and
fires 4–6 sequential round trips per search. After this package the page gets its slots from
`supabase.rpc('get_availability', { p_date, p_guest_count })` for both the slot list and the pre-submit
check, sends the RPC's own `day_type` to `create_reservation_atomic`, and no longer reads `reservations`
or `restaurant_tables` at all. It also fixes the UTC date bug on the Experiences list, validates the phone
before the availability check, blocks double-submits, and hoists `CopyButton` out of the component.

Branch: `build/05-server-availability`
Brainstormed: 2026-10-17. Decisions made by Claude under Perng's 2026-10-17 'work autonomously' instruction; see docs/build/2026-10-17-audit-plan.md.
Depends on: Tonda 03 (`get_availability` hardening: `p_guest_count < 1` returns nothing, `STABLE`) merged and
deployed before this ships. Builders can build and test without it. No migration in this package.

---

## Plan discrepancies

The plan is right about the lines it names (`Reservations.jsx:291` is the UTC bug; `CopyButton` is defined
inside the component at line 493). It is incomplete in these places, and the brief writes to the code:

1. **`getDateInfo` cannot shrink to "closed/blocked messaging" only.** Besides closed/blocked, the page
   uses `info.slotRule` and `info.operatingHours` for the session labels (`getTimeSlotGroups`, line 228),
   `hold_duration_minutes` (the "Tables are held for…" text, line 627, and `confirmedBooking.durationMinutes`),
   and the submit-time session validation (lines 436–447). `get_availability` returns bare times, not
   labels or hold minutes. So `getDateInfo` keeps returning `slotRule` / `operatingHours`; the change is
   `Promise.all` plus the cache, as the plan says. The three reads are `blocked_dates`, `operating_hours`
   and `slot_rules`; `day_type` itself comes from the local `getDayType()` (no network while
   `PUBLIC_HOLIDAYS_ENABLED` is false).
2. **`get_availability` has no same-day lead-time cutoff** (Tonda 03 adds one to `create_reservation_atomic`
   only). The client filter `isSlotBookable` (`src/lib/slotCutoff.js`) must stay, applied to the RPC result.
3. **`get_availability` returns `slot` as a `time`, so PostgREST sends `"18:00:00"`**; the page's slot
   values are `"18:00"`. Slots are compared on their first five characters. The value sent to
   `create_reservation_atomic` stays `"HH:MM"` (as today).
4. **The "party too large" path is dead today.** `computeAvailability` returns `available: true` for any
   guest count over 8 (line 119), so 11–50 guests (the input allows 50) reach the server. `get_availability`
   returns no rows for more than 10 guests (migration line 58), which would show the generic
   "No availability" message. The brief keeps the existing copy from line 125 ("Party size too large —
   please contact us directly.") for that case. It also rejects a guest count below 1 in the client,
   because `"0"` is truthy and today's guard is `!guestsRaw`.
5. **Lint:** CLAUDE.md says 14 problems, Tonda 02 measured 16 (11/5) on 2026-09-24. Record the count on
   a clean checkout of `main` in your worktree first (T0); the gate is "no more than that". Hoisting
   `CopyButton` should remove one error.

## Decisions

| Question | Chosen | Rejected | Why |
|---|---|---|---|
| Source of slots | `supabase.rpc('get_availability', {p_date, p_guest_count})` for the slot list and the pre-submit check | Keep client maths | One copy of the rules; lets Tonda 10 drop anon reads of `reservations`/`restaurant_tables` |
| Dead client code | Delete `computeAvailability`, `getSmallTableCapacity`, `getBlackoutWindows` and the anon `reservations` / `restaurant_tables` reads | Leave as fallback | Fallback would keep the anon reads alive |
| `getDateInfo` | Keep, for closed/blocked messaging and session labels; run its three reads in `Promise.all`; cache `operating_hours` / `slot_rules` for the page's lifetime | Remove it; cache across navigations | Messages need it; admin edits to slot rules should show on the next page load |
| `p_day_type` sent to create | The `day_type` returned by `get_availability` | `getDayType()` result | Same value the server computed; Tonda 03 makes create ignore it anyway |
| Experiences filter date | `getLocalToday()` (fixes the UTC bug at `Reservations.jsx:291`) | `new Date().toISOString()` | Dates are local `YYYY-MM-DD` everywhere |
| Phone validation | Before the availability check | After (today) | No point checking tables for a submission that will be rejected |
| Double submit | `useRef` guard in `handleSubmit` | Rely on `loading` state | State updates are async; a fast double click gets through |
| `CopyButton` | Hoisted to module level | Leave inside the component | Lint `static-components`; remounts on every render |

## Files

Exhaustive. File ownership (plan): `Reservations.jsx` belongs to this package; Tonda 06 edits only
`handlePhoneBlur` (lines 328–351) and the birthday-prompt condition (line 664). Do not touch those lines.

| Path | Change |
|---|---|
| `src/lib/availabilitySlots.js` | new — pure helpers: `MAX_ONLINE_PARTY`, `slotKey`, `pickAvailableGroups`, `findSlotRow` |
| `src/lib/availabilitySlots.test.js` | new — vitest for the above |
| `src/pages/Reservations.jsx` | modify — RPC-based search and pre-submit check; delete client availability maths (lines 45–170); `getDateInfo` parallel + cached; experiences date; phone check order; double-submit ref; hoist `CopyButton` |

## Invariants touched

- **Availability and table assignment are server-side:** this package makes the page comply fully. The
  client no longer reads `reservations` / `restaurant_tables` and never locks tables.
- **Weekend is Fri/Sat; `day_type` is `'weekday' | 'weekend'`:** `p_day_type` now comes from the RPC. The
  local `getDayType()` is still used to pick which `operating_hours` / `slot_rules` row to read.
- **Dates compare as local `YYYY-MM-DD` strings from `getLocalToday()`:** the line-291 fix restores this.
- Customer counters, admin theme: not touched. `isSlotBookable` keeps its `LEAD_TIME_MINUTES` rule.

## Tasks

Global: work only in the files named; stage by path; `npm test` must pass; lint no worse than the T0
count; commit messages end with the attribution lines the harness gives you. Match surrounding style
(no semicolons, single quotes, 2-space indent). Do not run anything against the live Supabase project.

### T0 — Baseline
**Do:** In the worktree, copy `.env.local`, run `npm install`, then record the lint count with
`npm run lint 2>&1 | tail -3` (note the "N problems (E errors, W warnings)" line). Do not change files.
**Verify:** you have a number; `npm test` and `npm run build` pass on the untouched branch.

### T1 — Pure slot helpers with tests
**Do:** Create `src/lib/availabilitySlots.js`:
- `export const MAX_ONLINE_PARTY = 10` (mirrors the `p_guest_count > 10` early return in
  `get_availability`).
- `export function slotKey(time)` returns `String(time).slice(0, 5)` (`'18:00:00'` → `'18:00'`).
- `export function findSlotRow(rows, time)` returns the first row in `rows` (the RPC result:
  `{ slot, day_type, requires_approval }`) where `slotKey(row.slot) === slotKey(time)`, else `undefined`.
- `export function pickAvailableGroups(slotGroups, rows, date, isBookable = () => true)` returns
  `slotGroups` (shape `{ sessionLabel, slots: [{ value, label }] }`) with each group's `slots` filtered to
  those where `findSlotRow(rows, slot.value)` exists **and** `isBookable(slot.value, date)` is true,
  dropping groups left empty. Do not mutate the input.
Create `src/lib/availabilitySlots.test.js` (vitest, same style as `src/lib/slotCutoff.test.js`): `slotKey`
trims seconds and leaves `'18:00'` alone; `findSlotRow` matches `'18:00'` against `'18:00:00'` and returns
`undefined` for a miss and for empty rows; `pickAvailableGroups` keeps only returned slots, drops an
emptied group, honours an injected `isBookable` that rejects one slot, and returns `[]` for empty rows.
**Verify:** `npx vitest run src/lib/availabilitySlots.test.js` passes; `npm run lint` not worse than T0.

### T2 — Delete the client availability maths
**Do:** In `src/pages/Reservations.jsx` delete `getTablesNeeded`, `getSmallTableCapacity`,
`getBlackoutWindows`, `isBlackedOut`, `computeAvailability`, `checkAvailability` and `searchAvailability`
(currently lines 45–170, contiguous; keep `getDateInfo` above and `formatTime12` below). Import
`pickAvailableGroups`, `findSlotRow`, `MAX_ONLINE_PARTY` from `../lib/availabilitySlots`. Add, above
`formatTime12`:
```js
async function fetchAvailability(date, guestCount) {
  const { data, error } = await supabase.rpc('get_availability', { p_date: date, p_guest_count: guestCount })
  if (error) throw error
  return data || []
}
```
Do not rewire callers yet. The file will not build between T2 and T5, so do T2–T5 in order without
running `npm run build` in between; the build gate is at the end of T5.
**Verify:** `grep -nE "computeAvailability|getSmallTableCapacity|getBlackoutWindows|searchAvailability|checkAvailability|getTablesNeeded|isBlackedOut" src/pages/Reservations.jsx` shows only the callers T3/T4 are about to replace (empty after T4).

### T3 — `getDateInfo` in parallel, with a cache
**Do:** Rewrite `getDateInfo(date, configCache)` (line 10):
- Keep the early-return shapes (`{ closed: true, reason }` and the final
  `{ closed: false, day_type, dayName, slotRule, operatingHours: hours, max_pax }`) so callers do not change.
- `const day_type = await getDayType(date)` first (local, no network), then
  `const [blockedRes, config] = await Promise.all([ <blocked_dates select by blocked_date>.maybeSingle(), loadDayConfig(day_type, configCache) ])`.
  Throw `blockedRes.error` if set.
- Add module-level `loadDayConfig(dayType, cache)` where `cache` is a `Map`: if no entry, store a promise of
  `Promise.all([operating_hours by day_type .maybeSingle(), slot_rules by day_type .maybeSingle()])` mapped to
  `{ hours, slotRule }` (throw on either `.error`); attach `.catch(() => cache.delete(dayType))` so a failed
  load is retried next time; return `cache.get(dayType)`. `blocked_dates` is **not** cached (admin blocks must
  show immediately).
- Closed checks as today: `blocked?.is_closed`, then `hours?.closed_days?.includes(dayName)`.
In the component add `const configCacheRef = useRef(new Map())` next to the other refs (line 286) and pass
`configCacheRef.current` at both call sites (`runSearch`, `handleSubmit`); only read it inside handlers.
**Verify:** (build is deferred to T5) `grep -c "Promise.all" src/pages/Reservations.jsx` is at least 1; the three
`.from('blocked_dates'|'operating_hours'|'slot_rules')` calls each appear exactly once.

### T4 — `runSearch` uses the RPC
**Do:** In `runSearch` (line 353): after the two date-range guards, parse `const guestCount = parseInt(guestsRaw, 10)`.
If `!(guestCount >= 1)` set `searchError` to `'Please enter at least 1 guest.'`; if
`guestCount > MAX_ONLINE_PARTY` set `'Party size too large — please contact us directly.'`; both set
`hasSearched` true and return (same pattern as the date guards). Then wrap the rest in
`try { … } catch { setSearchError('Something went wrong. Please try again.') } finally { setSearchLoading(false) }`
(today a thrown read leaves the spinner stuck). Inside: `setSearchLoading(true)`, then
`const [info, rows] = await Promise.all([getDateInfo(date, configCacheRef.current), fetchAvailability(date, guestCount)])`.
Keep the `info.closed` and `info.max_pax` messages exactly (check them before using `rows`). Then
`const slotGroups = getTimeSlotGroups(info)`, `const resultGroups = pickAvailableGroups(slotGroups, rows, date, isSlotBookable)`,
`setSearchDurationMinutes(info.slotRule?.hold_duration_minutes ?? 120)`, `setAvailableGroups(resultGroups)`,
`setHasSearched(true)`. Remove the now-duplicate manual `setSearchLoading(false)` calls.
**Verify:** (build is deferred to T5) `grep -n "searchAvailability" src/pages/Reservations.jsx` empty; `grep -n "fetchAvailability" src/pages/Reservations.jsx` shows the definition and this call.

### T5 — `handleSubmit`: phone first, RPC check, double-submit guard
**Do:** In `handleSubmit` (line 423):
- Add `const submitLockRef = useRef(false)`. At the top: `if (submitLockRef.current) return`, then
  `submitLockRef.current = true`; in the existing `finally`, set it back to `false` before `setLoading(false)`.
- Move the `isValidPhone(normalisePhone(form.phone))` block (currently after the availability check,
  line 452) to the top of the `try`, before `getDateInfo`. Same message.
- Replace `checkAvailability(...)` (line 449) with:
  `const rows = await fetchAvailability(form.reservation_date, parseInt(form.guest_count, 10))`,
  `const slotRow = findSlotRow(rows, form.reservation_time)`; if `!slotRow || !isSlotBookable(form.reservation_time, form.reservation_date)`
  set error `"Sorry, we don't have enough tables for this time slot. Please choose a different time."` (the
  old text from line 128), `setLoading(false)` is handled by `finally`, return.
- In the `create_reservation_atomic` call use `p_day_type: slotRow.day_type` (was `info.day_type`).
- The `durationMinutes` local (line 437) stays (used for `confirmedBooking`).
Do not touch `findOrCreateCustomer(...)` or `birthdate` handling: Tonda 06 owns that call's module.
**Verify:** `npm run build`; `npm run lint` not worse than T0; `grep -n "info.day_type" src/pages/Reservations.jsx` empty;
`grep -n "p_day_type: slotRow.day_type" src/pages/Reservations.jsx` one hit.

### T6 — Experiences date and `CopyButton`
**Do:** In `fetchExperiences` (line 290) replace `new Date().toISOString().split('T')[0]` with
`getLocalToday()` (already imported). Move `CopyButton` (currently inside the component at line 493, badly
indented) to module scope, directly after the `labelClass` const (line 259), unchanged except indentation;
it uses the module-level `BRAND`. No other change.
**Verify:** `grep -n "toISOString" src/pages/Reservations.jsx` empty; `npm run lint` count is lower than or
equal to T0, and its output no longer lists `Reservations.jsx` under `react-hooks/static-components`;
`npm run build`.

## Verify (whole package)

- `npm run build` exit 0; `npm test` exit 0 (new file included).
- `npm run lint`: no more problems than the T0 baseline (expect one fewer from `CopyButton`).
- Invariant greps, all empty: `grep -rnE "toISOString\(\)\.slice\(0, ?10\)" src`;
  `grep -rn "day_type === 'public_holiday'" src`; `grep -rn "= any(v_hours.closed_days)" supabase`;
  and package-specific `grep -n "from('reservations')\|from('restaurant_tables')" src/pages/Reservations.jsx`.
- Manual check, **owner only** (needs live data; builders do not run this): `npm run dev -- --port 3105`, open
  `/reservations`:
  1. Pick a future weekday and 2 guests, Search: session groups and times appear; Network tab shows one
     `get_availability` POST and **no** GET to `/reservations` or `/restaurant_tables`.
  2. Same date, 7 guests: results still appear (big table); 11 guests: "Party size too large — please contact us directly."; 0 guests: "Please enter at least 1 guest."
  3. A blocked/closed date and a closed weekday show their existing messages.
  4. Today's date: slots earlier than now + 30 min are absent.
  5. Search twice for the same day type: Network tab shows `operating_hours` / `slot_rules` fetched once.
  6. Pick a slot, enter a bad phone, submit: phone error appears with no `get_availability` call. Enter a
     good phone, double-click Submit: one `create_reservation_atomic` call; success screen with the Copy button working.
  7. Experiences list near midnight MYT still shows today's experience (compare against admin).

## Out of scope

- Round's booking page (follow-up port; plan "Round 05" note).
- Same-day cutoff, day-type derivation and guest-count checks inside `create_reservation_atomic` (Tonda 03).
- Locking down anon reads (Tonda 10).
- `getDateInfo` day-name parsing via `new Date('YYYY-MM-DD')` (UTC) in non-MYT browsers: noticed, not changed.
- The 9–10 pax / big-table approval rule (Perng's morning list).
- Phone/customer prefill and `findOrCreateCustomer` (Tonda 06).
- `docs/build/README.md` index rows (the orchestrator adds them to avoid parallel-branch conflicts).
