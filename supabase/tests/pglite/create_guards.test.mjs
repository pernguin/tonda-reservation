import assert from 'node:assert/strict'

const CREATE = `select * from public.create_reservation_atomic($1,$2,$3,$4,null,null,0,false)`

export default async function ({ db, q, expectError }) {
  // guest count
  for (const n of [0, -1]) {
    await expectError(CREATE, ['2030-01-07', '19:00', 'weekday', n], /^invalid_guest_count/)
  }

  // past date
  await expectError(CREATE, ['2020-01-06', '19:00', 'weekday', 2], /^past_date/)

  // same-day lead time (KL clock)
  const [now] = await q(
    `select (now() at time zone 'Asia/Kuala_Lumpur')::date::text as d,
            extract(hour from (now() at time zone 'Asia/Kuala_Lumpur'))::int * 60
            + extract(minute from (now() at time zone 'Asia/Kuala_Lumpur'))::int as mins`
  )
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  if (now.mins + 10 < 24 * 60) {
    await expectError(CREATE, [now.d, hhmm(now.mins + 10), 'weekday', 2], /^time_passed/)
  }
  if (now.mins >= 5) {
    await expectError(CREATE, [now.d, hhmm(now.mins - 5), 'weekday', 2], /^time_passed/)
  }

  // Tuesday closed, even when the client claims 'weekend'
  await db.exec(`update public.operating_hours set closed_days = '["Tuesday"]'::jsonb where day_type = 'weekday'`)
  await expectError(CREATE, ['2030-01-08', '19:00', 'weekend', 2], /^date_closed: Sorry, we are closed on Tuesday\.$/)
  await db.exec(`update public.operating_hours set closed_days = '[]'::jsonb where day_type = 'weekday'`)

  // Friday uses weekend hours whatever the client says
  const [fri] = await q(CREATE, ['2030-01-11', '12:30', 'weekday', 2])
  assert.equal(fri.status, 'confirmed')
  await expectError(CREATE, ['2030-01-11', '19:00', 'weekend', 2], /^invalid_time_slot/)

  // size / approval paths unchanged (each case from a clean slate via savepoint)
  await db.exec('savepoint size_case')
  const [seven] = await q(CREATE, ['2030-01-07', '19:00', 'weekday', 7])
  assert.equal(seven.status, 'confirmed')
  assert.equal(seven.table_type, 'big')
  await db.exec('rollback to savepoint size_case')

  const [nine] = await q(CREATE, ['2030-01-07', '19:00', 'weekday', 9])
  assert.equal(nine.status, 'pending')
  assert.equal(nine.table_type, 'big')
  assert.equal(nine.tables_count, 1)
  await db.exec('rollback to savepoint size_case')

  // party_too_large only fires once the big table is taken (existing behaviour, out of scope):
  // 11 guests with no big table booked is accepted as a pending big-table request.
  await q(CREATE, ['2030-01-07', '19:00', 'weekday', 7])
  await expectError(CREATE, ['2030-01-07', '19:00', 'weekday', 11], /^party_too_large/)
}
