-- @platform-only (pg_cron / pg_net / Vault): skipped by the local test runner
-- Schedule the cron-tick Edge Function (reminders, push, verification retries) every minute.
-- The shared secret is generated inside the database and kept in Vault; it never leaves the project.
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'cron_secret', 'Auth for the cron-tick Edge Function');
  end if;
  if not exists (select 1 from vault.secrets where name = 'project_url') then
    perform vault.create_secret('https://ibsrtuyrflvprmjuuoqb.supabase.co', 'project_url', 'Base URL for scheduled function calls');
  end if;
end $$;

-- Readable only by the service role (used by cron-tick to check the caller).
create or replace function public.cron_secret()
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1
$$;
revoke all on function public.cron_secret() from public, anon, authenticated;
grant execute on function public.cron_secret() to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'noexcuse-cron-tick';
select cron.schedule(
  'noexcuse-cron-tick',
  '* * * * *',
  $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/cron-tick',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $job$
);
