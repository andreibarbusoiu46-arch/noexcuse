-- Every minute: create today's/tomorrow's targets and settle closed windows (−100 for missed).
-- Pure SQL, no secrets needed. Push reminders/retries run from the cron-tick Edge Function (iOS).
create extension if not exists pg_cron;

select cron.schedule(
  'noexcuse-db-clock',
  '* * * * *',
  $$ select public.ensure_targets_all(); select count(*) from public.settle_due_targets(); $$
);
