# Overnight run: 2026-10-17 → 18 (audit remediation)

Plan: `docs/build/2026-10-17-audit-plan.md`. Every package was built by a Sonnet builder and checked by me
(build / test / test:sql / lint / invariant greps). An independent Sonnet reviewer then checked each one,
and its accepted findings were fixed. **Nothing was merged, deployed or migrated.**

| # | Package | Status | PR | Review | Notes |
|---|---|---|---|---|---|
| Tonda 03 | Booking guards + PGlite SQL harness | PR open | tonda #9 | APPROVE | migration; also rejects >10 guests server-side (found while building) |
| Tonda 04 | Edge function hardening | PR open | tonda #12 (on #9) | fixed → green | migration; medium send-once bug fixed |
| Tonda 05 | Booking page uses `get_availability` | PR open | tonda #7 | APPROVE | stale-search race fixed |
| Tonda 06 | Public pages via RPCs | PR open | tonda #13 (on #9) | APPROVE | migration; 1 low fixed |
| Tonda 07 | Admin Round sign-in, `log_visit`, Bookings | PR open | tonda #11 | APPROVE | table release scoped to own locks (medium) |
| Tonda 08 | Admin reliability | PR open | tonda #10 | APPROVE | lint 16 → 12 |
| Tonda 09 | Public perf + polish | PR open | tonda #8 | APPROVE | entry JS 169 → 142 kB gz; images −180 kB |
| Tonda 10 | Tonda RLS lockdown | PR open | tonda #14 (on #9) | self-reviewed, tests mutation-checked | **MERGE LAST** |
| Round 04 | Shared customer RPCs + harness | PR open | round #9 | fixed → green | migration; HIGH voucher-minting hole fixed |
| Round 05 | Round app on RPCs, voucher email | PR open | round #10 | fixed → green | medium claim-release bug fixed |
| Round 06 | Shared tables lockdown | PR open | round #11 (on #9) | self-reviewed | **MERGE LAST** |
| docs | Briefs + plan | PR open | tonda #6, round #8 | — | briefs, plan, cleanup SQL |

Retries: no package hit the 3-retry cap. The Sonnet session limit cut off four agents once; all four
resumed cleanly.

## Merge and deploy order
1. Merge the docs PRs (tonda #6, round #8).
2. **Round 04** (round #9): confirm the schema assumptions (3 read-only queries in the brief), then `supabase db push`.
3. **Round 05** (round #10): deploy the site and `send-voucher-email`.
4. **Tonda 03** (#9) → `db push`. **Tonda 04** (#12) → `db push`, set `ROUND_SERVICE_ROLE_KEY`, deploy the 4 functions.
5. **Tonda 05** (#7), **06** (#13, `db push`), **07** (#11), **08** (#10), **09** (#8): deploy.
6. Create Round logins for Tonda staff; turn off public sign-ups on both projects.
7. **Tonda 10** (#14) → `db push`. **Round 06** (round #11) → `db push`. Then the anon-key curl checks in each PR.

Stacked PRs (#12, #13, #14 on #9; round #11 on round #9) retarget to `main` automatically when their base merges.

## Needs your decision
- Every decision marked **(Claude)** in the plan.
- The 9–10 pax / big-table approval rule (left unchanged). Note: the server now rejects 11+ guests outright.
- Whether a pending booking approved by staff should get a "confirmed" email (today it gets nothing).
- Secret names for Round's `send-voucher-email` (`ROUND_SUPABASE_*` vs `SUPABASE_*`; the function accepts either).

## Data cleanup (by hand)
`docs/build/2026-10-17-cleanup.sql`: 6 expired table locks (with a preview select), 6 past bookings still
open (close them out from the new Dashboard banner after #10), and 3 Round customers with counter drift.

## Follow-ups not built
- Port Tonda 03/05/06/10 to Round (Round's own `reservations` and config tables are still anon-open, and
  `cancel_reservation` on Round still accepts any id).
- Round `ManageBooking.jsx:80` still has the UTC `toISOString().split` date bug.
- Replace the PGlite stub schemas with `supabase db dump --schema-only` from both projects.
- Update the CLAUDE.md counters invariant in both repos after Tonda 07 / Round 05 merge.

## Test rows / leftovers
- No database rows created anywhere (no live DB access).
- Worktrees are kept for you under `.claude/worktrees/` in both repos (11 total). Run `worktree-cleanup` after merging.
- Tonda's gitignored `node_modules` has a stray `@electric-sql/pglite` from an early mis-directed install;
  `npm install` after merging #9 makes it legitimate (it becomes a devDependency).
- No dev servers were started.
