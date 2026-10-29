-- Run once in the Supabase SQL editor AFTER deploying the functions.
-- Calls cron-tick every minute: creates targets, settles missed windows (−100),
-- sends reminders, retries stuck verifications.
--
-- 1. Store the two values in Vault (replace the placeholders):
select vault.create_secret('https://YOUR-PROJECT-REF.supabase.co', 'project_url');
select vault.create_secret('THE SAME VALUE AS THE CRON_SECRET FUNCTION SECRET', 'cron_secret');

-- 2. Enable the extensions (Dashboard › Database › Extensions, or):
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 3. Schedule:
select cron.schedule(
  'noexcuse-cron-tick',
  '* * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/cron-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- Check it ran: select * from cron.job_run_details order by start_time desc limit 5;
-- Stop it:      select cron.unschedule('noexcuse-cron-tick');
