import assert from 'node:assert/strict'

const MIGRATION = '20261017100100_email_send_once.sql'

export default async function ({ db, q, readMigration }) {
  const cols = await q(
    `select column_name, data_type, is_nullable from information_schema.columns
     where table_schema = 'public' and table_name = 'reservations'
       and column_name in ('confirmation_sent_at', 'thankyou_sent_at')
     order by column_name`
  )
  assert.equal(cols.length, 2)
  for (const c of cols) {
    assert.equal(c.data_type, 'timestamp with time zone')
    assert.equal(c.is_nullable, 'YES')
  }

  const [r] = await q(
    `insert into public.reservations (reservation_date, reservation_time, guest_count)
     values ('2030-01-07', '19:00', 2) returning id`
  )

  for (const col of ['confirmation_sent_at', 'thankyou_sent_at']) {
    const claim = `update public.reservations set ${col} = now() where id = $1 and ${col} is null returning id`
    assert.equal((await q(claim, [r.id])).length, 1, `${col}: first claim wins`)
    assert.equal((await q(claim, [r.id])).length, 0, `${col}: second claim loses`)
    await db.query(`update public.reservations set ${col} = null where id = $1`, [r.id])
    assert.equal((await q(claim, [r.id])).length, 1, `${col}: claim works again after clear`)
  }

  // idempotent
  await db.exec(await readMigration(MIGRATION))
}
