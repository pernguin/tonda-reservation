# 13 — SQL tests run on the live schema (Round + Tonda)

The PGlite SQL tests (`npm run test:sql`) used to start from a hand-written `stub-schema.sql` and replay
every migration on top. The stub drifted from live: it had no NOT NULL or foreign keys, and none of the live
triggers that no migration creates (`on_reservation_insert`, `on_reservation_completed`), so tests created
them by hand. After this package the tests start from the real schema.
Decided with Perng 2026-10-22: live schema plus newer migrations; schema built from catalog queries (no Docker).

## How it works

- `supabase/tests/pglite/platform-shim.sql`: what Supabase provides outside `public` (roles `anon` /
  `authenticated` / `service_role`, default privileges, `vault`, `net.http_post` recording into
  `net.http_calls`, `cron`, the `supabase_realtime` publication). Identical on both sites.
- `supabase/tests/pglite/live-schema.sql`: generated, never hand-edited. Tables, constraints, indexes,
  functions, triggers, RLS policies, grants to the API roles, publication membership and cron jobs of the
  live `public` schema. Its `-- migrations-through:` line is the newest version in
  `supabase_migrations.schema_migrations` when it was taken.
- `run.mjs`: loads the shim, then the live schema, then applies only migrations newer than
  `migrations-through` (the ones about to be pushed). A failing migration still fails the run.
- `npm run test:sql:dump` (`dump-live-schema.mjs` + `dump-live-schema.sql`): regenerates
  `live-schema.sql` with read-only catalog queries through `supabase db query --linked`. Identical on
  both sites.

## Refreshing

After every `supabase db push`, run `npm run test:sql:dump` and commit `live-schema.sql`. Until then the
pushed migrations are simply re-applied on top of the old snapshot, as before.

## Test changes the real schema forced

- Trigger tests no longer create `on_reservation_insert` / `on_reservation_completed` (they exist live).
- Approval tests count only calls with `event = 'approved'` (the live insert trigger posts too).
- Seed rows fill the live NOT NULL columns and point foreign keys at real rows.
- Tonda: anon writes to `restaurant_tables` are refused by a revoked grant before RLS, so that check
  accepts either error.
- Round: the "invalid restaurant" feedback case skips seeding a visit (live check constraint), and the
  "coalesces null baby_chairs and pets" case is removed: both columns are NOT NULL live.
