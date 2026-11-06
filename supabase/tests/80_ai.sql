-- Phase 6 tests: preferences, multi-objective challenges, detail/history, privacy export.
\set QUIET on
\pset tuples_only on

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false); execute 'set role authenticated'; end $$;
create or replace function pg_temp.as_service() returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', '', false); execute 'set role service_role'; end $$;
create or replace function pg_temp.as_admin() returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', '', false); execute 'reset role'; end $$;
create or replace function pg_temp.expect_error(sql text, needle text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if position(needle in sqlerrm) = 0 then raise exception 'expected error containing "%", got "%"', needle, sqlerrm; end if;
    return;
  end;
  raise exception 'expected error containing "%" but statement succeeded: %', needle, sql;
end $$;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok - %', msg; end $$;
create or replace function pg_temp.t(p_habit uuid, d date, st public.target_status) returns uuid language plpgsql as $$
declare h public.habits; v uuid;
begin
  select * into h from public.habits where id = p_habit;
  insert into public.targets (habit_id, user_id, local_date, due_at, status, settled_at)
  values (h.id, h.user_id, d, (d + h.target_time) at time zone 'Europe/Bucharest', st, case when st = 'pending' then null else now() end)
  on conflict (habit_id, local_date) do update set status = excluded.status returning id into v;
  return v;
end $$;


select pg_temp.as_admin();
insert into auth.users (id, email, raw_user_meta_data) values
  ('f1000000-0000-0000-0000-000000000001', 'admin@test', '{"display_name":"Ada","timezone":"Europe/Bucharest"}'),
  ('f2000000-0000-0000-0000-000000000002', 'user@test', '{"display_name":"Uma","timezone":"Europe/Bucharest"}');
insert into public.admins (user_id) values ('f1000000-0000-0000-0000-000000000001');
create temp table fx (k text primary key, v uuid);
grant all on fx to authenticated, service_role;

-- ---------- activity on commitments ----------
select pg_temp.as_user('f2000000-0000-0000-0000-000000000002');
insert into public.habits (user_id, title, target_time, weekdays, activity)
values ('f2000000-0000-0000-0000-000000000002', 'Morning run', '07:00', '{1,2,3,4,5,6,7}', 'running');
insert into fx select 'h', id from public.habits where user_id = 'f2000000-0000-0000-0000-000000000002';
update public.habits set activity = 'gym' where id = (select v from fx where k = 'h');
select pg_temp.ok((select activity = 'gym' from public.habits where id = (select v from fx where k = 'h')), 'the user sets the activity of a commitment');
select pg_temp.expect_error($$update public.habits set activity = 'swimming' where id = (select v from fx where k = 'h')$$, 'check constraint');
update public.habits set activity = null where id = (select v from fx where k = 'h');
select pg_temp.ok((select activity is null from public.habits where id = (select v from fx where k = 'h')), 'null = detect from the title');

-- ---------- usage table is private ----------
select pg_temp.expect_error($$select count(*) from public.ai_usage$$, 'permission denied');
select pg_temp.expect_error($$insert into public.ai_usage (feature, status) values ('verify', 'ok')$$, 'permission denied');
select pg_temp.expect_error($$select count(*) from public.ai_pricing$$, 'permission denied');
select pg_temp.expect_error($$select public.get_ai_usage_overview(30)$$, 'not allowed');
select pg_temp.ok(not public.is_admin(), 'a normal user is not an admin');
select pg_temp.expect_error($$select public.ai_limits_check('f2000000-0000-0000-0000-000000000002', null)$$, 'permission denied');

-- ---------- usage accounting and the overview ----------
select pg_temp.as_service();
insert into public.ai_usage (user_id, feature, provider, model, status, input_tokens, output_tokens, thinking_tokens, total_tokens, latency_ms) values
  ('f2000000-0000-0000-0000-000000000002', 'verify', 'gemini', 'gemini-3.1-flash-lite', 'ok', 1000000, 100000, 0, 1100000, 1200),
  ('f2000000-0000-0000-0000-000000000002', 'verify', 'gemini', 'gemini-3.1-flash-lite', 'quota', null, null, null, null, null),
  ('f2000000-0000-0000-0000-000000000002', 'coach', 'gemini', 'gemini-unpriced', 'ok', 10, 10, null, 20, 300);
select pg_temp.as_user('f1000000-0000-0000-0000-000000000001');
select pg_temp.ok(public.is_admin(), 'the admin is recognised');
select pg_temp.ok((select (o -> 'totals' ->> 'calls')::int = 3 and (o -> 'totals' ->> 'errors')::int = 1
                           and (o -> 'totals' ->> 'total_tokens')::bigint = 1100020 from (select public.get_ai_usage_overview(30) o) x),
                  'overview counts calls, errors and tokens');
-- 1M input × $0.25 + 0.1M output × $1.50 = $0.40
select pg_temp.ok((select (o -> 'totals' ->> 'est_cost_usd')::numeric = 0.4 and (o -> 'totals' ->> 'unpriced_calls')::int = 1
                     from (select public.get_ai_usage_overview(30) o) x), 'estimated cost uses published prices; unpriced models are counted apart');
select pg_temp.ok((select o -> 'errors' -> 0 ->> 'status' = 'quota' from (select public.get_ai_usage_overview(30) o) x), 'errors are grouped by type');
select pg_temp.ok((select jsonb_array_length(o -> 'by_model') = 2 from (select public.get_ai_usage_overview(30) o) x), 'usage per model');

-- ---------- limits ----------
select pg_temp.as_admin();
update public.app_config set value = 2 where key = 'ai_verify_daily_limit';
insert into fx values ('t', pg_temp.t((select v from fx where k = 'h'), current_date + 1, 'pending'));
select pg_temp.ok(public.ai_limits_check('f2000000-0000-0000-0000-000000000002', (select v from fx where k = 't')) = 'daily_limit', 'daily AI analyses are capped per user');
update public.app_config set value = 40 where key = 'ai_verify_daily_limit';
select pg_temp.ok(public.ai_limits_check('f2000000-0000-0000-0000-000000000002', (select v from fx where k = 't')) is null, 'under the limits nothing is blocked');
update public.app_config set value = 1 where key = 'proof_attempts_per_target';
insert into public.capture_sessions (id, user_id, target_id, expires_at) values ('f3000000-0000-0000-0000-0000000000c1', 'f2000000-0000-0000-0000-000000000002', (select v from fx where k = 't'), now());
insert into public.proofs (user_id, target_id, capture_session_id, storage_path, analysis)
values ('f2000000-0000-0000-0000-000000000002', (select v from fx where k = 't'), 'f3000000-0000-0000-0000-0000000000c1', 'u/x.jpg',
        '{"status":"NEEDS_MORE_EVIDENCE","missing":["The gym or the equipment you used"]}');
select pg_temp.ok(public.ai_limits_check('f2000000-0000-0000-0000-000000000002', (select v from fx where k = 't')) = 'target_attempts', 'submissions per target are capped');
update public.app_config set value = 6 where key = 'proof_attempts_per_target';

-- ---------- the analysis is visible to its owner only ----------
select pg_temp.as_user('f2000000-0000-0000-0000-000000000002');
select pg_temp.ok((select analysis -> 'missing' ->> 0 = 'The gym or the equipment you used' from public.proofs where target_id = (select v from fx where k = 't')), 'the owner reads the analysis');
select pg_temp.as_user('f1000000-0000-0000-0000-000000000001');
select pg_temp.ok((select count(*) = 0 from public.proofs where target_id = (select v from fx where k = 't')), 'nobody else does');
select pg_temp.as_admin();

\echo AI TESTS PASSED
