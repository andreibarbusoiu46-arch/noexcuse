-- Phase 5 tests: free-tier limits enforced by the database, achievements.
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
  values (h.id, h.user_id, d, (d + time '07:00') at time zone 'Europe/Bucharest', st, case when st = 'pending' then null else now() end)
  on conflict (habit_id, local_date) do update set status = excluded.status returning id into v;
  return v;
end $$;

select pg_temp.as_admin();
insert into auth.users (id, email, raw_user_meta_data) values
  ('d5000000-0000-0000-0000-000000000005', 'free@test', '{"display_name":"Free","timezone":"Europe/Bucharest"}'),
  ('d6000000-0000-0000-0000-000000000006', 'prem@test', '{"display_name":"Prem","timezone":"Europe/Bucharest"}');
insert into public.entitlements (user_id, is_active, expires_at) values ('d6000000-0000-0000-0000-000000000006', true, now() + interval '30 days');

-- ---------- free: two active commitments ----------
select pg_temp.as_user('d5000000-0000-0000-0000-000000000005');
insert into public.habits (user_id, title, target_time, weekdays) values
  ('d5000000-0000-0000-0000-000000000005', 'One', '06:00', '{1}'), ('d5000000-0000-0000-0000-000000000005', 'Two', '06:30', '{1}');
select pg_temp.expect_error($$insert into public.habits (user_id, title, target_time, weekdays) values ('d5000000-0000-0000-0000-000000000005', 'Three', '07:00', '{1}')$$, 'Free accounts can have 2 active commitments');
insert into public.habits (user_id, title, target_time, weekdays, is_active) values ('d5000000-0000-0000-0000-000000000005', 'Paused', '07:00', '{1}', false);
select pg_temp.ok((select count(*) = 3 from public.habits), 'a paused third commitment is allowed');
select pg_temp.expect_error($$update public.habits set is_active = true where title = 'Paused'$$, 'Free accounts');
update public.habits set is_active = false where title = 'Two';
update public.habits set is_active = true where title = 'Paused';
select pg_temp.ok((select count(*) = 2 from public.habits where is_active), 'pause one, activate another');
update public.habits set title = 'One renamed' where title = 'One';
select pg_temp.ok((select count(*) = 1 from public.habits where title = 'One renamed'), 'editing an active commitment is unaffected');
select pg_temp.ok((select (public.get_plan() ->> 'premium')::boolean = false and (public.get_plan() ->> 'active_commitments')::int = 2
                          and (public.get_plan() ->> 'free_max_commitments')::int = 2), 'get_plan reports the limit');
select pg_temp.expect_error($$select public.start_challenge((select id from public.habits where title = 'One renamed'), 'discipline-30')$$, 'Challenges are part of Premium');
select pg_temp.expect_error($$update public.habits set verification_level = 'strict'$$, 'premium_required');

-- ---------- premium: no limit ----------
select pg_temp.as_user('d6000000-0000-0000-0000-000000000006');
insert into public.habits (user_id, title, target_time, weekdays)
select 'd6000000-0000-0000-0000-000000000006', 'P' || i, '05:00', '{1}' from generate_series(1, 4) i;
select pg_temp.ok((select count(*) = 4 from public.habits where is_active), 'Premium: more than two active commitments');
select pg_temp.ok((select (public.get_plan() ->> 'premium')::boolean), 'get_plan: premium');

-- ---------- achievements ----------
select pg_temp.as_admin();
insert into public.habits (id, user_id, title, target_time, weekdays, is_active)
values ('d5000000-0000-0000-0000-0000000000aa', 'd5000000-0000-0000-0000-000000000005', 'Ach', '07:00', '{1,2,3,4,5,6,7}', false);
create temp table w as select (date_trunc('week', now() at time zone 'Europe/Bucharest')::date - 14) as mon;
-- A perfect week two weeks ago (7/7), then a miss and a verified comeback last week.
select pg_temp.t('d5000000-0000-0000-0000-0000000000aa', (select mon from w) + i, 'verified') from generate_series(0, 6) i;
select pg_temp.t('d5000000-0000-0000-0000-0000000000aa', (select mon from w) + 7, 'missed');
select pg_temp.t('d5000000-0000-0000-0000-0000000000aa', (select mon from w) + 8, 'verified');
update public.habits set longest_streak = 7 where id = 'd5000000-0000-0000-0000-0000000000aa';
update public.profiles set total_points = 1000 where id = 'd5000000-0000-0000-0000-000000000005';

select pg_temp.as_service();
create temp table e as select k from public.earned_achievements('d5000000-0000-0000-0000-000000000005') k;
select pg_temp.ok((select array_agg(k order by k) from e) = array['comeback', 'first_proof', 'perfect_week', 'points_1000', 'streak_7'],
                  'earned: first proof, 7-day streak, perfect week, comeback, 1,000 points');
select pg_temp.ok((select count(*) = 5 from public.award_achievements('d5000000-0000-0000-0000-000000000005')), 'awarded once');
select pg_temp.ok((select count(*) = 0 from public.award_achievements('d5000000-0000-0000-0000-000000000005')), 'never twice');
select pg_temp.ok((select count(*) = 0 from public.earned_achievements('d6000000-0000-0000-0000-000000000006')), 'nothing earned without a record');

select pg_temp.as_user('d5000000-0000-0000-0000-000000000005');
select pg_temp.ok((select jsonb_array_length(public.get_achievements()) = (select count(*) from public.achievement_defs)), 'the full catalog is listed');
select pg_temp.ok((select count(*) = 5 from jsonb_array_elements(public.get_achievements()) x where x ->> 'unlocked_at' is not null), 'with five unlocked');
select pg_temp.expect_error($$insert into public.achievements (user_id, key) values ('d5000000-0000-0000-0000-000000000005', 'streak_100')$$, 'permission denied');
select pg_temp.expect_error($$select public.award_achievements('d5000000-0000-0000-0000-000000000005')$$, 'permission denied');
select pg_temp.as_user('d6000000-0000-0000-0000-000000000006');
select pg_temp.ok((select count(*) = 0 from public.achievements), 'achievements are private');

-- Cron path: new ledger activity → newly earned achievements returned once (for the push).
select pg_temp.as_admin();
update public.profiles set total_points = 5000 where id = 'd5000000-0000-0000-0000-000000000005';
insert into public.score_events (user_id, habit_id, target_id, delta, reason, streak_after)
values ('d5000000-0000-0000-0000-000000000005', 'd5000000-0000-0000-0000-0000000000aa',
        (select id from public.targets where habit_id = 'd5000000-0000-0000-0000-0000000000aa' and status = 'verified' order by due_at desc limit 1), 50, 'verified', 1);
select pg_temp.as_service();
select pg_temp.ok((select count(*) = 1 and min(key) = 'points_5000' and min(title) = '5,000 points'
                     from public.award_achievements_recent(now() - interval '1 minute') where user_id = 'd5000000-0000-0000-0000-000000000005'), 'cron returns newly earned achievements');

select pg_temp.as_admin();
delete from auth.users where id in ('d5000000-0000-0000-0000-000000000005', 'd6000000-0000-0000-0000-000000000006');
select pg_temp.ok((select count(*) = 0 from public.achievements where user_id::text like 'd5%'), 'account deletion removes achievements');
\echo PHASE 5 TESTS PASSED
