# 08 — Admin reliability: checked writes, batched layout save, lint fixes, "past bookings still open"

Today the admin config pages fire writes and never look at the result. `Tables.jsx` `saveTables` awaits one
`update` per table (about 30 round trips) and says "Saved!" whatever happens; `SlotRules.jsx`,
`Experiences.jsx` and `Settings.jsx` ignore every `{ error }`, and on a failed load `SlotRules` and
`Settings` fall back to hard-coded defaults that the next "Save All" would write over the real config.
Three admin files also fail lint (fetch function used before it is declared). Six bookings are still
`confirmed` for past dates and nothing tells staff. After this package every write checks its error and
toasts on failure, the floor-plan layout saves in one `upsert`, a failed load blocks Save instead of
offering defaults, the lint noise in these files is gone, and the Dashboard shows a derived
"N past bookings still open" banner linking to Manage Bookings. No database change.

Branch: `build/08-admin-reliability`
Brainstormed: 2026-10-17. Decisions made by Claude under Perng's 2026-10-17 "work autonomously" instruction; see docs/build/2026-10-17-audit-plan.md
Depends on: nothing (touches only the files below, none owned by another package).

---

## Plan discrepancies

The plan is slightly wrong about the lint state; this brief follows the code (measured with `npm run lint` on
main `00a0bf6`: **16 problems, 11 errors / 5 warnings**, matching the 02 brief; CLAUDE.md's "14" is stale and
is updated by package 09).

- Plan: "Lint fetch-before-declare fixed in `admin/Feedback.jsx`, `Settings.jsx`, `Tables.jsx`". Reality:
  - `admin/Feedback.jsx:26:21` error `react-hooks/immutability` + `26:40` warning `react-hooks/exhaustive-deps` (`fetchFeedback`).
  - `Settings.jsx:20:21` error `react-hooks/immutability` (`fetchSettings`); no warning.
  - `Tables.jsx:160:35` is **only a warning** (`react-hooks/exhaustive-deps`, missing `fetchAll`); there is no
    fetch-before-declare error in Tables. The file already silences the same rule with
    `// eslint-disable-next-line react-hooks/exhaustive-deps` at lines 186 and 194, so T2 does the same.
  - Expected after this package: 12 problems (9 errors / 3 warnings): minus Settings 1 error, admin/Feedback
    1 error + 1 warning, Tables 1 warning.
- Plan: Dashboard counts "date < KL today". The code's date helper `getLocalToday()` (`src/lib/tableAvailability.js:15`)
  is the browser's local date, which is KL for staff. Use it (repo invariant: dates compare as local `YYYY-MM-DD` strings).
- Plan: "Tables `saveTables` batched (one `upsert`)". The `restaurant_tables` DDL is not in `supabase/migrations`
  (pre-2026-09 schema), so NOT NULL columns cannot be checked offline. The upsert sends `id` plus all six editable
  columns, which covers every column the current update sets. It deliberately does **not** send `locked_until`,
  `locked_by_reservation`, `group_id` (a stale copy would clobber a lock taken while the layout editor was open).
  Known tradeoff: a table deleted in another tab while the layout editor is open would be re-inserted by the
  upsert. If the first real save fails, the error is now toasted instead of swallowed; report it, don't work around it.

## Decisions

| Question | Chosen | Rejected | Why |
|---|---|---|---|
| Tables layout save | One `upsert` of `{id, table_number, capacity, x_position, y_position, is_bookable, rotated}` for every table; error toasted, "Saved!" only on success | Parallel `Promise.all` of updates | Plan: "`saveTables` batched (one `upsert`)" |
| Delete-table pre-check | `reservations` query gets `.gte('reservation_date', getLocalToday())` | Cross-date check (today) | Plan: limit to `reservation_date >= today`; past bookings don't need unassigning |
| Error reporting | Check `{ error }` on every write in Tables/SlotRules/Experiences/Settings; `console.error` + `showToast` (existing `useToast`) | New toast component; silent `console.error` | Plan: "errors checked and toasted" |
| Lint fix shape | Move the fetch function inside its `useEffect` (Settings, admin/Feedback); `eslint-disable-next-line` for Tables | `useCallback` rewrite of Tables `fetchAll` (called from ~12 places) | Smallest change that clears the rule |
| Past-open count | Derived at read time on the Dashboard: `status in (confirmed, pending, seated)` and `reservation_date < getLocalToday()`; never stored **(Claude)** | A stored flag or column; auto-closing them | Repo rule: statuses derived at read time. Staff close them out in admin |
| Failed load on SlotRules / Settings | Show "Could not load ... Reload to try again." and no Save button **(Claude)** | Falling back to defaults | Defaults + Save would overwrite real config |

## Files

Exhaustive. Anything else needs the PR body to declare it.

| Path | Change |
|---|---|
| `src/lib/tableLayoutRows.js` | new — pure `toLayoutRows(tables)` for the upsert payload |
| `src/lib/tableLayoutRows.test.js` | new — vitest cases for it |
| `src/pages/admin/Tables.jsx` | modify — `fail` helper, `fetchAll` error check, eslint-disable at line 160, batched `saveTables`, checked writes + toasts, delete-check date filter |
| `src/pages/admin/SlotRules.jsx` | modify — load-failure guard, checked writes + toasts, `useToast` |
| `src/pages/admin/Experiences.jsx` | modify — checked writes + toasts, `useToast` |
| `src/pages/admin/Settings.jsx` | modify — fetch inside effect (lint), load-failure guard, single checked upsert, `useToast` |
| `src/pages/admin/Feedback.jsx` | modify — fetch inside effect (lint) only |
| `src/pages/admin/Dashboard.jsx` | modify — `pastOpen` count + banner |

Read-only for this package: `src/lib/useToast.js` (API: `const [showToast, toastNode] = useToast()`, toast lasts 2500 ms,
`toastNode` must be rendered once), `src/lib/useSavedFlash.js`, `src/components/admin/SaveButton.jsx`.
Do not touch `Bookings.jsx`, `customerVisits.js`, `Login.jsx`, `RequireAuth.jsx` (package 07), `Reservations.jsx`,
`ManageBooking.jsx`, `Feedback.jsx` (public), `ExperienceDetail.jsx`, `supabaseCustomers.js` (05/06), or anything in
`supabase/`.

## Invariants touched

- Availability/table assignment server-side: `doAssign` keeps calling `claim_restaurant_tables` before writing
  `reservations.table_ids`; only error handling is added. The client still never locks tables itself.
- Dates as local `YYYY-MM-DD` from `getLocalToday()`: the delete-check filter and the Dashboard count use it; no `toISOString().slice/split`.
- Admin theme tokens: the Dashboard banner uses `BRAND` from `src/lib/adminTheme.js`; no new colours.
- Customer counters / weekend rule / `closed_days` jsonb: not touched.

## Tasks

Global: work only in the files named; `npm test` must pass; `npm run lint` must never exceed the running count
(starts at 16 problems / 11 errors / 5 warnings, ends at 12 / 9 / 3); `npm run build` must succeed. Stage by path,
never `git add -A`. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Match surrounding
style (no semicolons, single quotes, 2-space indent). Working-tree files use CRLF line endings; keep them.
No live DB reads or writes: the dev server's `.env.local` points at production, so verify by build/lint/test and leave
the in-browser smoke to the owner. Line numbers below are from main `00a0bf6` and drift as you edit; search by symbol.

Each file that toasts gets the same two lines, placed right after its `useToast()` call:

```js
const [showToast, toastNode] = useToast()
const fail = (message, error) => { console.error(message, error); showToast(message) }
```

### T1 — Pure layout-rows helper (test first)
**Do:** Create `src/lib/tableLayoutRows.test.js` first (vitest, same style as `src/lib/slotCutoff.test.js`):
(a) `toLayoutRows([{ id: 'a', table_number: 'T1', capacity: 4, x_position: 10, y_position: 20, is_bookable: true, rotated: undefined, locked_until: 'x', group_id: 'g' }])`
returns exactly `[{ id: 'a', table_number: 'T1', capacity: 4, x_position: 10, y_position: 20, is_bookable: true, rotated: false }]`
(no `locked_until`, `locked_by_reservation`, `group_id`, `created_at`); (b) `rotated: true` is kept; (c) empty array returns `[]`;
(d) `capacity: null` stays `null` (Tables.jsx sets `capacity: parseInt(...) || null` while editing). Then create
`src/lib/tableLayoutRows.js` exporting `toLayoutRows(tables)` that makes the tests pass.
**Verify:** `npm test` passes with the new file; `npm run lint` unchanged at 16.

### T2 — Tables: `fail` helper, checked `fetchAll`, lint warning
**Do:** In `Tables.jsx` add the `fail` line after `const [showToast, toastNode] = useToast()` (line 152). Add
`// eslint-disable-next-line react-hooks/exhaustive-deps` on the line above `useEffect(() => { fetchAll() }, [selectedDate])`
(line 160), same style as lines 186/194. In `fetchAll` (line 248) change the destructuring to keep the errors:
`[{ data: tableData, error: tableError }, { data: resData, error: resError }, { data: blockData, error: blockError }, { data: slotRuleData }]`;
right after the `Promise.all`, `if (tableError || resError || blockError) { fail('Could not load the floor plan. Showing the last loaded data.', tableError || resError || blockError); return }`
(return before any `setTables` so a failed refresh never blanks the plan). Leave the `slot_rules` read lenient (it already
defaults hold to 120).
**Verify:** `npm run build`; `npm run lint` shows `Tables.jsx` with 0 problems (16 -> 15).

### T3 — Tables: batched `saveTables`
**Do:** Import `toLayoutRows` from `../../lib/tableLayoutRows`. Replace the body of `saveTables` (lines 292-305) with:
`const { error } = await supabase.from('restaurant_tables').upsert(toLayoutRows(tables), { onConflict: 'id' })`;
`if (error) { fail('Could not save the layout. Nothing was changed.', error); return }`; then keep
`setSaved(true)` and the existing 2 s `setTimeout(() => setSaved(false), 2000)`. No loop, no per-row update.
**Verify:** `npm run build`; `grep -n "for (const t of tables)" src/pages/admin/Tables.jsx` is empty;
`grep -c "upsert(toLayoutRows" src/pages/admin/Tables.jsx` = 1; `npm test`.

### T4 — Tables: check the assignment and merge writes
**Do:** Check `{ error }` and call `fail(...)` (then abort that function; do not call `fetchAll`-driven success paths) on each unchecked write:
`doAssign` the `reservations.update({ table_ids: newIds, needs_manual_assignment: false })` (line 422; message "Assigned the table lock but could not save the assignment. Refresh and check the floor plan."),
`unassignTable` both writes (lines 432-435: update reservation, then clear the table lock), `mergeTables` the `table_groups`
insert error (line 448, currently `console.error` only) and the following `restaurant_tables.update({ group_id })` (449-452),
`unmergeTables` the reservation updates in the loop (468), the table update (470-472) and the group delete (473), `createTable`'s
`insertRow` insert (483; on error keep the form open and do not clear it), and the inline **Release Lock** handler (JSX ~1292-1297).
Each message names what failed in plain words ("Could not unassign the table", "Could not merge the tables", ...).
**Verify:** `npm run build`; `npm run lint` no new problems; `grep -n "await supabase" src/pages/admin/Tables.jsx` — read each hit and confirm
it either destructures `error` or is a read that `fetchAll`/`openDeleteTableConfirm` already checks.

### T5 — Tables: delete flow and block/unblock
**Do:** In `openDeleteTableConfirm` (line 513) add `.gte('reservation_date', getLocalToday())` to the `reservations` query
(before `.order`; `getLocalToday` is already imported at line 4) and update the comment to say only today-and-later bookings are
listed. Replace the two `console.error(...); return` lines (526, 547) with `fail('Could not check which bookings use this table.', ...)`
style calls. In `confirmDeleteTable` (line 551) replace each `console.error(...); return` (571, 579, 581, 586, 589, 591) with
`fail(<plain message>, error); return` (keep the `try/finally` so `explodingTableId` still clears and `fetchAll` still runs).
`submitBlockForm` (609) and `unblockTable` (617): swap `console.error` for `fail`.
**Verify:** `npm run build`; `npm run lint` no new problems; `grep -n "console.error" src/pages/admin/Tables.jsx` has only two hits: the one inside `fail` and the claim-lost-race branch in `doAssign` (line 418, already followed by a toast).

### T6 — Settings: lint, load guard, checked save
**Do:** In `Settings.jsx` move `fetchSettings` inside the effect (`useEffect(() => { async function fetchSettings() {...} fetchSettings() }, [])`)
so the declaration precedes use. Read `{ data, error }`; on `error` set a new `loadError` state (`useState(false)`), `setLoading(false)`,
and `fail('Could not load settings.', error)`. When `loadError` is true render the existing `AdminPage` (same title/subtitle) with a
single `<p className="text-sm text-gray-500">Could not load settings. Reload the page to try again.</p>` and no `actions` (no Save button) plus `{toastNode}`.
Replace the `for` loop in `saveAll` (lines 33-35) with one call:
`supabase.from('settings').upsert(Object.entries(messages).map(([key, value]) => ({ key, value })), { onConflict: 'key' })`; on `error`
`fail('Could not save settings.', error); return`; only then `flashSaved()`. Import `useToast` from `../../lib/useToast`; render `{toastNode}` as the last child of the main `AdminPage`.
**Verify:** `npm run build`; `npm run lint`: `Settings.jsx` clean (15 -> 14); `grep -c "upsert(" src/pages/admin/Settings.jsx` = 1.

### T7 — admin/Feedback: lint only
**Do:** In `src/pages/admin/Feedback.jsx` move `fetchFeedback` (lines 28-43) inside the effect on line 26, keeping the body byte-for-byte
(`setLoading(true)`, the query, `setRows(error ? [] : (data || []))`, `setLoading(false)`) and the deps `[dateFrom, dateTo]`. Nothing else changes (no toast, no new behaviour).
**Verify:** `npm run lint`: `src/pages/admin/Feedback.jsx` clean (14 -> 12); `npm run build`.

### T8 — SlotRules: load guard and checked writes
**Do:** Add `useToast` + `fail`; render `{toastNode}` as the last child in both returns. In `fetchAll` (line 57) read the four `error`s;
if any is set: `fail('Could not load reservation config.', error)`, `setLoadError(true)`, `setLoading(false)`, `return` (new `useState(false)`). When `loadError`,
render `AdminPage` (same title/subtitle/headerGap) with "Could not load reservation config. Reload the page to try again." and no `actions` (no Save All). In `saveAll`
(line 83) destructure `error` from every call: the two `select('id')` lookups, then the slot_rules update/insert and the operating_hours update/insert; on any error
`fail('Could not save reservation config. Some days may not have been saved: reload and check.', error); return` before `flashSaved()`. In `addDateControl` (146),
`removeDateControl` (159), `addBlackoutDate` (164), `removeBlackoutDate` (176) check `error`; on error `fail(...)` and `return` without resetting the form fields or calling `fetchAll()`.
**Verify:** `npm run build`; `npm run lint` no new problems; `grep -n "await supabase" src/pages/admin/SlotRules.jsx` — every hit is `const { ... error ... } = await supabase`.

### T9 — Experiences: checked writes
**Do:** Add `useToast` + `fail`; render `{toastNode}` inside the `AdminPage` after the list. `fetchAll` (74): read the three `error`s, `fail('Could not load experiences.', ...)`
and still `setLoading(false)`. `handlePosterUpload` (94): in the `else` of `if (!error)` call `setPosterError('Poster upload failed. Try again.')` and `setPosterFileName(null)`.
`handleSave` (152): check the `update` (175-179) and the single `insert` (207-211); on error `fail('Could not save the experience.', error)`, `setSaving(false)`, `return` (form stays open).
The recurring-series branch already sets `seriesNotice` on error: leave that, but do not call `setShowForm(false)` when `error` is set. `handleDelete` (219): check the `table_blocks` delete and the `experiences` delete;
`fail('Could not delete the experience.', ...)` and return before `fetchAll`. `deleteRemainingOccurrences` (230): same for its `table_blocks` delete (254) and `experiences` delete (256).
`openRegistrations` (314): check the `select` error with `fail('Could not load registrations.', ...)`. `updateFutureOccurrences` already checks; leave it.
**Verify:** `npm run build`; `npm run lint` no new problems; `grep -n "await supabase" src/pages/admin/Experiences.jsx` — each write hit destructures `error`.

### T10 — Dashboard: past bookings still open
**Do:** In `Dashboard.jsx` add `pastOpen: 0` to the `stats` state. Add a fifth entry to the `Promise.all` in `fetchStats`:
`supabase.from('reservations').select('id', { count: 'exact', head: true }).in('status', ['confirmed', 'pending', 'seated']).lt('reservation_date', getLocalToday())`
and set `pastOpen: p.count || 0`. Above the stats grid render, only when `stats.pastOpen > 0`:
`<Link to="/admin/bookings?tab=past&date=all" className="block border rounded-xl p-4 mb-6 text-sm transition-opacity hover:opacity-80" style={{ borderColor: BRAND, color: BRAND }}>{stats.pastOpen} past booking{stats.pastOpen === 1 ? '' : 's'} still open. Close {stats.pastOpen === 1 ? 'it' : 'them'} out in Manage Bookings.</Link>`.
(`tab=past&date=all` are the existing `useUrlStateBatch` params in `Bookings.jsx:235`; `date=all` clears the date filter.) Do not store the count anywhere; no new colours.
**Verify:** `npm run build`; `npm run lint` no new problems; `grep -c "getLocalToday()" src/pages/admin/Dashboard.jsx` = 2.

## Verify (whole package)

- `npm run build` exit 0; `npm test` passes (new `tableLayoutRows.test.js` included).
- `npm run lint`: **no new problems**; expected final line `12 problems (9 errors, 3 warnings)`, down from `16 problems (11 errors, 5 warnings)`.
  If a package merged first changed the baseline, the expectation is baseline minus 4 (2 errors, 2 warnings), and none of the 08 files appear in the output.
- Invariant greps (CLAUDE.md): `grep -rnE "toISOString\(\)\.slice\(0, ?10\)" src` empty; `grep -rn "day_type === 'public_holiday'" src` empty;
  `grep -rnE "= any\(v_hours\.closed_days\)" supabase/migrations` has only the historical hit in `20260917200400_get_availability.sql` (superseded), nothing new.
- Owner smoke on a Vercel preview after merge (builders do not touch the live DB): Edit Layout, drag a table, Save shows "Saved!" and the layout persists after reload; turn the network off and Save shows the error toast, not "Saved!";
  Dashboard shows "6 past bookings still open" and the link opens Past; Slot Rules and Settings Save All still flash saved.

## Out of scope

- Any SQL or migration; the 6 stale bookings are closed by staff in admin, the expired locks by `docs/build/2026-10-17-cleanup.sql`.
- `Bookings.jsx` behaviour (load window, "Load older", cancel/no-show lock release): package 07. Note for Perng: with 07's 60-day window, past-open bookings older than 60 days need "Load older" to be found from the Dashboard link.
- Dashboard `head: true` for the four existing count queries (they still fetch up to 1000 ids each), error handling on the existing four counts.
- admin/Feedback toast on `markRedeemed` failure or load failure (plan covers lint only).
- Unique `table_number`, `reservations` indexes (package 03). Realtime changes. Moving `ExperienceRow` out of `Experiences` render.
- Lint problems in `ExperienceDetail.jsx`, `Feedback.jsx` (public), `ManageBooking.jsx`, `Reservations.jsx`: owned by 05/06.
