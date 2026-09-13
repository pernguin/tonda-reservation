-- Server-side table assignment + booking-flow hardening.
-- Spec: docs/superpowers/specs/2026-09-14-round-parity-port-design.md

-------------------------------------------------------------------------------
-- 1. assign_tables: same algorithm as Round's, minus the scalar locked_until
--    filter. Never raises (returns flagged=true).
-------------------------------------------------------------------------------
create or replace function public.assign_tables(
  p_date date, p_time time, p_guest_count integer, p_hold_minutes integer
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
revoke execute on function public.assign_tables(date, time, integer, integer) from public, anon, authenticated;

-------------------------------------------------------------------------------
-- 2. create_reservation_atomic: Tonda's live body + three splices.
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
  begin
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
select * into v_hours from operating_hours where day_type = p_day_type;
if v_hours.closed_days is not null and v_hours.closed_days ? v_day_name then
raise exception 'date_closed: Sorry, we are closed on %s.', v_day_name;
end if;
select * into v_slot_rule from slot_rules where day_type = p_day_type;
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
from public.assign_tables(p_reservation_date, p_reservation_time, p_guest_count, v_duration_minutes) a;
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
-- 3. cancel_reservation + drop the blanket anon UPDATE policy
-------------------------------------------------------------------------------
create or replace function public.cancel_reservation(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare v_n int;
begin
  update public.reservations
     set status = 'cancelled'
   where id = p_id
     and status in ('pending', 'confirmed')
     and reservation_date >= (now() at time zone 'Asia/Kuala_Lumpur')::date;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    update public.restaurant_tables
       set locked_until = null, locked_by_reservation = null
     where locked_by_reservation = p_id;
  end if;
  return v_n > 0;
end;
$$;
grant execute on function public.cancel_reservation(uuid) to anon, authenticated;

drop policy if exists "Allow public update on reservations" on public.reservations;

-------------------------------------------------------------------------------
-- 4. settings: customers may read confirmation messages only
-------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'settings'
                 and policyname = 'Public read of confirmation messages') then
    create policy "Public read of confirmation messages" on public.settings
      for select to anon using (key like 'confirmation\_message\_%');
  end if;
end;
$$;

-------------------------------------------------------------------------------
-- 5. reminders: pg_cron every 15 minutes -> send-reminder-email (vault key read at run time)
-------------------------------------------------------------------------------
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'send-reminder-email') then
    perform cron.unschedule('send-reminder-email');
  end if;
  perform cron.schedule(
    'send-reminder-email',
    '*/15 * * * *',
    $cmd$
      select net.http_post(
        url := 'https://qeepslmexektwqhxzwqs.supabase.co/functions/v1/send-reminder-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'tonda_service_role_key')),
        body := '{}'::jsonb,
        timeout_milliseconds := 10000)
    $cmd$);
end;
$$;
