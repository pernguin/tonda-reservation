// Shared seed, run inside each test's transaction.
// Fixed test dates (far future, so "past date" never trips):
//   Mon 2030-01-07 (weekday), Tue 2030-01-08, Fri 2030-01-11 (weekend: Tonda weekend = Fri/Sat).
export async function seed(db) {
  await db.exec(`
    insert into public.operating_hours (day_type, closed_days, sessions) values
      ('weekday', '[]'::jsonb,
       '[{"label":"Dinner","start":"18:00","end":"20:00","last_booking":"19:30"}]'::jsonb),
      ('weekend', '[]'::jsonb,
       '[{"label":"Lunch","start":"12:00","end":"14:00","last_booking":"13:30"}]'::jsonb);

    insert into public.slot_rules (day_type, rule_type, sessions, hold_duration_minutes) values
      ('weekday', 'open', '[]'::jsonb, 120),
      ('weekend', 'open', '[]'::jsonb, 120);

    insert into public.restaurant_tables (table_number, capacity, x_position, y_position, is_bookable) values
      ('T1', 2, 0, 0, true),
      ('T2', 4, 10, 0, true),
      ('T3', 4, 20, 0, true),
      ('BT', 8, 30, 0, true);
  `)
}
