-- Package 11: a booking approved by staff (pending -> confirmed) gets the
-- "Reservation Confirmed" email, at most once (approval_sent_at claim).
-- Idempotent. Apply with `supabase db push` (owner runs it).

alter table public.reservations add column if not exists approval_sent_at timestamptz;

create or replace function public.notify_reservation_approved()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'vault', 'pg_temp'
as $function$
declare
  v_key text;
begin
  begin
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'tonda_service_role_key';

    if v_key is null then
      raise warning 'notify_reservation_approved: tonda_service_role_key missing from vault; email skipped';
      return NEW;
    end if;

    perform net.http_post(
      url := 'https://qeepslmexektwqhxzwqs.supabase.co/functions/v1/send-confirmation-email',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body := jsonb_build_object('record', row_to_json(NEW), 'event', 'approved')
    );
  exception when others then
    raise warning 'notify_reservation_approved: http_post failed: %', sqlerrm;
  end;
  return NEW;
end;
$function$;

drop trigger if exists on_reservation_approved on public.reservations;
create trigger on_reservation_approved
  after update of status on public.reservations
  for each row
  when (OLD.status = 'pending' and NEW.status = 'confirmed')
  execute function public.notify_reservation_approved();
