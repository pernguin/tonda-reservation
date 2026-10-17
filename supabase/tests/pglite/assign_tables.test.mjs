import assert from 'node:assert/strict'

export default async function ({ db, q }) {
  const [c] = await q(`select count(*)::int n from pg_proc where proname = 'assign_tables'`)
  assert.equal(c.n, 1)

  for (const role of ['anon', 'authenticated']) {
    const [p] = await q(
      `select has_function_privilege($1, 'public.assign_tables(date,time,integer,integer,uuid)', 'execute') as ok`,
      [role]
    )
    assert.equal(p.ok, false, `${role} must not execute assign_tables`)
  }

  await db.exec(`update public.restaurant_tables set is_bookable = false where table_number in ('T2','T3','BT')`)
  const [t1] = await q(`select id from public.restaurant_tables where table_number = 'T1'`)
  const [res] = await q(
    `insert into public.reservations (reservation_date, reservation_time, guest_count, status, table_ids)
     values ('2030-01-07', '19:00', 2, 'confirmed', jsonb_build_array($1::text)) returning id`,
    [t1.id]
  )

  const [own] = await q(`select * from public.assign_tables('2030-01-07','19:30',2,120)`)
  assert.equal(own.flagged, true)

  const [ex] = await q(`select * from public.assign_tables('2030-01-07','19:30',2,120,$1)`, [res.id])
  assert.equal(ex.flagged, false)
  assert.deepEqual(ex.table_ids, [t1.id])

  const [free] = await q(`select * from public.assign_tables('2030-01-07','12:00',2,120)`)
  assert.equal(free.flagged, false)
  assert.deepEqual(free.table_ids, [t1.id])
}
