import assert from 'node:assert/strict'

const AV = `select slot::text as slot, day_type, requires_approval from public.get_availability($1, $2) order by slot`

export default async function ({ db, q }) {
  const slots = async (date, guests) => (await q(AV, [date, guests])).map((r) => r.slot)

  assert.deepEqual(await slots('2030-01-07', 0), [])
  assert.deepEqual(await slots('2030-01-07', 2), ['18:00:00', '18:30:00', '19:00:00', '19:30:00'])

  // 8 small seats taken of capacity 10
  await db.exec(`insert into public.reservations (reservation_date, reservation_time, guest_count, status, table_type)
                 values ('2030-01-07', '18:00', 8, 'confirmed', 'small')`)
  assert.equal((await slots('2030-01-07', 2)).length, 4)
  assert.equal((await slots('2030-01-07', 3)).length, 0)
  await db.exec(`delete from public.reservations`)

  // partial blackout 18:00-19:00 (hold 120): only slots whose window starts at/after 19:00 survive
  await db.exec(`insert into public.blackout_dates (block_date, start_time, end_time) values ('2030-01-07','18:00','19:00')`)
  assert.deepEqual(await slots('2030-01-07', 2), ['19:00:00', '19:30:00'])
  await db.exec(`delete from public.blackout_dates`)

  // whole-day blackout
  await db.exec(`insert into public.blackout_dates (block_date, start_time, end_time) values ('2030-01-07',null,null)`)
  assert.deepEqual(await slots('2030-01-07', 2), [])
  await db.exec(`delete from public.blackout_dates`)

  // blocked date
  await db.exec(`insert into public.blocked_dates (blocked_date, is_closed) values ('2030-01-07', true)`)
  assert.deepEqual(await slots('2030-01-07', 2), [])
  await db.exec(`delete from public.blocked_dates`)

  // closed weekday
  await db.exec(`update public.operating_hours set closed_days = '["Tuesday"]'::jsonb where day_type = 'weekday'`)
  assert.deepEqual(await slots('2030-01-08', 2), [])
  await db.exec(`update public.operating_hours set closed_days = '[]'::jsonb where day_type = 'weekday'`)

  // Friday = weekend hours
  const fri = await q(AV, ['2030-01-11', 2])
  assert.deepEqual(fri.map((r) => r.slot), ['12:00:00', '12:30:00', '13:00:00', '13:30:00'])
  assert.ok(fri.every((r) => r.day_type === 'weekend'))

  const [v] = await q(`select provolatile from pg_proc where proname = 'get_availability'`)
  assert.equal(v.provolatile, 's')
}
