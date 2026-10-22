import assert from 'node:assert/strict'

export default async function ({ db, q }) {
  // (1) definer + search_path
  const [p] = await q(`select prosecdef, proconfig from pg_proc where proname = 'notify_reservation_approved'`)
  assert.equal(p.prosecdef, true, 'security definer')
  assert.ok(p.proconfig.includes('search_path=public, vault, pg_temp'), `search_path: ${p.proconfig}`)

  // (5) column exists and is nullable
  const [col] = await q(
    `select data_type, is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'reservations' and column_name = 'approval_sent_at'`
  )
  assert.ok(col, 'approval_sent_at exists')
  assert.equal(col.is_nullable, 'YES')

  await db.exec(`insert into vault.decrypted_secrets values ('tonda_service_role_key', 'k');`)
  const calls = () => q(`select url, headers, body from net.http_calls where url not like '%notify-staff%' order by id`)
  const ins = (status) =>
    q(
      `insert into public.reservations (reservation_date, reservation_time, guest_count, status)
       values ('2030-01-07','19:00',2,$1) returning id`,
      [status]
    ).then((r) => r[0])

  // (3) no call for a booking inserted as confirmed (approval trigger is update-only)
  const c0 = await ins('confirmed')
  assert.equal((await calls()).length, 0)

  // (2) pending -> confirmed: exactly one approved call
  const pend = await ins('pending')
  await db.exec(`delete from net.http_calls`)
  await db.query(`update public.reservations set status = 'confirmed' where id = $1`, [pend.id])
  let c = await calls()
  assert.equal(c.length, 1)
  assert.ok(c[0].url.endsWith('/send-confirmation-email'))
  assert.equal(c[0].headers.Authorization, 'Bearer k')
  assert.equal(c[0].body.event, 'approved')
  assert.equal(c[0].body.record.id, pend.id)

  // (3) other transitions send nothing
  await db.exec(`delete from net.http_calls`)
  await db.query(`update public.reservations set notes = 'x' where id = $1`, [pend.id]) // confirmed -> confirmed
  await db.query(`update public.reservations set status = 'confirmed' where id = $1`, [c0.id]) // confirmed -> confirmed
  const p2 = await ins('pending')
  await db.exec(`delete from net.http_calls`)
  await db.query(`update public.reservations set status = 'cancelled' where id = $1`, [p2.id]) // pending -> cancelled
  await db.query(`update public.reservations set status = 'pending' where id = $1`, [pend.id]) // confirmed -> pending
  assert.equal((await calls()).length, 0)

  // (4) vault key missing: status update succeeds, no call
  const p3 = await ins('pending')
  await db.exec(`delete from net.http_calls; delete from vault.decrypted_secrets;`)
  await db.query(`update public.reservations set status = 'confirmed' where id = $1`, [p3.id])
  assert.equal((await calls()).length, 0)
  assert.equal((await q(`select status from public.reservations where id = $1`, [p3.id]))[0].status, 'confirmed')

  // (4) http_post raises: status update still succeeds
  await db.exec(`
    insert into vault.decrypted_secrets values ('tonda_service_role_key', 'k');
    create or replace function net.http_post(
      url text, body jsonb default '{}', params jsonb default '{}',
      headers jsonb default '{"Content-Type":"application/json"}', timeout_milliseconds integer default 5000
    ) returns bigint language plpgsql as $f$ begin raise exception 'boom'; end; $f$;
  `)
  const p4 = await ins('pending')
  await db.query(`update public.reservations set status = 'confirmed' where id = $1`, [p4.id])
  assert.equal((await q(`select status from public.reservations where id = $1`, [p4.id]))[0].status, 'confirmed')
}
