import assert from 'node:assert/strict'

const MIGRATION = '20261017100000_booking_guards.sql'

export default async function ({ db, q, expectError, readMigration }) {
  // (1) check constraint
  await expectError(
    `insert into public.reservations (reservation_date, reservation_time, guest_count) values ('2030-01-07','19:00',0)`,
    [],
    /violates check constraint/
  )
  const [con] = await q(`select convalidated from pg_constraint where conname = 'reservations_guest_count_positive'`)
  assert.equal(con.convalidated, true)

  // (2) unique table_number
  await expectError(
    `insert into public.restaurant_tables (table_number, capacity) values ('T1', 2)`,
    [],
    /unique|duplicate/i
  )

  // (3) index
  const idx = await q(`select 1 from pg_indexes where indexname = 'reservations_date_status_idx'`)
  assert.equal(idx.length, 1)

  // (4) cron jobs and purge behaviour
  const purge = await q(`select command from cron.job where jobname = 'purge-cron-run-details'`)
  assert.equal(purge.length, 1)
  assert.equal((await q(`select 1 from cron.job where jobname = 'send-reminder-email'`)).length, 1)
  await db.exec(`
    insert into cron.job_run_details (jobid, status, end_time) values
      (1, 'succeeded', now() - interval '20 days'),
      (1, 'succeeded', now() - interval '1 day');
  `)
  await db.exec(purge[0].command)
  const left = await q(`select end_time from cron.job_run_details`)
  assert.equal(left.length, 1)

  // (5) idempotence
  await db.exec(await readMigration(MIGRATION))
  assert.equal((await q(`select 1 from cron.job where jobname = 'purge-cron-run-details'`)).length, 1)
  assert.equal(
    (await q(`select 1 from pg_constraint where conname = 'reservations_guest_count_positive'`)).length,
    1
  )

  // (6) duplicate branch: no unique constraint is added
  await db.exec(`alter table public.restaurant_tables drop constraint restaurant_tables_table_number_key`)
  await db.exec(`insert into public.restaurant_tables (table_number, capacity) values ('T1', 2)`)
  await db.exec(await readMigration(MIGRATION))
  assert.equal(
    (await q(`select 1 from pg_constraint where conname = 'restaurant_tables_table_number_key'`)).length,
    0
  )
}
