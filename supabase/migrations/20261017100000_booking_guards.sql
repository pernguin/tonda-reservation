-- Booking guards (package 03).
--
-- Server-side validation fixes for create_reservation_atomic, amend fixes, get_availability
-- hardening, trigger-function hardening, constraints/index and cron housekeeping.
-- NOT applied by the build; the owner runs `supabase db push` after reading this file top to bottom.
-- The two statements that touch existing objects: the first `drop function` and the
-- `validate constraint` block.
--
-- Source of each function body (copied verbatim, then edited as noted in place):
--   assign_tables                  20260914170100_server_side_assignment.sql  lines 8-133
--   create_reservation_atomic      20260914170100_server_side_assignment.sql  lines 139-270
--   amend_reservation_atomic       20260922150000_amend_reservation_atomic.sql lines 18-127 (+130-131)
--   get_availability               20260918100000_get_availability_no_ph.sql  lines 30-164 (+166)
--   notify_reservation_insert      20260813131000_vault_service_role_key.sql  lines 15-30
--   notify_reservation_completed   20260813131000_vault_service_role_key.sql  lines 32-49

-------------------------------------------------------------------------------
-- 1. assign_tables: new optional p_exclude_reservation_id so an amended booking
--    does not conflict with its own old row. The old 4-argument overload is dropped
--    (create or replace with a 5th argument would leave it behind, unrevoked).
-------------------------------------------------------------------------------
drop function if exists public.assign_tables(date, time, integer, integer);

create or replace function public.assign_tables(
  p_date date, p_time time, p_guest_count integer, p_hold_minutes integer,
  p_exclude_reservation_id uuid default null
)
returns table (table_ids uuid[], flagged boolean)
language plpgsql
as $$
declare
  v_start int := extract(hour from p_time)::int * 60 + extract(minute from p_time)::int;
  v_end   int := (extract(hour from p_time)::int * 60 + extract(minute from p_time)::int) + p_hold_minutes;
  v_ids  uuid[];  v_caps int[];  v_xs float8[];  v_ys float8[];
  v_n int;  i int;  j int;  k int;  l int;
  v_best uuid[];  v_best_score float8;  v_best_cap int;
  v_cap int;  v_score float8;
begin
  begin
    -- candidates: bookable tables not used by an overlapping active reservation on p_date
    with conflicting as (
      select distinct (jsonb_array_elements_text(r.table_ids))::uuid as id
      from public.reservations r
      where r.reservation_date = p_date
        and r.status in ('confirmed', 'pending', 'seated')
        and jsonb_typeof(r.table_ids) = 'array'
        and (p_exclude_reservation_id is null or r.id <> p_exclude_reservation_id)
        and (extract(hour from r.reservation_time)::int * 60 + extract(minute from r.reservation_time)::int) < v_end
        and (extract(hour from r.reservation_time)::int * 60 + extract(minute from r.reservation_time)::int) + p_hold_minutes > v_start
    ),
    cand as (
      select t.id, t.capacity, coalesce(t.x_position, 0)::float8 as x, coalesce(t.y_position, 0)::float8 as y
      from public.restaurant_tables t
      where t.is_bookable
        and t.capacity is not null
        and not exists (select 1 from conflicting c where c.id = t.id)
      order by coalesce(t.x_position, 0), t.id
    )
    select array_agg(c.id), array_agg(c.capacity), array_agg(c.x), array_agg(c.y)
      into v_ids, v_caps, v_xs, v_ys
    from cand c;

    v_n := coalesce(array_length(v_ids, 1), 0);
    if v_n = 0 then
      return query select null::uuid[], true; return;
    end if;

    -- single table: smallest sufficient capacity
    select array[t.id] into v_best
    from public.restaurant_tables t
    where t.id = any(v_ids) and t.capacity >= p_guest_count
    order by t.capacity, t.table_number, t.id
    limit 1;
    if v_best is not null then
      return query select v_best, false; return;
    end if;

    -- combos of 2
    v_best := null; v_best_score := null; v_best_cap := null;
    for i in 1 .. v_n - 1 loop
      for j in i + 1 .. v_n loop
        v_cap := v_caps[i] + v_caps[j];
        if v_cap >= p_guest_count then
          v_score := sqrt((v_xs[i]-v_xs[j])^2 + (v_ys[i]-v_ys[j])^2);
          if v_best_score is null or v_score < v_best_score
             or (v_score = v_best_score and v_cap < v_best_cap) then
            v_best := array[v_ids[i], v_ids[j]]; v_best_score := v_score; v_best_cap := v_cap;
          end if;
        end if;
      end loop;
    end loop;
    if v_best is not null then
      return query select v_best, false; return;
    end if;

    -- combos of 3
    for i in 1 .. v_n - 2 loop
      for j in i + 1 .. v_n - 1 loop
        for k in j + 1 .. v_n loop
          v_cap := v_caps[i] + v_caps[j] + v_caps[k];
          if v_cap >= p_guest_count then
            v_score := greatest(
              sqrt((v_xs[i]-v_xs[j])^2 + (v_ys[i]-v_ys[j])^2),
              sqrt((v_xs[i]-v_xs[k])^2 + (v_ys[i]-v_ys[k])^2),
              sqrt((v_xs[j]-v_xs[k])^2 + (v_ys[j]-v_ys[k])^2));
            if v_best_score is null or v_score < v_best_score
               or (v_score = v_best_score and v_cap < v_best_cap) then
              v_best := array[v_ids[i], v_ids[j], v_ids[k]]; v_best_score := v_score; v_best_cap := v_cap;
            end if;
          end if;
        end loop;
      end loop;
    end loop;
    if v_best is not null then
      return query select v_best, false; return;
    end if;

    -- combos of 4
    for i in 1 .. v_n - 3 loop
      for j in i + 1 .. v_n - 2 loop
        for k in j + 1 .. v_n - 1 loop
          for l in k + 1 .. v_n loop
            v_cap := v_caps[i] + v_caps[j] + v_caps[k] + v_caps[l];
            if v_cap >= p_guest_count then
              v_score := greatest(
                sqrt((v_xs[i]-v_xs[j])^2 + (v_ys[i]-v_ys[j])^2),
                sqrt((v_xs[i]-v_xs[k])^2 + (v_ys[i]-v_ys[k])^2),
                sqrt((v_xs[i]-v_xs[l])^2 + (v_ys[i]-v_ys[l])^2),
                sqrt((v_xs[j]-v_xs[k])^2 + (v_ys[j]-v_ys[k])^2),
                sqrt((v_xs[j]-v_xs[l])^2 + (v_ys[j]-v_ys[l])^2),
                sqrt((v_xs[k]-v_xs[l])^2 + (v_ys[k]-v_ys[l])^2));
              if v_best_score is null or v_score < v_best_score
                 or (v_score = v_best_score and v_cap < v_best_cap) then
                v_best := array[v_ids[i], v_ids[j], v_ids[k], v_ids[l]]; v_best_score := v_score; v_best_cap := v_cap;
              end if;
            end if;
          end loop;
        end loop;
      end loop;
    end loop;
    if v_best is not null then
      return query select v_best, false; return;
    end if;

    return query select null::uuid[], true;
  exception when others then
    raise warning 'assign_tables failed (%): %', sqlstate, sqlerrm;
    return query select null::uuid[], true;
  end;
end;
$$;
revoke execute on function public.assign_tables(date, time, integer, integer, uuid) from public, anon, authenticated;

-------------------------------------------------------------------------------
-- 2. create_reservation_atomic: server-side validation (guest count, past date,
--    lead time), day_type derived from the date, date_closed message typo fixed.
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_reservation_atomic(p_reservation_date date, p_reservation_time time without time zone, p_day_type text, p_guest_count integer, p_customer_id uuid, p_notes text, p_baby_chairs integer, p_pets boolean)
 RETURNS reservations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  declare
  v_blocked record;
  v_day_name text;
  v_hours record;
  v_slot_rule record;
  v_duration_minutes integer;
  v_valid_time boolean;
  v_blackout record;
  v_booking_start_mins integer;
  v_booking_end_mins integer;
  v_window_start_mins integer;
  v_window_end_mins integer;
  v_total_small_capacity integer;
  v_booked_small_seats integer;
  v_big_table_booked boolean;
  v_table_type text;
  v_tables_count integer;
  v_auto_confirm boolean;
  v_status text;
  v_reservation public.reservations;
  v_table_ids uuid[];
  v_flagged boolean;
  v_day_type text;
  v_today date;
  v_now_mins integer;
  begin
if p_guest_count is null or p_guest_count < 1 then
raise exception 'invalid_guest_count: Guest count must be at least 1.';
end if;
if p_guest_count > 10 then
raise exception 'party_too_large: Sorry, we can only take online bookings for up to 10 guests. Please contact us directly.';
end if;
v_today := (now() at time zone 'Asia/Kuala_Lumpur')::date;
if p_reservation_date < v_today then
raise exception 'past_date: Sorry, that date has already passed.';
end if;
if p_reservation_date = v_today then
v_now_mins := extract(hour from (now() at time zone 'Asia/Kuala_Lumpur'))::int * 60
+ extract(minute from (now() at time zone 'Asia/Kuala_Lumpur'))::int;
-- 30 = LEAD_TIME_MINUTES in src/lib/slotCutoff.js
if extract(hour from p_reservation_time)::int * 60 + extract(minute from p_reservation_time)::int < v_now_mins + 30 then
raise exception 'time_passed: Sorry, that time has already passed. Please choose a later time.';
end if;
end if;
select * into v_blocked from blocked_dates where blocked_date = p_reservation_date;
if v_blocked.is_closed then
raise exception 'date_closed: Sorry, reservations are not available on this date.';
end if;
if v_blocked.max_pax is not null and p_guest_count > v_blocked.max_pax then
raise exception 'max_pax_exceeded: Sorry, we can only accommodate up to % guests on this date.', v_blocked.max_pax;
end if;
v_day_name := case extract(dow from p_reservation_date)::int
when 0 then 'Sunday' when 1 then 'Monday' when 2 then 'Tuesday'
when 3 then 'Wednesday' when 4 then 'Thursday' when 5 then 'Friday'
else 'Saturday' end;
-- p_day_type is accepted for signature compatibility and ignored: the client must not choose it.
v_day_type := case when extract(dow from p_reservation_date)::int in (5, 6) then 'weekend' else 'weekday' end;
select * into v_hours from operating_hours where day_type = v_day_type;
if v_hours.closed_days is not null and v_hours.closed_days ? v_day_name then
raise exception 'date_closed: Sorry, we are closed on %.', v_day_name;
end if;
select * into v_slot_rule from slot_rules where day_type = v_day_type;
v_duration_minutes := coalesce(v_slot_rule.hold_duration_minutes, 120);
if v_slot_rule.rule_type = 'session' then
v_valid_time := exists (
select 1 from jsonb_array_elements(coalesce(v_slot_rule.sessions, '[]'::jsonb)) s
where (s->>'start')::time = p_reservation_time
);
if not v_valid_time then
raise exception 'invalid_time_slot: Please select a valid time slot.';
end if;
else
v_valid_time := exists (
select 1 from jsonb_array_elements(coalesce(v_hours.sessions, '[]'::jsonb)) s
where p_reservation_time >= (s->>'start')::time
and p_reservation_time <= coalesce((s->>'last_booking')::time, (s->>'end')::time)
);
if v_hours.sessions is not null and not v_valid_time then
raise exception 'invalid_time_slot: Sorry, that time is outside our booking hours.';
end if;
end if;
v_booking_start_mins := extract(hour from p_reservation_time)::int * 60 + extract(minute from p_reservation_time)::int;
v_booking_end_mins := v_booking_start_mins + v_duration_minutes;
for v_blackout in select * from blackout_dates where block_date = p_reservation_date loop
if v_blackout.start_time is null and v_blackout.end_time is null then
raise exception 'blacked_out: Sorry, reservations are not available at this time.';
end if;
v_window_start_mins := extract(hour from coalesce(v_blackout.start_time, '00:00'::time))::int * 60
+ extract(minute from coalesce(v_blackout.start_time, '00:00'::time))::int;
v_window_end_mins := extract(hour from coalesce(v_blackout.end_time, '23:59'::time))::int * 60
+ extract(minute from coalesce(v_blackout.end_time, '23:59'::time))::int;
if v_booking_start_mins < v_window_end_mins and v_booking_end_mins > v_window_start_mins then
raise exception 'blacked_out: Sorry, reservations are not available at this time.';
end if;
end loop;
perform pg_advisory_xact_lock(hashtext(p_reservation_date::text));
select coalesce(sum(capacity), 0) into v_total_small_capacity
from restaurant_tables
where is_bookable = true and table_number <> 'BT' and capacity >= 2;
select
coalesce(sum(case when r.table_type is distinct from 'big' then r.guest_count else 0 end), 0),
coalesce(bool_or(r.table_type = 'big'), false)
into v_booked_small_seats, v_big_table_booked
from reservations r
where r.reservation_date = p_reservation_date
and r.status in ('confirmed', 'pending', 'seated')
and (extract(hour from r.reservation_time)::int * 60 + extract(minute from r.reservation_time)::int) < v_booking_end_mins
and (extract(hour from r.reservation_time)::int * 60 + extract(minute from r.reservation_time)::int + v_duration_minutes) > v_booking_start_mins;
if p_guest_count between 6 and 8 and not v_big_table_booked then
v_table_type := 'big'; v_tables_count := 1; v_auto_confirm := true;
elsif p_guest_count > 8 and not v_big_table_booked then
v_table_type := 'big'; v_tables_count := 1; v_auto_confirm := false;
else
if p_guest_count <= 2 then
v_tables_count := 1;
elsif p_guest_count <= 10 then
v_tables_count := ceil((p_guest_count - 2) / 2.0);
else
raise exception 'party_too_large: Party size too large — please contact us directly.';
end if;
if p_guest_count > (v_total_small_capacity - v_booked_small_seats) then
raise exception 'capacity_unavailable: Sorry, we don''t have enough tables for this time slot. Please choose a different time.';
end if;
v_table_type := 'small';
v_auto_confirm := true;
end if;
v_status := case when v_auto_confirm then 'confirmed' else 'pending' end;
select a.table_ids, a.flagged into v_table_ids, v_flagged
from public.assign_tables(p_reservation_date, p_reservation_time, p_guest_count, v_duration_minutes, null::uuid) a;
insert into reservations (
customer_id, reservation_date, reservation_time, guest_count,
notes, baby_chairs, pets, status, table_type, tables_count,
table_ids, needs_manual_assignment
) values (
p_customer_id, p_reservation_date, p_reservation_time, p_guest_count,
p_notes, p_baby_chairs, p_pets, v_status, v_table_type, v_tables_count,
case when v_table_ids is null then null else to_jsonb(v_table_ids) end, coalesce(v_flagged, false)
) returning * into v_reservation;
if v_table_ids is not null then
  update restaurant_tables
     set locked_until = ((p_reservation_date + p_reservation_time) at time zone 'Asia/Kuala_Lumpur')
                        + make_interval(mins => v_duration_minutes),
         locked_by_reservation = v_reservation.id
   where id = any(v_table_ids);
end if;
return v_reservation;
end;
$function$
;

-------------------------------------------------------------------------------
-- 3. amend_reservation_atomic: exclude own row when assigning tables, recompute
--    table_type/tables_count, only pending/confirmed/seated are amendable, reset
--    reminder_sent when the date or time changes.
-------------------------------------------------------------------------------
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
  v_table_type text;
  v_tables_count integer;
  v_big_table_booked boolean;
  v_booking_start_mins integer;
  v_booking_end_mins integer;
begin
  select * into v_reservation from reservations where id = p_id for update;
  if not found then
    raise exception 'not_found: That booking no longer exists.';
  end if;
  if v_reservation.status = 'cancelled' then
    raise exception 'cancelled: A cancelled booking cannot be amended.';
  end if;
  if v_reservation.status not in ('pending', 'confirmed', 'seated') then
    raise exception 'not_amendable: A % booking cannot be amended.', v_reservation.status;
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

  -- table_type / tables_count: same rule as create_reservation_atomic (status is not touched).
  v_booking_start_mins := extract(hour from p_reservation_time)::int * 60 + extract(minute from p_reservation_time)::int;
  v_booking_end_mins := v_booking_start_mins + v_duration_minutes;
  select coalesce(bool_or(r.table_type = 'big'), false) into v_big_table_booked
  from reservations r
  where r.reservation_date = p_reservation_date
    and r.id <> p_id
    and r.status in ('confirmed', 'pending', 'seated')
    and (extract(hour from r.reservation_time)::int * 60 + extract(minute from r.reservation_time)::int) < v_booking_end_mins
    and (extract(hour from r.reservation_time)::int * 60 + extract(minute from r.reservation_time)::int + v_duration_minutes) > v_booking_start_mins;
  if p_guest_count > 5 and not v_big_table_booked then
    v_table_type := 'big';
    v_tables_count := 1;
  else
    v_table_type := 'small';
    v_tables_count := case when p_guest_count <= 2 then 1 else ceil((p_guest_count - 2) / 2.0)::int end;
  end if;

  select a.table_ids, a.flagged into v_table_ids, v_flagged
  from public.assign_tables(p_reservation_date, p_reservation_time, p_guest_count, v_duration_minutes, p_id) a;

  update reservations
     set reservation_date = p_reservation_date,
         reservation_time = p_reservation_time,
         guest_count = p_guest_count,
         notes = p_notes,
         baby_chairs = coalesce(p_baby_chairs, 0),
         pets = coalesce(p_pets, false),
         table_type = v_table_type,
         tables_count = v_tables_count,
         reminder_sent = case
           when p_reservation_date is distinct from reservations.reservation_date
             or p_reservation_time is distinct from reservations.reservation_time then false
           else reservations.reminder_sent end,
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

-------------------------------------------------------------------------------
-- 4. get_availability: no slots for fewer than 1 guest, STABLE, blackouts and
--    reservations read once per call instead of once per slot.
-------------------------------------------------------------------------------
create or replace function public.get_availability(p_date date, p_guest_count int)
returns table (slot time, day_type text, requires_approval boolean)
language plpgsql
stable
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
  v_blackouts jsonb;
  v_day_reservations jsonb;
  v_is_blacked_out boolean;
  v_booked_small_seats integer;
  v_big_table_booked boolean;
begin
  if p_guest_count < 1 or p_guest_count > 10 then
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

  select * into v_hours from operating_hours where operating_hours.day_type = v_day_type;
  if v_hours.closed_days is not null and v_hours.closed_days ? v_day_name then
    return;
  end if;

  select * into v_slot_rule from slot_rules where slot_rules.day_type = v_day_type;
  v_duration_minutes := coalesce(v_slot_rule.hold_duration_minutes, 120);

  select coalesce(sum(capacity), 0) into v_total_small_capacity
  from restaurant_tables
  where is_bookable = true and table_number <> 'BT' and capacity >= 2;

  -- Read once per call, not once per slot.
  -- blackout_dates: a row with both times null blacks out the whole date; a row
  -- with only one bound set treats the missing bound as the day's edge.
  select coalesce(jsonb_agg(jsonb_build_object(
    'whole', b.start_time is null and b.end_time is null,
    's', extract(hour from coalesce(b.start_time, '00:00'::time))::int * 60
         + extract(minute from coalesce(b.start_time, '00:00'::time))::int,
    'e', extract(hour from coalesce(b.end_time, '23:59'::time))::int * 60
         + extract(minute from coalesce(b.end_time, '23:59'::time))::int
  )), '[]'::jsonb)
  into v_blackouts
  from blackout_dates b
  where b.block_date = p_date;

  select coalesce(jsonb_agg(jsonb_build_object(
    'start', extract(hour from r.reservation_time)::int * 60 + extract(minute from r.reservation_time)::int,
    'guests', r.guest_count,
    'big', coalesce(r.table_type = 'big', false)
  )), '[]'::jsonb)
  into v_day_reservations
  from reservations r
  where r.reservation_date = p_date
    and r.status in ('confirmed', 'pending', 'seated');

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

      select exists (
        select 1 from jsonb_array_elements(v_blackouts) b
        where (b->>'whole')::boolean
           or (v_booking_start_mins < (b->>'e')::int and v_booking_end_mins > (b->>'s')::int)
      ) into v_is_blacked_out;

      if not v_is_blacked_out then
        select
          coalesce(sum(case when not (x->>'big')::boolean then (x->>'guests')::int else 0 end), 0),
          coalesce(bool_or((x->>'big')::boolean), false)
        into v_booked_small_seats, v_big_table_booked
        from jsonb_array_elements(v_day_reservations) x
        where (x->>'start')::int < v_booking_end_mins
          and (x->>'start')::int + v_duration_minutes > v_booking_start_mins;

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

-------------------------------------------------------------------------------
-- 5. Trigger functions: security definer, fixed search_path, and a failed email call
--    can no longer abort the booking (same pattern as notify_staff_new_reservation).
--    The triggers themselves (on_reservation_insert / on_reservation_completed) exist
--    live and are not defined in any migration; they are left untouched.
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_reservation_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault', 'pg_temp'
AS $function$
declare
  v_key text;
begin
  begin
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'tonda_service_role_key';

    if v_key is null then
      raise warning 'notify_reservation_insert: tonda_service_role_key missing from vault; alert skipped';
      return NEW;
    end if;

    perform net.http_post(
      url := 'https://qeepslmexektwqhxzwqs.supabase.co/functions/v1/send-confirmation-email',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body := jsonb_build_object('record', row_to_json(NEW))
    );
  exception when others then
    raise warning 'notify_reservation_insert: http_post failed: %', sqlerrm;
  end;
  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_reservation_completed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault', 'pg_temp'
AS $function$
declare
  v_key text;
begin
  if NEW.status = 'completed' and (OLD.status is null or OLD.status <> 'completed') then
    begin
      select decrypted_secret into v_key from vault.decrypted_secrets where name = 'tonda_service_role_key';

      if v_key is null then
        raise warning 'notify_reservation_completed: tonda_service_role_key missing from vault; alert skipped';
        return NEW;
      end if;

      perform net.http_post(
        url := 'https://qeepslmexektwqhxzwqs.supabase.co/functions/v1/send-thankyou-email',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
        body := jsonb_build_object('record', row_to_json(NEW), 'old_record', row_to_json(OLD))
      );
    exception when others then
      raise warning 'notify_reservation_completed: http_post failed: %', sqlerrm;
    end;
  end if;
  return NEW;
end;
$function$;

-------------------------------------------------------------------------------
-- 6. Constraints, index, cron housekeeping (each idempotent).
-------------------------------------------------------------------------------
-- guest_count > 0: added NOT VALID, then validated; existing bad rows leave it NOT VALID
-- instead of rolling the whole migration back.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reservations_guest_count_positive') then
    alter table public.reservations
      add constraint reservations_guest_count_positive check (guest_count > 0) not valid;
  end if;
  begin
    alter table public.reservations validate constraint reservations_guest_count_positive;
  exception when check_violation then
    raise notice 'reservations_guest_count_positive left NOT VALID: existing rows violate it';
  end;
end;
$$;

-- unique table_number: only when no duplicates exist.
do $$
begin
  if exists (select 1 from public.restaurant_tables group by table_number having count(*) > 1) then
    raise notice 'restaurant_tables has duplicate table_number values; unique constraint not added';
  elsif not exists (select 1 from pg_constraint where conname = 'restaurant_tables_table_number_key') then
    alter table public.restaurant_tables add constraint restaurant_tables_table_number_key unique (table_number);
  end if;
end;
$$;

create index if not exists reservations_date_status_idx on public.reservations (reservation_date, status);

-- Weekly purge of cron run history (Supabase cron runs in UTC: Sunday 03:00 UTC).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-cron-run-details') then
    perform cron.unschedule('purge-cron-run-details');
  end if;
  perform cron.schedule(
    'purge-cron-run-details',
    '0 3 * * 0',
    $cmd$ delete from cron.job_run_details where end_time < now() - interval '14 days' $cmd$);
end;
$$;
