-- Tonda lockdown (package 10): row-level security on Tonda's project.
-- APPLY LAST: only after Tonda 05, 06 and 07 are deployed, and public sign-ups are disabled.
-- Drops EVERY existing policy on the listed tables, enables RLS, creates exactly the policies below.
-- Idempotent: safe to run twice.

do $$
declare
  t text;
  p record;
  locked text[] := array[
    'reservations', 'table_groups', 'customers', 'restaurant_tables', 'table_blocks',
    'operating_hours', 'slot_rules', 'blocked_dates', 'blackout_dates', 'experiences', 'public_holidays',
    'settings', 'events', 'offsite_bookings', 'experience_registrations'
  ];
  anon_select text[] := array[
    'operating_hours', 'slot_rules', 'blocked_dates', 'blackout_dates', 'experiences', 'public_holidays'
  ];
  anon_insert text[] := array['events', 'offsite_bookings', 'experience_registrations'];
begin
  foreach t in array locked loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy staff_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;

  foreach t in array anon_select loop
    execute format('create policy anon_select on public.%I for select to anon using (true)', t);
  end loop;

  foreach t in array anon_insert loop
    execute format('create policy anon_insert on public.%I for insert to anon with check (true)', t);
  end loop;
end;
$$;

create policy anon_select_confirmation_messages on public.settings
  for select to anon using (key like 'confirmation\_message\_%');

-- Visibility only: any other public table still without RLS shows up in the push output.
do $$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    raise notice 'public.% has RLS disabled and is not covered by this migration', r.relname;
  end loop;
end;
$$;

-- claim_restaurant_tables is security definer and only the admin Tables page calls it: keep anon out.
revoke execute on function public.claim_restaurant_tables(uuid[], uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.claim_restaurant_tables(uuid[], uuid, timestamptz, timestamptz) to authenticated;