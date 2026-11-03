-- @platform-only (pg_cron): skipped by the local test runner
-- Every 5 minutes: finish challenges (bonus paid once) and snapshot each user's Discipline Score.
select cron.unschedule(jobid) from cron.job where jobname = 'noexcuse-standing';
select cron.schedule('noexcuse-standing', '*/5 * * * *',
  $$select public.settle_challenges(); select public.snapshot_discipline_scores();$$);
