import assert from 'node:assert/strict'

const MIGRATION = '20261017100300_tonda_rls_lockdown.sql'

export const LOCKED = [
  'reservations', 'table_groups', 'customers', 'restaurant_tables', 'table_blocks',
  'operating_hours', 'slot_rules', 'blocked_dates', 'blackout_dates', 'experiences', 'public_holidays',
  'settings', 'events', 'offsite_bookings', 'experience_registrations',
]

// Seed one row per locked table (as superuser), then simulate the live state with permissive legacy policies.
async function seedAndLegacy(db) {
  await db.exec(`
    insert into public.reservations (status, reservation_date, reservation_time, guest_count) values ('confirmed', '2030-01-07', '19:00', 2);
    insert into public.settings (key, value) values
      ('confirmation_message_event', 'hello'), ('staff_alert_email', 'staff@example.com')
      on conflict (key) do update set value = excluded.value;
    insert into public.events (event_type) values ('seed');
    insert into public.offsite_bookings (event_type) values ('seed');
    insert into public.experience_registrations (name, phone) values ('seed', '60100000000');
    insert into public.operating_hours (day_type) values ('seedday');
    insert into public.slot_rules (day_type) values ('seedday');
    insert into public.blocked_dates (blocked_date) values ('2030-02-01');
    insert into public.blackout_dates (block_date) values ('2030-02-02');
    insert into public.experiences (name, date, time) values ('seed', '2030-02-03', '19:00');
    insert into public.public_holidays (holiday_date, name) values ('2030-03-01', 'Seed') on conflict do nothing;
    insert into public.restaurant_tables (table_number) values ('SEED');
    insert into public.table_blocks (table_id, block_date, source_type) select id, '2030-02-04', 'manual' from public.restaurant_tables where table_number = 'SEED';
    insert into public.table_groups (id) values (gen_random_uuid());
    insert into public.customers (full_name) values ('seed');
    alter table public.reservations enable row level security;
    create policy "Allow public read" on public.reservations for select to anon using (true);
    create policy "Allow public insert" on public.events for insert to anon with check (true);
  `)
}

export default async function ({ db, q, expectError, readMigration }) {
  const asRole = async (role, fn) => {
    await db.exec(`set role ${role}`)
    try {
      return await fn()
    } finally {
      await db.exec('reset role')
    }
  }

  await seedAndLegacy(db)

  // Case: migration file exists and applies.
  await db.exec(await readMigration(MIGRATION))

  // T5: structure.
  const expected = {}
  for (const t of ['reservations', 'table_groups', 'customers', 'restaurant_tables', 'table_blocks']) expected[t] = ['staff_all']
  for (const t of ['operating_hours', 'slot_rules', 'blocked_dates', 'blackout_dates', 'experiences', 'public_holidays']) expected[t] = ['anon_select', 'staff_all']
  expected.settings = ['anon_select_confirmation_messages', 'staff_all']
  for (const t of ['events', 'offsite_bookings', 'experience_registrations']) expected[t] = ['anon_insert', 'staff_all']

  const assertStructure = async (label) => {
    const off = await q('select relname from pg_class where relname = any($1) and relkind = $2 and not relrowsecurity', [LOCKED, 'r'])
    assert.deepEqual(off, [], `${label}: tables without RLS`)
    const legacy = await q(`select count(*)::int as n from pg_policies where policyname in ('Allow public read', 'Allow public insert')`)
    assert.equal(legacy[0].n, 0, `${label}: legacy policies remain`)
    for (const t of LOCKED) {
      const rows = await q(`select policyname from pg_policies where schemaname = 'public' and tablename = $1 order by policyname`, [t])
      assert.deepEqual(rows.map((r) => r.policyname), expected[t], `${label}: policies on ${t}`)
    }
  }

  // The runner applied the migration before the legacy policies were created, so re-apply: it must drop them.
  await assertStructure('after second apply')
  await db.exec(await readMigration(MIGRATION))
  await assertStructure('after third apply (idempotent)')

  // T6: anon.
  const RLS = /row-level security/
  const count = async (t) => (await q(`select count(*)::int as n from public.${t}`))[0].n

  await asRole('anon', async () => {
    assert.equal(await count('reservations'), 0, 'anon cannot select reservations')
    await expectError(`insert into public.reservations (status, reservation_date, reservation_time, guest_count) values ('pending', '2030-01-07', '19:00', 2)`, [], RLS)
    assert.equal((await db.query(`update public.reservations set status = 'cancelled'`)).affectedRows, 0)
    assert.equal((await db.query(`delete from public.reservations`)).affectedRows, 0)

    await db.query(`insert into public.events (event_type) values ('birthday')`)
    await expectError(`insert into public.events (event_type) values ('x') returning id`, [], RLS)
    await db.query(`insert into public.offsite_bookings (event_type) values ('birthday')`)
    await db.query(`insert into public.experience_registrations (name, phone) values ('Test', '60100000000')`)

    for (const t of ['events', 'offsite_bookings', 'experience_registrations', 'restaurant_tables', 'table_blocks', 'table_groups', 'customers']) {
      assert.equal(await count(t), 0, `anon cannot select ${t}`)
    }

    const keys = (await q('select key from public.settings')).map((r) => r.key)
    assert.deepEqual(keys, ['confirmation_message_event'])

    for (const t of ['operating_hours', 'slot_rules', 'blocked_dates', 'blackout_dates', 'experiences', 'public_holidays']) {
      assert.ok((await count(t)) >= 1, `anon can read ${t}`)
    }
    await expectError(`insert into public.slot_rules (day_type) values ('x')`, [], RLS)
    // live also revokes anon's write grants here, so either guard may answer first
    await expectError(`insert into public.restaurant_tables (table_number) values ('X')`, [], /row-level security|permission denied/)
  })
  const [untouched] = await q(`select count(*)::int as n from public.reservations where status = 'confirmed' and reservation_date = '2030-01-07'`)
  assert.ok(untouched.n >= 1, 'seed reservation untouched by anon')

  const [claim] = await q(`select has_function_privilege('anon', 'public.claim_restaurant_tables(uuid[],uuid,timestamptz,timestamptz)', 'execute') as ok`)
  assert.equal(claim.ok, false, 'anon cannot execute claim_restaurant_tables')
  const [claimAuth] = await q(`select has_function_privilege('authenticated', 'public.claim_restaurant_tables(uuid[],uuid,timestamptz,timestamptz)', 'execute') as ok`)
  assert.equal(claimAuth.ok, true)

  // T7: authenticated and definer paths.
  await asRole('authenticated', async () => {
    assert.ok((await count('reservations')) >= 1)
    await db.query(`insert into public.reservations (status, reservation_date, reservation_time, guest_count) values ('pending', '2030-01-07', '19:00', 2)`)
    assert.ok((await db.query(`update public.reservations set status = 'cancelled' where status = 'pending'`)).affectedRows >= 1)
    assert.ok((await db.query(`delete from public.reservations where status = 'cancelled'`)).affectedRows >= 1)
    await db.query(`insert into public.restaurant_tables (table_number) values ('AUTH')`)
    assert.equal((await db.query(`update public.restaurant_tables set table_number = 'AUTH2' where table_number = 'AUTH'`)).affectedRows, 1)
    assert.equal((await db.query(`delete from public.restaurant_tables where table_number = 'AUTH2'`)).affectedRows, 1)
    const keys = (await q('select key from public.settings order by key')).map((r) => r.key)
    assert.ok(keys.includes('staff_alert_email') && keys.includes('confirmation_message_event'))
    assert.ok((await count('events')) >= 1)
  })

  await asRole('anon', async () => {
    const slots = await q(`select slot::text as slot from public.get_availability('2030-01-07', 2)`)
    assert.ok(slots.length > 0, 'get_availability returns slots for anon via definer')
    assert.equal(await count('reservations'), 0, 'anon still cannot read reservations directly')
  })
  const [seedRes] = await q(`select id from public.reservations where status = 'confirmed' and reservation_date = '2030-01-07' limit 1`)
  await asRole('anon', async () => {
    const [r] = await q('select public.cancel_reservation($1) as ok', [seedRes.id])
    assert.equal(r.ok, true, 'cancel_reservation works for anon via definer')
  })
}