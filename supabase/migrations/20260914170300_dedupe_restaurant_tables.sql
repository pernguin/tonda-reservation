-- Dedupe restaurant_tables: identical rows were double-inserted (B1-B8) and W1 exists twice.
-- Keep the row referenced by any reservation (else earliest created_at, then lowest id); if the
-- kept row is off-canvas and a doomed duplicate is on-canvas, take that duplicate's position.
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

    -- Re-point any reservation that referenced a doomed duplicate at the kept row.
    update public.reservations r
       set table_ids = (
         select jsonb_agg(case when d.id is not null then to_jsonb(keep_id::text) else to_jsonb(e) end)
         from jsonb_array_elements_text(r.table_ids) e
         left join public.restaurant_tables d
           on d.id::text = e and d.table_number = grp.table_number and d.id <> keep_id
       )
     where jsonb_typeof(r.table_ids) = 'array'
       and exists (
         select 1 from jsonb_array_elements_text(r.table_ids) e
         join public.restaurant_tables d on d.id::text = e
         where d.table_number = grp.table_number and d.id <> keep_id
       );

    delete from public.table_blocks where table_id in
      (select id from public.restaurant_tables where table_number = grp.table_number and id <> keep_id);
    update public.restaurant_tables set locked_until = null, locked_by_reservation = null, group_id = null
      where table_number = grp.table_number and id <> keep_id;
    delete from public.restaurant_tables where table_number = grp.table_number and id <> keep_id;
    raise notice 'dedupe %: kept %', grp.table_number, keep_id;
  end loop;
end;
$$;
