-- Rotate the service_role key used by reservation trigger functions out of
-- plaintext and into Supabase Vault. Previously, notify_reservation_insert()
-- hardcoded a plaintext service_role JWT directly in the function body, and
-- notify_reservation_completed() had an unfilled "YOUR_TONDA_SERVICE_ROLE_KEY"
-- placeholder, which meant it never successfully fired send-thankyou-email.
--
-- Prerequisite (already run manually against the linked project, not
-- repeated here since it embeds the plaintext key):
--   select vault.create_secret(
--     '<service_role_key>',
--     'tonda_service_role_key',
--     'service_role key for trigger to edge-function calls'
--   );

CREATE OR REPLACE FUNCTION public.notify_reservation_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'tonda_service_role_key';
  perform net.http_post(
    url := 'https://qeepslmexektwqhxzwqs.supabase.co/functions/v1/send-confirmation-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('record', row_to_json(NEW))
  );
  return NEW;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_reservation_completed()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_key text;
begin
  if NEW.status = 'completed' and (OLD.status is null or OLD.status <> 'completed') then
    select decrypted_secret into v_key from vault.decrypted_secrets where name = 'tonda_service_role_key';
    perform net.http_post(
      url := 'https://qeepslmexektwqhxzwqs.supabase.co/functions/v1/send-thankyou-email',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
      body := jsonb_build_object('record', row_to_json(NEW), 'old_record', row_to_json(OLD))
    );
  end if;
  return NEW;
end;
$function$;
