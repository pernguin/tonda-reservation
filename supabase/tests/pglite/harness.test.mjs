import assert from 'node:assert/strict'

export default async function ({ q }) {
  const procs = [
    'public.assign_tables(date,time,integer,integer)',
    'public.create_reservation_atomic(date,time,text,integer,uuid,text,integer,boolean)',
    'public.amend_reservation_atomic(uuid,date,time,integer,text,integer,boolean)',
    'public.get_availability(date,integer)',
    'public.notify_reservation_insert()',
  ]
  for (const p of procs) {
    const [row] = await q('select to_regprocedure($1) is not null as ok', [p])
    assert.equal(row.ok, true, `${p} should exist`)
  }

  const [j] = await q(`select '["Tuesday"]'::jsonb ? 'Tuesday' as ok`)
  assert.equal(j.ok, true)

  const [res] = await q(
    `select * from public.create_reservation_atomic('2030-01-07','19:00','weekday',2,null,null,0,false)`
  )
  assert.equal(res.status, 'confirmed')
  assert.equal(res.table_type, 'small')
  assert.ok(res.table_ids)

  const [ph] = await q(`select to_regclass('public.public_holidays') is not null as ok`)
  assert.equal(ph.ok, true)
}
