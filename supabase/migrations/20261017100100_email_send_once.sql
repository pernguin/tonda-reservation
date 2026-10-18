-- Email send-once markers (package 04).
--
-- Claimed by send-confirmation-email / send-thankyou-email before sending
-- (update ... set x_sent_at = now() where id = ... and x_sent_at is null returning id)
-- and cleared if Resend fails; null = not sent. Existing rows stay null (no backfill).
-- Not applied by the build; apply this before deploying the functions.

alter table public.reservations
  add column if not exists confirmation_sent_at timestamptz,
  add column if not exists thankyou_sent_at timestamptz;
