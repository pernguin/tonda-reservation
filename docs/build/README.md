# Build packages

| # | Package | Status |
|---|---------|--------|
| 01 | [Ops tweaks port (from Round package 01)](01-ops-tweaks-port.md) | done (PR #3, migrated 2026-09-19) |
| 02 | [Guest tags port (from Round packages 02 + 03)](02-guest-tags-port.md) | done (PR #4, smoke-tested 2026-09-24) |
| 03 | [Booking guards: server-side day type, guest/date/cutoff checks, amend fixes, PGlite SQL harness](03-booking-guards.md) | done (PR #9, merged 2026-10-17) |
| 04 | [Edge function hardening: auth, escaping, send-once emails, reminder fixes](04-edge-function-hardening.md) | done (PR #12, merged 2026-10-17) |
| 05 | [Booking page uses server get_availability](05-server-availability.md) | done (PR #7, merged 2026-10-17) |
| 06 | [Public pages via RPCs: manage booking, feedback, prefill, find-or-create](06-public-pages-rpcs.md) | done (PR #15 migration + PR #13, merged 2026-10-17/18) |
| 07 | [Admin Round sign-in, log_visit counters, Bookings fixes](07-admin-round-auth-and-visits.md) | done (PR #11, merged 2026-10-17) |
| 08 | [Admin reliability: error toasts, batched saves, stale-booking count](08-admin-reliability.md) | done (PR #10, merged 2026-10-17) |
| 09 | [Public performance and polish: lazy admin, fonts, WebP, cache headers](09-public-perf-and-polish.md) | done (PR #8, merged 2026-10-17) |
| 10 | [Tonda RLS lockdown (MERGE LAST)](10-tonda-lockdown.md) | done (PR #14, merged 2026-10-17) |
| 11 | [Staff-approved bookings get the Confirmed email](11-approval-confirmed-email.md) | done (PR #19, migrated + deployed + smoke-tested 2026-10-22) |
| 12 | [Booking success page matches the booking's status](12-status-aware-booking-success.md) | done (PR #21, smoke-tested live 2026-10-22) |

Plan and merge order for 03–10: [2026-10-17-audit-plan.md](2026-10-17-audit-plan.md).

## Rules for every package
- Branch per package: `build/NN-short-name`.
- The harness verify command must pass before you say it is done.
- Do not touch files the brief does not name. If you believe you must, say so first.
- If the brief is wrong about the code, stop and report it. Do not work around it.
- Read `CLAUDE.md` at the repo root first — it holds the architecture invariants.
