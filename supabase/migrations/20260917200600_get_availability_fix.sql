-- Fix: Tonda's operating_hours.closed_days is jsonb (Round's is text[]); use the ? operator like
-- create_reservation_atomic does. Found on first prod run 2026-09-17.

-- get_availability: server-side slot search, mirroring the client math in
-- src/pages/Reservations.jsx:99-138 (getDateInfo, computeAvailability, getOpenSlots,
-- getFixedSlots) and the validation/assignment logic in create_reservation_atomic
-- (supabase/migrations/20260914170100_server_side_assignment.sql). Read-only: it
-- never inserts/locks, so it can be polled repeatedly (e.g. by a WhatsApp concierge
-- bot) without side effects.
--
-- day_type: Fri/Sat = 'weekend' (Tonda's weekend, per the package brief's External
-- facts — dow 5 = Friday, 6 = Saturday), else 'weekday'; overridden to
-- 'public_holiday' when p_date is present in public_holidays (see
-- 20260917200300_public_holidays.sql — currently seeded empty, Malaysia is not
-- covered by the nager.at API this table mirrors).
--
-- Thresholds (Tonda): guest_count 6-8 -> big table ('BT'), auto-confirm
-- (requires_approval false); >8 -> big table, requires_approval true; >10 -> party
-- too large, no slots at all. Otherwise: small tables, capacity =
-- sum(restaurant_tables.capacity) for bookable tables with capacity >= 2 excluding
-- table_number = 'BT', minus guest_count of confirming/pending/seated reservations
-- whose [reservation_time, reservation_time + hold_duration_minutes) window overlaps
-- the candidate slot's own window.
--
-- Tonda's own project has an unrelated table also called `customers` (per the
-- package brief) -- this function does not reference it.

create or replace function public.get_availability(p_date date, p_guest_count int)
returns table (slot time, day_type text, requires_approval boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_day_type text;
  v_day_name text;
  v_blocked record;
  v_hours record;
  v_slot_rule record;
  v_duration_minutes integer;
  v_total_small_capacity integer;
  v_session jsonb;
  v_candidate time;
  v_last time;
  v_cur_mins integer;
  v_last_mins integer;
  v_booking_start_mins integer;
  v_booking_end_mins integer;
  v_blackout record;
  v_window_start_mins integer;
  v_window_end_mins integer;
  v_is_blacked_out boolean;
  v_booked_small_seats integer;
  v_big_table_booked boolean;
begin
  if p_guest_count > 10 then
    return;
  end if;

  select * into v_blocked from blocked_dates where blocked_date = p_date;
  if v_blocked.is_closed then
    return;
  end if;
  if v_blocked.max_pax is not null and p_guest_count > v_blocked.max_pax then
    return;
  end if;

  v_day_name := case extract(dow from p_date)::int
    when 0 then 'Sunday' when 1 then 'Monday' when 2 then 'Tuesday'
    when 3 then 'Wednesday' when 4 then 'Thursday' when 5 then 'Friday'
    else 'Saturday' end;

  v_day_type := case when extract(dow from p_date)::int in (5, 6) then 'weekend' else 'weekday' end;
  if exists (select 1 from public_holidays where holiday_date = p_date) then
    v_day_type := 'public_holiday';
  end if;

  select * into v_hours from operating_hours where operating_hours.day_type = v_day_type;
  if v_hours.closed_days is not null and v_hours.closed_days ? v_day_name then
    return;
  end if;

  select * into v_slot_rule from slot_rules where slot_rules.day_type = v_day_type;
  v_duration_minutes := coalesce(v_slot_rule.hold_duration_minutes, 120);

  select coalesce(sum(capacity), 0) into v_total_small_capacity
  from restaurant_tables
  where is_bookable = true and table_number <> 'BT' and capacity >= 2;

  -- build the candidate slot list: 'session' rule_type -> one pill per session at
  -- its start time; otherwise ('open', or no slot_rule row) -> 30-min pills across
  -- each operating_hours session from start to (last_booking ?? end) inclusive.
  for v_session in
    select * from jsonb_array_elements(
      case when v_slot_rule.rule_type = 'session'
        then coalesce(v_slot_rule.sessions, '[]'::jsonb)
        else coalesce(v_hours.sessions, '[]'::jsonb)
      end
    )
  loop
    if v_slot_rule.rule_type = 'session' then
      v_candidate := (v_session->>'start')::time;
      v_last := v_candidate;
    else
      v_candidate := (v_session->>'start')::time;
      v_last := coalesce((v_session->>'last_booking')::time, (v_session->>'end')::time);
    end if;

    v_cur_mins := extract(hour from v_candidate)::int * 60 + extract(minute from v_candidate)::int;
    v_last_mins := extract(hour from v_last)::int * 60 + extract(minute from v_last)::int;

    while v_cur_mins <= v_last_mins loop
      v_candidate := make_time(v_cur_mins / 60, v_cur_mins % 60, 0);

      v_booking_start_mins := v_cur_mins;
      v_booking_end_mins := v_cur_mins + v_duration_minutes;

      -- blackout_dates: a row with both times null blacks out the whole date; a row
      -- with only one bound set treats the missing bound as the day's edge.
      v_is_blacked_out := false;
      for v_blackout in select * from blackout_dates where block_date = p_date loop
        if v_blackout.start_time is null and v_blackout.end_time is null then
          v_is_blacked_out := true;
        else
          v_window_start_mins := extract(hour from coalesce(v_blackout.start_time, '00:00'::time))::int * 60
            + extract(minute from coalesce(v_blackout.start_time, '00:00'::time))::int;
          v_window_end_mins := extract(hour from coalesce(v_blackout.end_time, '23:59'::time))::int * 60
            + extract(minute from coalesce(v_blackout.end_time, '23:59'::time))::int;
          if v_booking_start_mins < v_window_end_mins and v_booking_end_mins > v_window_start_mins then
            v_is_blacked_out := true;
          end if;
        end if;
        exit when v_is_blacked_out;
      end loop;

      if not v_is_blacked_out then
        select
          coalesce(sum(case when r.table_type is distinct from 'big' then r.guest_count else 0 end), 0),
          coalesce(bool_or(r.table_type = 'big'), false)
        into v_booked_small_seats, v_big_table_booked
        from reservations r
        where r.reservation_date = p_date
          and r.status in ('confirmed', 'pending', 'seated')
          and (extract(hour from r.reservation_time)::int * 60 + extract(minute from r.reservation_time)::int) < v_booking_end_mins
          and (extract(hour from r.reservation_time)::int * 60 + extract(minute from r.reservation_time)::int + v_duration_minutes) > v_booking_start_mins;

        if p_guest_count between 6 and 8 and not v_big_table_booked then
          slot := v_candidate; day_type := v_day_type; requires_approval := false;
          return next;
        elsif p_guest_count > 8 and not v_big_table_booked then
          slot := v_candidate; day_type := v_day_type; requires_approval := true;
          return next;
        elsif p_guest_count <= (v_total_small_capacity - v_booked_small_seats) then
          slot := v_candidate; day_type := v_day_type; requires_approval := false;
          return next;
        end if;
      end if;

      v_cur_mins := v_cur_mins + 30;
    end loop;
  end loop;

  return;
end;
$$;

grant execute on function public.get_availability(date, int) to anon, authenticated;
