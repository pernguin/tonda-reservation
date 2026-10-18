-- Data cleanup from the 2026-10-17 audit. For Perng to run BY HAND in the Supabase SQL editor.
-- NOT a migration: do not move this into supabase/migrations and do not run it from a script.
-- Plan: docs/build/2026-10-17-audit-plan.md ("Data cleanup").
--
--   Part A  Tonda project (qeepslmexektwqhxzwqs)  clear expired table locks   (writes)
--   Part B  Tonda project (qeepslmexektwqhxzwqs)  inspect past, still-open bookings (read only)
--   Part C  ROUND's project                        inspect 3 drifted customers  (read only; fixes commented out)
--
-- Run each part's SELECT first, look at the rows, then decide on the write.


-- ============================================================================
-- PART A (Tonda project): clear expired table locks
-- ============================================================================
-- A1. What the update will change. The audit saw 6 rows on 2026-10-17.
select id, table_number, locked_until, locked_by_reservation
from public.restaurant_tables
where locked_until < now()
order by locked_until;

-- A2. CHECK THE ROW COUNT OF A1 FIRST. Run this block only if the rows above are what you expect
-- (expired locks only; about 6). The guard aborts the whole transaction if more than 25 rows
-- would change, so a wrong clause cannot silently wipe live locks.
begin;

do $$
declare
  n int;
begin
  update public.restaurant_tables
     set locked_until = null, locked_by_reservation = null
   where locked_until < now();
  get diagnostics n = row_count;
  raise notice 'cleared % expired table locks', n;
  if n > 25 then
    raise exception 'expected about 6 expired locks, would clear % - aborting, nothing changed', n;
  end if;
end;
$$;

commit;

-- A3. Afterwards this should return 0 rows (unexpired locks for bookings still to come are untouched).
select id, table_number, locked_until, locked_by_reservation
from public.restaurant_tables
where locked_until < now();


-- ============================================================================
-- PART B (Tonda project): past bookings still open. NO UPDATE here.
-- Staff close these out in admin: Dashboard shows "N past bookings still open"
-- (package 08) and links to Manage Bookings -> Past, where each is marked
-- Completed / No-show / Cancelled so Round's customer counters are logged correctly.
-- ============================================================================
-- B1. The 6 past reservations still 'confirmed' (date before today, Asia/Kuala_Lumpur).
-- Guest names live in Round's project (customers), so match customer_id there if needed.
select id, reservation_date, reservation_time, guest_count, status, customer_id, table_ids, created_at
from public.reservations
where status = 'confirmed'
  and reservation_date < (now() at time zone 'Asia/Kuala_Lumpur')::date
order by reservation_date, reservation_time;

-- B2. The same view for every still-open status (what the Dashboard banner counts).
select status, count(*) as past_open, min(reservation_date) as oldest, max(reservation_date) as newest
from public.reservations
where status in ('confirmed', 'pending', 'seated')
  and reservation_date < (now() at time zone 'Asia/Kuala_Lumpur')::date
group by status
order by status;


-- ============================================================================
-- PART C (ROUND's Supabase project, NOT Tonda's): 3 customers with counter drift
-- ============================================================================
-- Customers with id prefixes bc588e9e, 94465227, 2e3dcd1b have visit/no-show/spend counters
-- that do not match their customer_visits rows (Tonda-side drift found in the audit).
-- Run C1 and C2 on ROUND's project. On Tonda's project they return nothing useful.
--
-- DO NOT recompute counters from scratch for anyone: 5,119 Round customers have counters with
-- no customer_visits rows at all (history from before visit rows existed), so a blanket
-- recount would erase real history. Fix each of these three by hand, with the specific
-- number you decide after reading C1/C2.

-- C1. Counters versus the visit rows that exist for the same customer.
select c.id, c.full_name, c.visit_count, c.no_show_count, c.total_spent, c.last_visited_at, c.last_visit_spent,
       count(v.*) filter (where v.status = 'completed')                        as completed_rows,
       count(v.*) filter (where v.status = 'no_show')                          as no_show_rows,
       coalesce(sum(v.amount_spent) filter (where v.status = 'completed'), 0)  as spent_in_rows,
       max(v.visited_at) filter (where v.status = 'completed')                 as latest_completed_row
from public.customers c
left join public.customer_visits v on v.customer_id = c.id
where c.id::text like any (array['bc588e9e%', '94465227%', '2e3dcd1b%'])
group by c.id
order by c.id;

-- C2. The visit rows themselves, newest first, by restaurant (round vs tonda) and status.
select v.customer_id, v.restaurant, v.status, v.visited_at, v.pax, v.amount_spent, v.reservation_id
from public.customer_visits v
where v.customer_id::text like any (array['bc588e9e%', '94465227%', '2e3dcd1b%'])
order by v.customer_id, v.visited_at desc;

-- C3. FIX STATEMENTS - commented out on purpose. Uncomment ONE at a time, replace the
-- <placeholders> with the full customer uuid (from C1) and the value you decided, check the
-- row count (must be 1), then commit.
--
-- begin;
-- update public.customers
--    set visit_count = <correct visit_count>
--  where id = '<full customer uuid>';
-- -- no_show_count, total_spent, last_visited_at and last_visit_spent are separate columns:
-- -- change only the ones C1 shows to be wrong, one statement per column, e.g.
-- -- update public.customers set no_show_count = <n> where id = '<full customer uuid>';
-- -- update public.customers set total_spent = <amount> where id = '<full customer uuid>';
-- -- update public.customers set last_visited_at = '<yyyy-mm-dd>', last_visit_spent = <amount> where id = '<full customer uuid>';
-- -- Check the "UPDATE 1" row count, then:
-- commit;   -- or: rollback;
