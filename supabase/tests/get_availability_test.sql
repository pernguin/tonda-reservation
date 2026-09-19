begin;

-- The `supabase db query` CLI does not surface RAISE NOTICE output, so per the same
-- fallback used in Round's get_availability_test.sql we record pass/fail into a temp
-- table and select it before rollback instead.
create temp table results (label text);

-- Pin weekday's operating_hours/slot_rules to one deterministic session (a single
-- row update per table, not touching restaurant_tables at all) so slot generation
-- doesn't depend on live config. Rolled back at the end. 2030-01-07 is a Monday
-- (weekday for Tonda, whose weekend is Fri/Sat, and not in public_holidays).
update public.operating_hours
   set closed_days = '[]'::jsonb, sessions = '[{"label":"Dinner","start":"18:00","end":"20:00","last_booking":"19:00"}]'::jsonb
 where day_type = 'weekday';
insert into public.operating_hours (day_type, is_closed, closed_days, sessions)
  select 'weekday', false, '[]'::jsonb, '[{"label":"Dinner","start":"18:00","end":"20:00","last_booking":"19:00"}]'::jsonb
  where not exists (select 1 from public.operating_hours where day_type = 'weekday');

update public.slot_rules
   set rule_type = 'open', hold_duration_minutes = 120
 where day_type = 'weekday';
insert into public.slot_rules (day_type, rule_type, sessions, hold_duration_minutes)
  select 'weekday', 'open', '[]'::jsonb, 120
  where not exists (select 1 from public.slot_rules where day_type = 'weekday');

-- restaurant_tables is left untouched -- an unscoped `update ... set is_bookable =
-- false` would row-lock every real table for the whole transaction, which could
-- block concurrent reservation writes (assign_tables updates
-- locked_until/locked_by_reservation on those same rows) for as long as this test
-- runs (same reasoning as Round's fixup commit 138a2eb). Instead this test reads the
-- *live* small-table capacity and asserts the delta a fixture reservation makes.
do $$
declare
  v_total_small_capacity int;
  v_fixture_guests int;
  n int;
begin
  select coalesce(sum(capacity), 0) into v_total_small_capacity
  from public.restaurant_tables
  where is_bookable = true and table_number <> 'BT' and capacity >= 2;

  if v_total_small_capacity < 3 then
    raise exception 'fixture assumption violated: live small-table capacity too low to test (%)', v_total_small_capacity;
  end if;

  -- T1: baseline -- an empty day yields exactly 3 half-hour pills (18:00, 18:30,
  -- 19:00) for a 2-guest party.
  select count(*) into n from public.get_availability(date '2030-01-07', 2);
  if n <> 3 then
    raise exception 'T1 expected 3 slots for an empty day, got %', n;
  end if;
  insert into results values ('T1 empty-day slot count: passed');

  -- T2: book all but 2 seats of the live small-table capacity at 18:00 for 120
  -- minutes. That reservation's window overlaps every one of the three candidate
  -- slots (18:00/18:30/19:00), so a 2-guest party (fits in the 2 seats left) still
  -- sees all 3 slots, but a 3-guest party (does not fit) sees none -- asserting the
  -- overlapping slots' capacity actually dropped, without touching a real
  -- restaurant_tables row.
  v_fixture_guests := v_total_small_capacity - 2;
  insert into public.reservations (customer_id, reservation_date, reservation_time, guest_count, status, table_type, tables_count)
  values (null, date '2030-01-07', time '18:00', v_fixture_guests, 'confirmed', 'small', 1);

  select count(*) into n from public.get_availability(date '2030-01-07', 2);
  if n <> 3 then
    raise exception 'T2a expected the 2-guest party to still fit all 3 overlapping slots, got %', n;
  end if;

  select count(*) into n from public.get_availability(date '2030-01-07', 3);
  if n <> 0 then
    raise exception 'T2b expected the overlapping slots to drop out for a 3-guest party, got %', n;
  end if;

  insert into results values ('T2 overlap drops capacity: passed');
end;
$$;

-- PH: a public_holidays row for the fixture date no longer overrides day_type --
-- get_availability keeps applying weekday config (the override was removed
-- 2026-09-18, see 20260918100000_get_availability_no_ph.sql).
insert into public.public_holidays (holiday_date, name)
values (date '2030-01-07', 'Test Fixture Holiday');

do $$
declare n int;
begin
  select count(*) into n from public.get_availability(date '2030-01-07', 2);
  if n < 1 then
    raise exception 'PH expected weekday config to still apply on a public_holidays date, got %', n;
  end if;

  insert into results values ('PH date returns weekday slots: passed');
end;
$$;

-- T3: a blocked_dates row with is_closed=true yields no slots at all, regardless of
-- guest count or remaining capacity.
insert into public.blocked_dates (blocked_date, is_closed, date_type)
values (date '2030-01-07', true, 'closed');

do $$
declare n int;
begin
  select count(*) into n from public.get_availability(date '2030-01-07', 2);
  if n <> 0 then
    raise exception 'T3 expected 0 slots for a blocked_dates closed date, got %', n;
  end if;

  insert into results values ('T3 blocked_dates closed -> no slots: passed');
end;
$$;

select jsonb_build_object(
  'results', (select jsonb_agg(label) from results)
) as summary;

rollback;
