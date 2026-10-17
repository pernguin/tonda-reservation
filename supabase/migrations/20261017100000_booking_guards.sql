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
