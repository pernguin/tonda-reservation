import assert from 'node:assert/strict'

export default async function ({ db, q }) {
  // (1) definer + search_path
  for (const fn of ['notify_reservation_insert', 'notify_reservation_completed']) {
    const [p] = await q(`select prosecdef, proconfig from pg_proc where proname = $1`, [fn])
    assert.equal(p.prosecdef, true, `${fn} security definer`)
    assert.ok(p.proconfig.includes('search_path=public, vault, pg_temp'), `${fn} search_path: ${p.proconfig}`)
  }

  // the live triggers are in no migration: create them locally (rolled back with the test)
  await db.exec(`
    create trigger on_reservation_insert after insert on public.reservations
      for each row execute function public.notify_reservation_insert();
    create trigger on_reservation_completed after update on public.reservations
      for each row execute function public.notify_reservation_completed();
    insert into vault.decrypted_secrets values ('tonda_service_role_key', 'k');
  `)

  // (2) happy path
  const [r] = await q(
    `insert into public.reservations (reservation_date, reservation_time, guest_count) values ('2030-01-07','19:00',2) returning id`
  )
  let calls = await q(`select url, headers from net.http_calls where url not like '%notify-staff%' order by id`)
  assert.equal(calls.length, 1)
  assert.ok(calls[0].url.endsWith('/send-confirmation-email'))
  assert.equal(calls[0].headers.Authorization, 'Bearer k')

  await db.query(`update public.reservations set status = 'completed' where id = $1`, [r.id])
  calls = await q(`select url from net.http_calls where url not like '%notify-staff%' order by id`)
  assert.equal(calls.length, 2)
  assert.ok(calls[1].url.endsWith('/send-thankyou-email'))

  await db.query(`update public.reservations set notes = 'x' where id = $1`, [r.id])
  calls = await q(`select url from net.http_calls where url not like '%notify-staff%'`)
  assert.equal(calls.length, 2)

  // (3) vault key missing: booking succeeds, no call
  await db.exec(`delete from vault.decrypted_secrets; delete from net.http_calls;`)
  await db.query(
    `insert into public.reservations (reservation_date, reservation_time, guest_count) values ('2030-01-07','19:00',2)`
  )
  assert.equal((await q(`select count(*)::int n from net.http_calls`))[0].n, 0)

  // (4) http_post blows up: booking and status update still succeed
  await db.exec(`
    insert into vault.decrypted_secrets values ('tonda_service_role_key', 'k');
    create or replace function net.http_post(
      url text, body jsonb default '{}', params jsonb default '{}',
      headers jsonb default '{"Content-Type":"application/json"}', timeout_milliseconds integer default 5000
    ) returns bigint language plpgsql as $f$ begin raise exception 'boom'; end; $f$;
  `)
  const [r2] = await q(
    `insert into public.reservations (reservation_date, reservation_time, guest_count) values ('2030-01-07','19:00',2) returning id`
  )
  assert.ok(r2.id)
  await db.query(`update public.reservations set status = 'completed' where id = $1`, [r2.id])
  const [s] = await q(`select status from public.reservations where id = $1`, [r2.id])
  assert.equal(s.status, 'completed')
}
