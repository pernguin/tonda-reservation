import assert from 'node:assert/strict'

const ID = '11111111-1111-1111-1111-111111111111'
const CUSTOMER = '22222222-2222-2222-2222-222222222222'

export default async function ({ q }) {
  await q(
    `insert into public.reservations
       (id, customer_id, reservation_date, reservation_time, guest_count, status, notes, baby_chairs, pets, table_ids)
     values ($1, $2, '2030-01-07', '19:00', 4, 'confirmed', 'window seat', 1, true, '["x"]'::jsonb)`,
    [ID, CUSTOMER]
  )

  // (a) values
  const rows = await q('select * from public.get_booking($1)', [ID])
  assert.equal(rows.length, 1)
  const row = rows[0]
  assert.equal(row.guest_count, 4)
  assert.equal(row.status, 'confirmed')
  assert.equal(row.notes, 'window seat')
  assert.equal(row.baby_chairs, 1)
  assert.equal(row.pets, true)
  assert.equal(row.customer_id, CUSTOMER)
  assert.match(String(row.reservation_time), /19:00/)
  assert.match(String(row.reservation_date instanceof Date ? row.reservation_date.toISOString() : row.reservation_date), /2030-01-07/)

  // (b) exact columns, nothing leaked
  assert.deepEqual(Object.keys(row), [
    'reservation_date', 'reservation_time', 'guest_count', 'status',
    'notes', 'baby_chairs', 'pets', 'customer_id',
  ])

  // (c) unknown id, (d) null
  assert.equal((await q('select * from public.get_booking($1)', ['33333333-3333-3333-3333-333333333333'])).length, 0)
  assert.equal((await q('select * from public.get_booking(null)')).length, 0)

  // (e) feedback_reservation
  const fb = await q('select * from public.feedback_reservation($1)', [ID])
  assert.equal(fb.length, 1)
  assert.deepEqual(Object.keys(fb[0]), ['customer_id', 'status'])
  assert.equal(fb[0].customer_id, CUSTOMER)
  assert.equal(fb[0].status, 'confirmed')
  assert.equal((await q('select * from public.feedback_reservation($1)', ['33333333-3333-3333-3333-333333333333'])).length, 0)

  // (f) privileges
  for (const fn of ['public.get_booking(uuid)', 'public.feedback_reservation(uuid)']) {
    for (const role of ['anon', 'authenticated']) {
      const [p] = await q('select has_function_privilege($1, $2, $3) as ok', [role, fn, 'execute'])
      assert.equal(p.ok, true, `${role} should execute ${fn}`)
    }
    await q('create role nogrant_probe nologin')
    const [n] = await q('select has_function_privilege($1, $2, $3) as ok', ['nogrant_probe', fn, 'execute'])
    assert.equal(n.ok, false, `a role without a grant must not execute ${fn}`)
    await q('drop role nogrant_probe')
  }
}
