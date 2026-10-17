-- Replace with `supabase db dump --schema-only` once Perng takes the snapshot (audit plan, morning list 3).
-- Minimal stub of the live schema: only what the migrations and function bodies touch. No data.

create role anon nologin;
create role authenticated nologin;

create schema vault;
create table vault.decrypted_secrets (name text, decrypted_secret text);

create schema net;
create table net.http_calls (id bigserial primary key, url text, headers jsonb, body jsonb);
create function net.http_post(
  url text,
  body jsonb default '{}',
  params jsonb default '{}',
  headers jsonb default '{"Content-Type":"application/json"}',
  timeout_milliseconds integer default 5000
) returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into net.http_calls (url, headers, body) values (url, headers, body) returning id into v_id;
  return v_id;
end;
$$;

create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create table cron.job_run_details (
  runid bigserial primary key, jobid bigint, status text, start_time timestamptz, end_time timestamptz
);
create function cron.schedule(job_name text, schedule text, command text) returns bigint
language plpgsql as $$
declare v_id bigint;
begin
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid into v_id;
  return v_id;
end;
$$;
create function cron.unschedule(job_name text) returns boolean
language plpgsql as $$
declare v_n integer;
begin
  delete from cron.job where jobname = job_name;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

create publication supabase_realtime;

create table public.settings (key text primary key, value text);

create table public.blocked_dates (
  blocked_date date, is_closed boolean default false, max_pax integer, date_type text
);

create table public.operating_hours (
  day_type text, is_closed boolean default false, closed_days jsonb, sessions jsonb
);

create table public.slot_rules (
  day_type text, rule_type text, sessions jsonb, hold_duration_minutes integer
);

create table public.blackout_dates (block_date date, start_time time, end_time time);

create table public.restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  table_number text,
  capacity integer,
  x_position double precision,
  y_position double precision,
  is_bookable boolean default true,
  locked_until timestamptz,
  locked_by_reservation uuid,
  group_id uuid,
  created_at timestamptz default now()
);

create table public.table_blocks (id uuid primary key default gen_random_uuid(), table_id uuid);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid,
  reservation_date date,
  reservation_time time,
  guest_count integer,
  notes text,
  baby_chairs integer default 0,
  pets boolean default false,
  status text default 'confirmed',
  table_type text,
  tables_count integer,
  table_ids jsonb,
  needs_manual_assignment boolean default false,
  reminder_sent boolean default false,
  created_at timestamptz default now()
);

-- Tables the RLS lockdown (package 10) touches that no migration creates. Columns are only what the tests need.
create table public.table_groups (id uuid primary key default gen_random_uuid());
create table public.customers (id uuid primary key default gen_random_uuid(), full_name text);
create table public.experiences (id uuid primary key default gen_random_uuid(), name text);
create table public.events (id uuid primary key default gen_random_uuid(), event_type text);
create table public.offsite_bookings (id uuid primary key default gen_random_uuid(), event_type text);
create table public.experience_registrations (id uuid primary key default gen_random_uuid(), name text);

create function public.claim_restaurant_tables(p_table_ids uuid[], p_reservation_id uuid, p_from timestamptz, p_until timestamptz)
returns setof uuid language sql security definer as $$ select null::uuid where false $$;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
