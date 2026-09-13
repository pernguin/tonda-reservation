-- Staff alert on new reservation + Realtime publication + settings seed.
-- pg_net 0.20 and supabase_vault are already installed on this project;
-- vault secret 'tonda_service_role_key' already exists (used by on_reservation_insert).
-- This file must not touch on_reservation_insert / on_reservation_completed.

create or replace function public.notify_staff_new_reservation()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'vault', 'pg_temp'
as $$
declare
  v_key text;
begin
  begin
    select decrypted_secret into v_key
    from vault.decrypted_secrets
    where name = 'tonda_service_role_key';

    if v_key is null then
      raise warning 'notify_staff_new_reservation: tonda_service_role_key missing from vault; alert skipped';
      return NEW;
    end if;

    perform net.http_post(
      url := 'https://qeepslmexektwqhxzwqs.supabase.co/functions/v1/notify-staff-reservation',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body := jsonb_build_object('record', row_to_json(NEW)),
      timeout_milliseconds := 10000
    );
  exception when others then
    raise warning 'notify_staff_new_reservation: http_post failed: %', sqlerrm;
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_notify_staff_new_reservation on public.reservations;
create trigger trg_notify_staff_new_reservation
  after insert on public.reservations
  for each row execute function public.notify_staff_new_reservation();

-- Realtime: the publication currently has no tables.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'reservations'
  ) then
    alter publication supabase_realtime add table public.reservations;
  end if;
end;
$$;

insert into public.settings (key, value)
values ('staff_alert_email', 'roundhappymansion@gmail.com')
on conflict (key) do nothing;
