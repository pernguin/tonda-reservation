-- Floor plan live refresh: publish restaurant_tables and table_blocks (reservations already published).
do $$
declare t text;
begin
  foreach t in array array['restaurant_tables', 'table_blocks'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
