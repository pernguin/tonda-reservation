# Admin Shell Port (Tonda) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Port Round's admin-shell slice (spec `round-reservation/docs/superpowers/specs/2026-09-15-admin-shell-design.md`, merged at Round `fefc107`) to Tonda: shared components/hooks, responsive nav + padding, URL-persisted list state, no visual change otherwise.

**Reference (read-only):** `C:\Users\Perng\projects\round-reservation` at `fefc107` — `src/components/admin/*`, `src/lib/{adminTheme,useToast,useSavedFlash,useUrlState}.js` (+tests), and the converted pages `src/pages/admin/{Dashboard,Settings,SlotRules,Experiences,Login,Bookings,Customers,Tables}.jsx`, `src/components/{AdminNav,NewBookingAlert}.jsx`.

## Global Constraints
- Tonda deltas: `BRAND = '#E8420A'` (CREAM/SUCCESS as Round); AdminNav keeps the external Feedback `<a>`; Bookings/Customers/Tables keep the two-step `supabaseCustomers` join and `'tonda'` visit tag; Tonda has **no** `src/pages/admin/Feedback.jsx` — skip it. Tonda's Bookings already counts filtered lists (keep that behaviour; Round's `renderTab` reuse pattern is fine).
- No visual change except `p-4 md:p-8` and the nav. Reviewers compare rendered class strings against the removed lines.
- Lint: no new vs Tonda baseline **10 errors / 4 warnings**; `npm test` 33 + 11 new = 44; build.
- Commit trailers:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01N83egENk7MybAxTgY6LhEx
  ```

### Task 1: Building blocks (copy)
Copy verbatim from Round: `src/components/admin/{AdminPage,StatusBadge,StatusBadge.test.js,SaveButton,TabBar,FilterBar,States}.jsx`, `src/lib/{useToast,useSavedFlash,useUrlState,useUrlState.test.js}.js`. Create `src/lib/adminTheme.js` with `BRAND = '#E8420A'`, `CREAM = '#F0EBE1'`, `SUCCESS = '#16a34a'` (confirm Tonda Login's cream value — grep `CREAM` in Tonda Login.jsx and use Tonda's value). Gates. Commit "Port: admin shell building blocks".

### Task 2: Shell + simple pages + nav + alert
Dashboard, Settings, SlotRules, Experiences, Login adopt exactly as Round's converted versions (diff Round's page against Round's pre-change version `git -C <round> diff ce5140f..fefc107 -- src/pages/admin/<Page>.jsx` and apply the same edits to Tonda's page; keep Tonda brand strings/copy). `AdminNav`: Round's row classes + `shrink-0`, keep the external Feedback link, BRAND import. `NewBookingAlert`: BRAND import. Gates. Commit "Port: admin pages on shared shell; scrollable nav".

### Task 3: Bookings, Customers, Tables (URL state)
Apply Round's `ce5140f..fefc107` diffs for Bookings.jsx, Customers.jsx, Tables.jsx onto Tonda's versions: AdminPage/TabBar/FilterBar/StatusBadge/useToast/Loading/EmptyState; `useUrlStateBatch` with the same param names and semantics (Bookings `tab`/`date`/`status` with absent=today, `all`=cleared, `hasFilters = filterDate !== '' || !!filterStatus`; Customers `q` (debounced)/`letter`/six filter params; Tables `date` from the debounced setter). Keep Tonda's two-step joins and `'tonda'`. Bookings tab labels count the filtered lists (Tonda already did; make sure the hoisted lists are reused). Gates. Commit "Port: Bookings, Customers, Tables — shared shell + URL-persisted view".

### Task 4: Final review → merge → push.
