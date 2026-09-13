begin;

-- The `supabase db query` CLI does not surface RAISE NOTICE output, so per the brief's Step 4
-- fallback we record pass/fail into a temp table and select it before rollback instead.
create temp table results (label text);

-- fixture: four temporary tables far from real ones; a 2030 date no real booking uses
insert into public.restaurant_tables (id, table_number, capacity, x_position, y_position, is_bookable) values
  ('11111111-1111-1111-1111-111111111111', 'ZZ1', 2, 900, 900, true),
  ('22222222-2222-2222-2222-222222222222', 'ZZ2', 4, 910, 900, true),
  ('33333333-3333-3333-3333-333333333333', 'ZZ3', 4, 990, 990, true),
  ('44444444-4444-4444-4444-444444444444', 'ZZ4', 4, 920, 900, true);

-- make every real table unavailable on the test date by parking them in dummy reservations.
-- assign_tables' overlap check uses the *querying* call's p_hold_minutes against the existing
-- reservation's own start time (existing_start < v_end AND existing_start + p_hold_minutes >
-- v_start), so a single dummy row at 00:00 would not block the 19:00/12:00 assign_tables probes
-- below. Instead we park real tables at the exact times those probes use (19:00 and 12:00),
-- each with the same 120-minute hold the probes pass, so the overlap condition triggers.
insert into public.reservations (customer_id, reservation_date, reservation_time, guest_count, status, table_ids)
select null, date '2030-01-01', time '19:00', 1, 'confirmed',
       (select jsonb_agg(id) from public.restaurant_tables where table_number not like 'ZZ%');
insert into public.reservations (customer_id, reservation_date, reservation_time, guest_count, status, table_ids)
select null, date '2030-01-01', time '12:00', 1, 'confirmed',
       (select jsonb_agg(id) from public.restaurant_tables where table_number not like 'ZZ%');

do $$
declare r record;
begin
  -- 1. single smallest fit: 2 guests at 19:00 -> ZZ1 (capacity 2)
  select * into r from public.assign_tables(date '2030-01-01', time '19:00', 2, 120);
  if r.flagged or r.table_ids <> array['11111111-1111-1111-1111-111111111111']::uuid[] then
    raise exception 'T1 single fit failed: %', r; end if;

  -- 2. combo: 6 guests. ZZ1+ZZ2 (dist 10, cap 6) and ZZ2+ZZ4 (dist 10, cap 8) tie on distance;
  -- the algorithm's tie-break picks the lower-capacity pair, so ZZ1+ZZ2 wins over ZZ2+ZZ4
  -- (and both beat ZZ3, which is further away). Expect exactly {ZZ1, ZZ2}.
  select * into r from public.assign_tables(date '2030-01-01', time '19:00', 6, 120);
  if r.flagged or not (r.table_ids @> array['11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222']::uuid[])
     or array_length(r.table_ids,1) <> 2 then
    raise exception 'T2 combo failed: %', r; end if;

  -- 3. overlap excludes, non-overlap does not: ZZ1 booked 20:00 (hold 120) -> 19:00 conflicts, 12:00 does not
  insert into public.reservations (customer_id, reservation_date, reservation_time, guest_count, status, table_ids)
  values (null, date '2030-01-01', time '20:00', 2, 'confirmed', '["11111111-1111-1111-1111-111111111111"]'::jsonb);
  select * into r from public.assign_tables(date '2030-01-01', time '19:00', 2, 120);
  if r.flagged or r.table_ids = array['11111111-1111-1111-1111-111111111111']::uuid[] then
    raise exception 'T3a overlap not excluded: %', r; end if;
  select * into r from public.assign_tables(date '2030-01-01', time '12:00', 2, 120);
  if r.flagged or r.table_ids <> array['11111111-1111-1111-1111-111111111111']::uuid[] then
    raise exception 'T3b non-overlap wrongly excluded: %', r; end if;

  -- 4. nothing free -> flagged
  update public.restaurant_tables set is_bookable = false where table_number like 'ZZ%';
  select * into r from public.assign_tables(date '2030-01-01', time '19:00', 2, 120);
  if not r.flagged or r.table_ids is not null then
    raise exception 'T4 flagged failed: %', r; end if;
  update public.restaurant_tables set is_bookable = true where table_number like 'ZZ%';
  insert into results values ('assign_tables: 4/4 passed');
end;
$$;

-- 5. end-to-end through the RPC: row carries table_ids; tables get locked; cancel works once
-- 2030-01-01 is actually a Tuesday (contra the brief, which claimed Wednesday), confirmed live:
-- day_type='weekday' has closed_days = {Tuesday}, so create_reservation_atomic raises date_closed
-- for 'weekday' on this date regardless of the time chosen. day_type='weekend' has closed_days =
-- {} (never closed), and its slot_rules.rule_type is 'session' with an exact-match start time of
-- 14:00 among its sessions (read live in the scratch probe) -- that does not collide with the
-- 19:00/12:00/20:00 times already used by the assign_tables probes above.
do $$
declare v public.reservations; ok boolean; n int;
begin
  select * into v from public.create_reservation_atomic(
    date '2030-01-01', time '14:00', 'weekend', 2, null, 'rollback test', 0, false);
  if v.table_ids is null or v.needs_manual_assignment then
    raise exception 'T5 RPC did not assign: %', v; end if;
  select count(*) into n from public.restaurant_tables
   where locked_by_reservation = v.id and locked_until is not null;
  if n = 0 then raise exception 'T5 tables not locked'; end if;
  select public.cancel_reservation(v.id) into ok;
  if not ok then raise exception 'T6 cancel returned false'; end if;
  select count(*) into n from public.restaurant_tables where locked_by_reservation = v.id;
  if n <> 0 then raise exception 'T6b locks not released on cancel'; end if;
  select public.cancel_reservation(v.id) into ok;
  if ok then raise exception 'T6 second cancel should be false'; end if;
  insert into results values ('RPC + cancel: passed');
end;
$$;

-- 7. dedupe: a referenced, off-canvas duplicate must keep its id but adopt the on-canvas
-- position of the unreferenced duplicate that gets deleted.
insert into public.restaurant_tables (id, table_number, capacity, x_position, y_position, is_bookable) values
  ('55555555-5555-5555-5555-555555555555', 'ZZDUP', 2, 900, 900, true),
  ('66666666-6666-6666-6666-666666666666', 'ZZDUP', 2, 50, 50, true);

insert into public.reservations (customer_id, reservation_date, reservation_time, guest_count, status, table_ids)
values (null, date '2030-01-01', time '21:00', 2, 'confirmed', '["55555555-5555-5555-5555-555555555555"]'::jsonb);

do $$
declare
  grp record; keep_id uuid; pos record;
begin
  for grp in
    select table_number from public.restaurant_tables group by table_number having count(*) > 1
  loop
    with refs as (
      select (jsonb_array_elements_text(r.table_ids))::uuid as id
      from public.reservations r where jsonb_typeof(r.table_ids) = 'array'
    )
    select t.id into keep_id
    from public.restaurant_tables t
    left join (select id, count(*) n from refs group by id) x on x.id = t.id
    where t.table_number = grp.table_number
    order by coalesce(x.n, 0) desc, t.created_at asc, t.id asc
    limit 1;

    -- adopt a visible position from a doomed duplicate if the kept row is off-canvas
    select t.x_position, t.y_position into pos
    from public.restaurant_tables t
    where t.table_number = grp.table_number and t.id <> keep_id
      and t.x_position between 0 and 400 and t.y_position between 0 and 340
    order by t.created_at asc limit 1;
    if found then
      update public.restaurant_tables k
         set x_position = pos.x_position, y_position = pos.y_position
       where k.id = keep_id and not (k.x_position between 0 and 400 and k.y_position between 0 and 340);
    end if;

    delete from public.table_blocks where table_id in
      (select id from public.restaurant_tables where table_number = grp.table_number and id <> keep_id);
    update public.restaurant_tables set locked_until = null, locked_by_reservation = null, group_id = null
      where table_number = grp.table_number and id <> keep_id;
    delete from public.restaurant_tables where table_number = grp.table_number and id <> keep_id;
  end loop;
end;
$$;

do $$
declare n int; kept public.restaurant_tables;
begin
  select count(*) into n from public.restaurant_tables where table_number = 'ZZDUP';
  if n <> 1 then raise exception 'T7 dedupe: expected exactly 1 ZZDUP row, got %', n; end if;
  select * into kept from public.restaurant_tables where table_number = 'ZZDUP';
  if kept.id <> '55555555-5555-5555-5555-555555555555' then
    raise exception 'T7 dedupe: wrong row kept: %', kept.id; end if;
  if kept.x_position <> 50 or kept.y_position <> 50 then
    raise exception 'T7 dedupe: position not adopted: (%, %)', kept.x_position, kept.y_position; end if;
  insert into results values ('dedupe: passed');
end;
$$;

-- the query CLI only returns the last statement's rows, so fold results/cron/policy checks
-- into one final summary row instead of separate selects.
select jsonb_build_object(
  'results', (select jsonb_agg(label) from results),
  'cron', (select jsonb_agg(to_jsonb(c)) from (
             select jobname, schedule from cron.job where jobname = 'send-reminder-email') c),
  'policies', (select jsonb_agg(to_jsonb(p)) from (
             select policyname, roles::text from pg_policies
             where tablename in ('reservations','settings') order by policyname) p)
) as summary;

rollback;
