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
    insert into public.reservations (status, reservation_date) values ('confirmed', '2030-01-07');
    insert into public.settings (key, value) values
      ('confirmation_message_event', 'hello'), ('staff_alert_email', 'staff@example.com')
      on conflict (key) do update set value = excluded.value;
    insert into public.events (event_type) values ('seed');
    insert into public.offsite_bookings (event_type) values ('seed');
    insert into public.experience_registrations (name) values ('seed');
    insert into public.operating_hours (day_type) values ('seedday');
    insert into public.slot_rules (day_type) values ('seedday');
    insert into public.blocked_dates (blocked_date) values ('2030-02-01');
    insert into public.blackout_dates (block_date) values ('2030-02-02');
    insert into public.experiences (name) values ('seed');
    insert into public.public_holidays (holiday_date, name) values ('2030-03-01', 'Seed') on conflict do nothing;
    insert into public.restaurant_tables (table_number) values ('SEED');
    insert into public.table_blocks (table_id) values (gen_random_uuid());
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
}