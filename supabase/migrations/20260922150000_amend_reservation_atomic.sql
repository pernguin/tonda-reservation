-- amend_reservation_atomic: let admin staff change an existing booking's date, time,
-- guest count and details in one transaction.
--
-- assign_tables is revoked from anon/authenticated (see 20260914090000), so the client
-- cannot re-assign tables itself after a move. This SECURITY DEFINER function is the
-- only supported way to amend a booking.
--
-- Differences from create_reservation_atomic, on purpose:
--  * No slot-rule time validation. Staff take bookings off the published grid
--    (a guest who wants 19:15), which the public form must never allow but staff must.
--  * Capacity shortfall does not raise. The amendment is saved and the booking is
--    flagged needs_manual_assignment, so staff can seat it by hand -- the same amber
--    "Needs Table" badge the bookings list already shows. Refusing mid-conversation
--    would be worse than flagging.
--  * Closed dates and max_pax still raise. Moving a booking onto a closed date is
--    almost always a mistake, and the override path (blocked_dates) already exists.

create or replace function public.amend_reservation_atomic(
  p_id uuid,
  p_reservation_date date,
  p_reservation_time time,
  p_guest_count integer,
  p_notes text default null,
  p_baby_chairs integer default 0,
  p_pets boolean default false
)
returns public.reservations
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_reservation public.reservations;
  v_blocked record;
  v_hours record;
  v_slot_rule record;
  v_day_type text;
  v_day_name text;
  v_duration_minutes integer;
  v_table_ids uuid[];
  v_flagged boolean;
  v_old_table_ids uuid[];
begin
  select * into v_reservation from reservations where id = p_id for update;
  if not found then
    raise exception 'not_found: That booking no longer exists.';
  end if;
  if v_reservation.status = 'cancelled' then
    raise exception 'cancelled: A cancelled booking cannot be amended.';
  end if;
  if v_reservation.reservation_date < (now() at time zone 'Asia/Kuala_Lumpur')::date then
    raise exception 'past_booking: A booking in the past cannot be amended.';
  end if;
  if p_reservation_date < (now() at time zone 'Asia/Kuala_Lumpur')::date then
    raise exception 'past_date: A booking cannot be moved into the past.';
  end if;
  if p_guest_count < 1 then
    raise exception 'invalid_guest_count: Guest count must be at least 1.';
  end if;

  -- Tonda's weekend is Friday/Saturday (dow 5,6), not Round's Sat/Sun -- these
  -- migrations are deliberately not copies of each other.
  v_day_type := case when extract(dow from p_reservation_date)::int in (5, 6)
                then 'weekend' else 'weekday' end;
  v_day_name := case extract(dow from p_reservation_date)::int
    when 0 then 'Sunday' when 1 then 'Monday' when 2 then 'Tuesday'
    when 3 then 'Wednesday' when 4 then 'Thursday' when 5 then 'Friday'
    else 'Saturday' end;

  select * into v_blocked from blocked_dates where blocked_date = p_reservation_date;
  if v_blocked.is_closed then
    raise exception 'date_closed: Sorry, reservations are not available on that date.';
  end if;
  if v_blocked.max_pax is not null and p_guest_count > v_blocked.max_pax then
    raise exception 'max_pax_exceeded: Only % guests can be accommodated on that date.', v_blocked.max_pax;
  end if;

  select * into v_hours from operating_hours where day_type = v_day_type;
  -- Tonda's operating_hours.closed_days is jsonb (Round's is text[]): use the ? operator.
  if v_hours.closed_days is not null and v_hours.closed_days ? v_day_name then
    raise exception 'date_closed: We are closed on %.', v_day_name;
  end if;

  select * into v_slot_rule from slot_rules where day_type = v_day_type;
  v_duration_minutes := coalesce(v_slot_rule.hold_duration_minutes, 120);

  perform pg_advisory_xact_lock(hashtext(p_reservation_date::text));

  -- Release the old tables BEFORE re-assigning, so a booking moved within the same
  -- service doesn't lose to its own previous hold.
  if v_reservation.table_ids is not null and jsonb_typeof(v_reservation.table_ids) = 'array' then
    select array_agg(t::uuid) into v_old_table_ids
    from jsonb_array_elements_text(v_reservation.table_ids) t;
  end if;
  if v_old_table_ids is not null then
    update restaurant_tables
       set locked_until = null, locked_by_reservation = null
     where id = any(v_old_table_ids)
       and locked_by_reservation = v_reservation.id;
  end if;

  select a.table_ids, a.flagged into v_table_ids, v_flagged
  from public.assign_tables(p_reservation_date, p_reservation_time, p_guest_count, v_duration_minutes) a;

  update reservations
     set reservation_date = p_reservation_date,
         reservation_time = p_reservation_time,
         guest_count = p_guest_count,
         notes = p_notes,
         baby_chairs = coalesce(p_baby_chairs, 0),
         pets = coalesce(p_pets, false),
         table_ids = case when v_table_ids is null then null else to_jsonb(v_table_ids) end,
         needs_manual_assignment = (v_table_ids is null) or coalesce(v_flagged, false)
   where id = p_id
   returning * into v_reservation;

  if v_table_ids is not null then
    update restaurant_tables
       set locked_until = ((p_reservation_date + p_reservation_time) at time zone 'Asia/Kuala_Lumpur')
                          + make_interval(mins => v_duration_minutes),
           locked_by_reservation = v_reservation.id
     where id = any(v_table_ids);
  end if;

  return v_reservation;
end;
$function$;

-- Staff-only: the public booking form has no reason to call this.
revoke execute on function public.amend_reservation_atomic(uuid, date, time, integer, text, integer, boolean) from public, anon;
grant execute on function public.amend_reservation_atomic(uuid, date, time, integer, text, integer, boolean) to authenticated;
