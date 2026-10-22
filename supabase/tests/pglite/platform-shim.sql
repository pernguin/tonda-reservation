-- What Supabase provides outside `public` that the schema and migrations call. Loaded before
-- live-schema.sql. net.http_post records calls in net.http_calls instead of sending them.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

-- Mimics Supabase: new tables and functions in public are usable by the API roles unless revoked.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

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
