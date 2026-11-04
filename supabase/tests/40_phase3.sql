-- Phase 3 tests: coach context, weekly reports, smart reminders, notification preferences.
\set QUIET on
\pset tuples_only on

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false); execute 'set role authenticated'; end $$;
create or replace function pg_temp.as_service() returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', '', false); execute 'set role service_role'; end $$;
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
-- A target on a given local date at 07:00 Bucharest with a given status.
create or replace function pg_temp.t(p_habit uuid, d date, st public.target_status) returns uuid language plpgsql as $$
declare h public.habits; v uuid;
begin
  select * into h from public.habits where id = p_habit;
  insert into public.targets (habit_id, user_id, local_date, due_at, status, settled_at)
  values (h.id, h.user_id, d, (d + time '07:00') at time zone 'Europe/Bucharest', st, case when st = 'pending' then null else now() end)
  on conflict (habit_id, local_date) do update set status = excluded.status returning id into v;
  return v;
end $$;

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('b3000000-0000-0000-0000-000000000003', 'h@test', '{"display_name":"Hana","timezone":"Europe/Bucharest"}'),
  ('b4000000-0000-0000-0000-000000000004', 'i@test', '{"display_name":"Ivo","timezone":"Europe/Bucharest"}');
insert into public.habits (id, user_id, title, target_time, weekdays, notes, is_active) values
  ('b3000000-0000-0000-0000-0000000000a1', 'b3000000-0000-0000-0000-000000000003', 'Run 5 km', '07:00', '{1,2,3,4,5,6,7}', 'my private secret note', false),
  ('b3000000-0000-0000-0000-0000000000a2', 'b3000000-0000-0000-0000-000000000003', 'Read 20 pages', '07:00', '{1,2,3,4,5,6,7}', null, false);

create temp table w as select (date_trunc('week', now() at time zone 'Europe/Bucharest')::date - 7) as mon;
grant select on w to service_role, authenticated;
-- Last week: Run verified Mon–Fri, missed Sat, rejected Sun (5/7). Read verified Mon, missed Tue–Wed (1/3).
select pg_temp.t('b3000000-0000-0000-0000-0000000000a1', (select mon from w) + i, case when i < 5 then 'verified' when i = 5 then 'missed' else 'rejected' end::public.target_status)
  from generate_series(0, 6) i;
select pg_temp.t('b3000000-0000-0000-0000-0000000000a2', (select mon from w), 'verified');
select pg_temp.t('b3000000-0000-0000-0000-0000000000a2', (select mon from w) + 1, 'missed');
select pg_temp.t('b3000000-0000-0000-0000-0000000000a2', (select mon from w) + 2, 'missed');
-- The week before: 1 of 2 → previous rate 50.
select pg_temp.t('b3000000-0000-0000-0000-0000000000a2', (select mon from w) - 3, 'verified');
select pg_temp.t('b3000000-0000-0000-0000-0000000000a2', (select mon from w) - 2, 'missed');

-- ---------- weekly report numbers ----------
select pg_temp.as_service();
create temp table r as select public.build_weekly_report('b3000000-0000-0000-0000-000000000003', (select mon from w)) as d;
select pg_temp.ok((select (d ->> 'settled')::int = 10 and (d ->> 'verified')::int = 6 and (d ->> 'missed')::int = 3 and (d ->> 'rejected')::int = 1 from r), 'report counts: 6 of 10 verified, 3 missed, 1 rejected');
select pg_temp.ok((select (d ->> 'success_rate')::int = 60 and (d ->> 'previous_success_rate')::int = 50 from r), 'success rate 60% vs 50% the week before');
select pg_temp.ok((select d -> 'best' ->> 'title' = 'Run 5 km' and d -> 'worst' ->> 'title' = 'Read 20 pages' from r), 'best and worst commitment');
select pg_temp.ok((select d ->> 'best_day' = 'Monday' from r), 'best day is Monday (2/2)');
select pg_temp.ok((select d ->> 'hardest_day' in ('Tuesday', 'Wednesday', 'Saturday', 'Sunday') from r), 'hardest day is a day with a miss');

-- ---------- generation runs Monday from 06:00 local, once ----------
create temp table gen1 as select * from public.generate_weekly_reports(((select mon from w) + 7 + time '05:30') at time zone 'Europe/Bucharest');
select pg_temp.ok((select count(*) = 0 from gen1 where user_id = 'b3000000-0000-0000-0000-000000000003'), 'not before 06:00 on Monday');
create temp table gen2 as select * from public.generate_weekly_reports(((select mon from w) + 8 + time '09:00') at time zone 'Europe/Bucharest');
select pg_temp.ok((select count(*) = 0 from gen2 where user_id = 'b3000000-0000-0000-0000-000000000003'), 'not on Tuesday');
create temp table gen3 as select * from public.generate_weekly_reports(((select mon from w) + 7 + time '06:05') at time zone 'Europe/Bucharest');
select pg_temp.ok((select count(*) = 1 and min(week_start) = (select mon from w) from gen3 where user_id = 'b3000000-0000-0000-0000-000000000003'), 'Monday 06:05: one report for last week');
select pg_temp.ok((select count(*) = 0 from gen3 where user_id = 'b4000000-0000-0000-0000-000000000004'), 'no report for a user with nothing scheduled');
create temp table gen4 as select * from public.generate_weekly_reports(((select mon from w) + 7 + time '07:00') at time zone 'Europe/Bucharest');
select pg_temp.ok((select count(*) = 0 from gen4 where user_id = 'b3000000-0000-0000-0000-000000000003'), 'generated once');

-- ---------- reports are a Premium read ----------
select pg_temp.as_user('b3000000-0000-0000-0000-000000000003');
select pg_temp.expect_error($$select * from public.weekly_reports$$, 'permission denied');
select pg_temp.ok((select (public.get_weekly_reports() ->> 'locked')::boolean and (public.get_weekly_reports() ->> 'count')::int = 1
                          and jsonb_array_length(public.get_weekly_reports() -> 'reports') = 0), 'free: locked, count only');
reset role;
insert into public.entitlements (user_id, is_active, expires_at) values ('b3000000-0000-0000-0000-000000000003', true, now() + interval '30 days');
select pg_temp.as_user('b3000000-0000-0000-0000-000000000003');
select pg_temp.ok((select not (public.get_weekly_reports() ->> 'locked')::boolean
                          and (public.get_weekly_reports() -> 'reports' -> 0 -> 'data' ->> 'verified')::int = 6), 'premium: the report');
select pg_temp.as_user('b4000000-0000-0000-0000-000000000004');
select pg_temp.ok((select (public.get_weekly_reports() ->> 'count')::int = 0), 'reports are private');

-- ---------- coach context ----------
select pg_temp.as_service();
create temp table c as select public.get_coach_context('b3000000-0000-0000-0000-000000000003') as d;
select pg_temp.ok((select jsonb_array_length(d -> 'commitments') = 2 from c), 'coach sees the commitments');
select pg_temp.ok((select position('secret' in d::text) = 0 from c), 'coach never sees private notes');
select pg_temp.ok((select d -> 'commitments' -> 0 -> 'last_28' ? 'verified' from c), 'per-commitment results over 28 days');
select pg_temp.ok((select jsonb_typeof(d -> 'recent_failures') = 'array' and jsonb_typeof(d -> 'by_weekday') = 'object' from c), 'failures and weekday rates');
reset role;
insert into public.coach_messages (user_id, role, content) values
  ('b3000000-0000-0000-0000-000000000003', 'user', 'hi'), ('b3000000-0000-0000-0000-000000000003', 'coach', 'hello'),
  ('b3000000-0000-0000-0000-000000000003', 'user', 'again');
select pg_temp.as_service();
select pg_temp.ok(public.coach_messages_today('b3000000-0000-0000-0000-000000000003') = 2, 'daily limit counts the user''s own messages');
select pg_temp.as_user('b3000000-0000-0000-0000-000000000003');
select pg_temp.expect_error($$select public.get_coach_context('b3000000-0000-0000-0000-000000000003')$$, 'permission denied');
select pg_temp.expect_error($$insert into public.coach_messages (user_id, role, content) values ('b3000000-0000-0000-0000-000000000003', 'coach', 'fake')$$, 'permission denied');
select pg_temp.ok((select count(*) = 3 from public.coach_messages), 'the user reads their conversation');
select pg_temp.as_user('b4000000-0000-0000-0000-000000000004');
select pg_temp.ok((select count(*) = 0 from public.coach_messages), 'conversations are private');

-- ---------- smart reminders ----------
-- Run has 2 misses (missed + rejected) in its last 7 settled → heads-up for its next window.
reset role;
update public.habits set is_active = true where id = 'b3000000-0000-0000-0000-0000000000a1';
create temp table nx as select pg_temp.t('b3000000-0000-0000-0000-0000000000a1', (now() at time zone 'Europe/Bucharest')::date + 20, 'pending') as id;
grant select on nx to service_role;
create temp table due as select due_at from public.targets where id = (select id from nx);
grant select on due to service_role;
select pg_temp.as_service();
select pg_temp.ok((select count(*) = 1 from public.smart_reminder_candidates((select due_at from due) - interval '74 minutes')
                    where kind = 'heads_up' and target_id = (select id from nx) and misses = 2), 'heads-up 60 min before the window when a commitment is often missed');
select pg_temp.ok((select count(*) = 0 from public.smart_reminder_candidates((select due_at from due) - interval '30 minutes') where target_id = (select id from nx)), 'nothing between heads-up and last call');
select pg_temp.ok((select count(*) = 1 from public.smart_reminder_candidates((select due_at from due) + interval '11 minutes')
                    where kind = 'last_call' and target_id = (select id from nx)), 'last call 5 min before the window closes');
reset role;
insert into public.capture_sessions (id, user_id, target_id, expires_at) values ('b3000000-0000-0000-0000-0000000000c1', 'b3000000-0000-0000-0000-000000000003', (select id from nx), now() + interval '3 minutes');
insert into public.proofs (user_id, target_id, capture_session_id, storage_path) values ('b3000000-0000-0000-0000-000000000003', (select id from nx), 'b3000000-0000-0000-0000-0000000000c1', 'x');
select pg_temp.as_service();
select pg_temp.ok((select count(*) = 0 from public.smart_reminder_candidates((select due_at from due) + interval '11 minutes') where kind = 'last_call' and target_id = (select id from nx)), 'no last call once proof is being verified');
-- The user's switch turns the heads-up off.
select pg_temp.as_user('b3000000-0000-0000-0000-000000000003');
update public.profiles set notify_prefs = notify_prefs || '{"heads_up": false}' where id = 'b3000000-0000-0000-0000-000000000003';
select pg_temp.as_service();
select pg_temp.ok((select count(*) = 0 from public.smart_reminder_candidates((select due_at from due) - interval '74 minutes') where target_id = (select id from nx)), 'preferences are respected');
-- Free accounts get only the basic reminder.
reset role;
update public.profiles set notify_prefs = notify_prefs || '{"heads_up": true}' where id = 'b3000000-0000-0000-0000-000000000003';
delete from public.entitlements where user_id = 'b3000000-0000-0000-0000-000000000003';
select pg_temp.as_service();
select pg_temp.ok((select count(*) = 0 from public.smart_reminder_candidates((select due_at from due) - interval '74 minutes') where target_id = (select id from nx)), 'smart reminders are Premium');
select pg_temp.as_user('b3000000-0000-0000-0000-000000000003');
select pg_temp.expect_error($$select * from public.smart_reminder_candidates(now())$$, 'permission denied');
select pg_temp.expect_error($$update public.profiles set total_points = 1 where id = 'b3000000-0000-0000-0000-000000000003'$$, 'permission denied');

reset role;
delete from auth.users where id in ('b3000000-0000-0000-0000-000000000003', 'b4000000-0000-0000-0000-000000000004');
select pg_temp.ok((select count(*) = 0 from public.weekly_reports where user_id::text like 'b3%') and (select count(*) = 0 from public.coach_messages where user_id::text like 'b3%'), 'account deletion removes reports and coach history');
\echo PHASE 3 TESTS PASSED
