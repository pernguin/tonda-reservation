-- public_booking_rpcs: narrow security-definer reads so the public manage-booking and feedback pages
-- stop selecting from `reservations` directly (docs/build/06-public-pages-rpcs.md).
--
-- Additive only: two functions and their grants. No policy or table grant change; Tonda 10 closes the
-- table once the front end uses these.
--
-- Must be applied by the owner (`supabase db push`), never from a worktree.

create or replace function public.get_booking(p_id uuid)
returns table (
  reservation_date date, reservation_time time, guest_count int, status text,
  notes text, baby_chairs int, pets boolean, customer_id uuid
)
language sql stable security definer set search_path = public, pg_temp
as $$
  select r.reservation_date, r.reservation_time::time, r.guest_count::int, r.status::text,
         r.notes::text, coalesce(r.baby_chairs, 0)::int, coalesce(r.pets, false), r.customer_id
  from public.reservations r where r.id = p_id;
$$;

revoke all on function public.get_booking(uuid) from public;
grant execute on function public.get_booking(uuid) to anon, authenticated;

create or replace function public.feedback_reservation(p_id uuid)
returns table (customer_id uuid, status text)
language sql stable security definer set search_path = public, pg_temp
as $$
  select r.customer_id, r.status::text from public.reservations r where r.id = p_id;
$$;

revoke all on function public.feedback_reservation(uuid) from public;
grant execute on function public.feedback_reservation(uuid) to anon, authenticated;
