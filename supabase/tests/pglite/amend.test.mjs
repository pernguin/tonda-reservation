import assert from 'node:assert/strict'

const AMEND = `select * from public.amend_reservation_atomic($1,$2,$3,$4,$5)`

export default async function ({ db, q, expectError }) {
  // only T1 left
  await db.exec(`update public.restaurant_tables set is_bookable = false where table_number in ('T2','T3','BT')`)
  const [t1] = await q(`select id from public.restaurant_tables where table_number = 'T1'`)

  const [created] = await q(
    `select * from public.create_reservation_atomic('2030-01-07','19:00','weekday',2,null,null,0,false)`
  )
  assert.deepEqual(created.table_ids, [t1.id])
  const id = created.id

  // (1) move within the same service keeps its own table
  const [moved] = await q(AMEND, [id, '2030-01-07', '19:30', 2, null])
  assert.deepEqual(moved.table_ids, [t1.id])
  assert.equal(moved.needs_manual_assignment, false)

  // (2) table_type / tables_count follow the guest count
  const [big] = await q(AMEND, [id, '2030-01-07', '19:30', 7, null])
  assert.equal(big.table_type, 'big')
  assert.equal(big.tables_count, 1)
  const [small] = await q(AMEND, [id, '2030-01-07', '19:30', 2, null])
  assert.equal(small.table_type, 'small')
  assert.equal(small.tables_count, 1)

  // (3) status gate
  for (const [status, pattern] of [
    ['completed', /^not_amendable/],
    ['no_show', /^not_amendable/],
    ['cancelled', /^cancelled/],
  ]) {
    await db.exec(`update public.reservations set status = '${status}' where id = '${id}'`)
    await expectError(AMEND, [id, '2030-01-07', '19:30', 2, null], pattern)
  }
  for (const status of ['seated', 'pending']) {
    await db.exec(`update public.reservations set status = '${status}' where id = '${id}'`)
    const [ok] = await q(AMEND, [id, '2030-01-07', '19:30', 2, null])
    assert.equal(ok.status, status)
  }
  await db.exec(`update public.reservations set status = 'confirmed' where id = '${id}'`)

  // (4) reminder_sent resets only when date or time changes
  await db.exec(`update public.reservations set reminder_sent = true where id = '${id}'`)
  const [notesOnly] = await q(AMEND, [id, '2030-01-07', '19:30', 2, 'window seat'])
  assert.equal(notesOnly.reminder_sent, true)
  const [timeMoved] = await q(AMEND, [id, '2030-01-07', '19:00', 2, 'window seat'])
  assert.equal(timeMoved.reminder_sent, false)
  await db.exec(`update public.reservations set reminder_sent = true where id = '${id}'`)
  const [dateMoved] = await q(AMEND, [id, '2030-01-14', '19:00', 2, 'window seat'])
  assert.equal(dateMoved.reminder_sent, false)

  // (5) validation
  await expectError(AMEND, [id, '2030-01-14', '19:00', 0, null], /^invalid_guest_count/)
  await expectError(AMEND, [id, '2020-01-06', '19:00', 2, null], /^past_date/)
  await expectError(
    AMEND,
    ['00000000-0000-4000-8000-000000000000', '2030-01-14', '19:00', 2, null],
    /^not_found/
  )
}
