-- Phase 1 tests: points config, append-only ledger, commitment details, archive,
-- Discipline Score, challenges, War Room. Runs after 10_scoring_and_security.sql.
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
-- A proof received exactly at the target's due time (inside the window), judged by the server.
create or replace function pg_temp.proof_for(p_target uuid) returns uuid language plpgsql as $$
declare t public.targets; s uuid; p uuid;
begin
  select * into t from public.targets where id = p_target;
  insert into public.capture_sessions (user_id, target_id, issued_at, expires_at)
  values (t.user_id, t.id, t.due_at - interval '30 seconds', t.due_at + interval '3 minutes') returning id into s;
  insert into public.proofs (user_id, target_id, capture_session_id, storage_path, received_at)
  values (t.user_id, t.id, s, t.user_id || '/' || t.id, t.due_at) returning id into p;
  return p;
end $$;

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('cccccccc-0000-0000-0000-000000000003', 'c@test', '{"display_name":"Cara","timezone":"Europe/Bucharest"}'),
  ('dddddddd-0000-0000-0000-000000000004', 'd@test', '{"display_name":"Dan","timezone":"Europe/Bucharest"}'),
  ('eeeeeeee-0000-0000-0000-000000000005', 'e@test', '{"display_name":"Eva","timezone":"Europe/Bucharest"}');
-- Challenges and extra commitments are Premium since Phase 5.
insert into public.entitlements (user_id, is_active, expires_at)
select id, true, now() + interval '30 days' from auth.users where email in ('c@test', 'd@test', 'e@test');

-- ---------- points come from app_config ----------
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000004');
insert into public.habits (user_id, title, target_time, weekdays, category)
values ('dddddddd-0000-0000-0000-000000000004', 'Workout — 30 min',
        ((now() at time zone 'Europe/Bucharest') + interval '2 hours')::time, '{1,2,3,4,5,6,7}', 'fitness');
select pg_temp.ok((select count(*) = 2 from public.targets), 'commitment with category creates today + tomorrow');
select pg_temp.ok((select category = 'fitness' from public.habits), 'category stored');
select pg_temp.ok((select count(*) >= 3 from public.app_config), 'clients can read the points configuration');
select pg_temp.expect_error($$update public.app_config set value = 1000 where key = 'points_verified'$$, 'permission denied');

select pg_temp.as_service();
select pg_temp.ok((select (public.apply_verdict(pg_temp.proof_for(
          (select id from public.targets where user_id = 'dddddddd-0000-0000-0000-000000000004' order by due_at limit 1)),
          'verified', 'ok', 0.9, 't', null) ->> 'points_delta')::integer = 50), 'verified uses points_verified (50)');
reset role;
update public.app_config set value = 60 where key = 'points_verified';
select pg_temp.as_service();
select pg_temp.ok((select (public.apply_verdict(pg_temp.proof_for(
          (select id from public.targets where user_id = 'dddddddd-0000-0000-0000-000000000004' and status = 'pending' order by due_at limit 1)),
          'verified', 'ok', 0.9, 't', null) ->> 'points_delta')::integer = 60), 'changing the config changes the next award (60)');
reset role;
update public.app_config set value = 50 where key = 'points_verified';
select pg_temp.ok((select total_points = 110 from public.profiles where id = 'dddddddd-0000-0000-0000-000000000004'), 'total follows the ledger (50 + 60)');
select pg_temp.ok((select sum(delta) = 110 from public.score_events where user_id = 'dddddddd-0000-0000-0000-000000000004'), 'ledger sums to the total');

-- ---------- the ledger is append-only for everyone ----------
select pg_temp.as_service();
select pg_temp.expect_error($$update public.score_events set delta = 5000$$, 'append-only');
select pg_temp.expect_error($$delete from public.score_events$$, 'append-only');
reset role;
select pg_temp.expect_error($$update public.score_events set delta = 5000$$, 'append-only');
select pg_temp.expect_error($$delete from public.score_events where user_id = 'dddddddd-0000-0000-0000-000000000004'$$, 'append-only');
select pg_temp.expect_error($$insert into public.score_events (user_id, habit_id, target_id, delta, reason, streak_after)
                              select user_id, habit_id, id, 0, 'missed', 0 from public.targets limit 1$$, 'score_events_sign');
select pg_temp.expect_error($$insert into public.score_events (user_id, habit_id, target_id, delta, reason, streak_after)
                              select user_id, habit_id, id, 100, 'missed', 0 from public.targets limit 1$$, 'score_events_sign');

-- ---------- commitment details + archive ----------
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000004');
select pg_temp.expect_error($$insert into public.habits (user_id, title, target_time, weekdays, category)
                              values ('dddddddd-0000-0000-0000-000000000004', 'X', '07:00', '{1}', 'custom')$$, 'habits_custom_category');
select pg_temp.expect_error($$insert into public.habits (user_id, title, target_time, weekdays, category)
                              values ('dddddddd-0000-0000-0000-000000000004', 'X', '07:00', '{1}', 'gaming')$$, 'check constraint');
insert into public.habits (user_id, title, target_time, weekdays, category, custom_category, description, notes)
values ('dddddddd-0000-0000-0000-000000000004', 'Guitar practice', ((now() at time zone 'Europe/Bucharest') + interval '3 hours')::time,
        '{1,2,3,4,5,6,7}', 'custom', 'Music', 'Scales then one song', 'Private: aim for the bridge');
select pg_temp.ok((select custom_category = 'Music' and notes like 'Private%' from public.habits where title = 'Guitar practice'), 'custom category, description and notes stored');
select pg_temp.expect_error($$update public.habits set notes = repeat('x', 1001) where title = 'Guitar practice'$$, 'check constraint');
update public.habits set archived_at = now() where title = 'Guitar practice';
select pg_temp.ok((select not is_active from public.habits where title = 'Guitar practice'), 'archiving deactivates the commitment');
select pg_temp.ok((select count(*) = 0 from public.targets t join public.habits h on h.id = t.habit_id
                    where h.title = 'Guitar practice' and t.status = 'pending'), 'archiving removes windows that have not opened');
select pg_temp.ok((select count(*) = 1 from public.audit_log where action = 'commitment_archived'), 'archive is written to the audit log');
-- (Phase 7 allows restoring an archived commitment; see 90_phase7.sql.)
update public.habits set is_active = true where title = 'Guitar practice';
select pg_temp.ok((select not is_active from public.habits where title = 'Guitar practice'), 'an archived commitment cannot be re-activated');
select pg_temp.expect_error($$delete from public.habits where title = 'Guitar practice'$$, 'permission denied');

-- ---------- Discipline Score: exact formula on a known history ----------
reset role;
insert into public.habits (id, user_id, title, target_time, weekdays, is_active)
values ('c0000000-0000-0000-0000-00000000000c', 'cccccccc-0000-0000-0000-000000000003', 'Read 20 pages', '07:00', '{1,2,3,4,5,6,7}', false);
-- 10 settled days (today − 0 … today − 9): misses on day 2 and day 8, the rest verified.
insert into public.targets (habit_id, user_id, local_date, due_at, status, settled_at)
select 'c0000000-0000-0000-0000-00000000000c', 'cccccccc-0000-0000-0000-000000000003', d,
       (d + time '07:00') at time zone 'Europe/Bucharest',
       case when (current_date - d) in (2, 8) then 'missed' else 'verified' end::public.target_status, now()
  from (select ((now() at time zone 'Europe/Bucharest')::date - g) as d from generate_series(0, 9) g) x;
update public.habits set current_streak = 2 where id = 'c0000000-0000-0000-0000-00000000000c';

select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
-- completion 8/10 = .80, recent 6/7 = .857, consistency 8/10 days clean = .80, streak 2/21 = .095
-- score = 100 × (.45·.80 + .25·.857 + .20·.80 + .10·.095) = 74.4 → 74
select pg_temp.ok((select (public.get_discipline() -> 'current' ->> 'score')::integer = 74), 'Discipline Score follows the published formula (74)');
select pg_temp.ok((select (public.get_discipline() -> 'current' -> 'components' ->> 'completion')::integer = 80), 'completion component = 80');
select pg_temp.ok((select (public.get_discipline() -> 'current' ->> 'provisional')::boolean = false), 'not provisional with 10 settled targets');
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000004');
select pg_temp.ok((select public.compute_discipline_score('cccccccc-0000-0000-0000-000000000003') is null), 'nobody can read another user''s score');
select pg_temp.ok((select (public.get_discipline() -> 'current' ->> 'provisional')::boolean), 'two settled targets → provisional');
select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000005');
select pg_temp.ok((select public.get_discipline() -> 'current' -> 'score' = 'null'::jsonb), 'no settled targets → no score yet');

select pg_temp.as_service();
select pg_temp.ok((select public.snapshot_discipline_scores() >= 3), 'daily snapshot runs for every profile');
select pg_temp.ok((select score = 74 from public.discipline_scores where user_id = 'cccccccc-0000-0000-0000-000000000003'), 'snapshot stores the score');
select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select pg_temp.ok((select jsonb_array_length(public.get_discipline() -> 'history') = 1), 'history is returned to the owner');
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000004');
select pg_temp.ok((select count(*) = 0 from public.discipline_scores where user_id = 'cccccccc-0000-0000-0000-000000000003'), 'score history is private');

-- ---------- challenges ----------
select pg_temp.as_user('cccccccc-0000-0000-0000-000000000003');
select pg_temp.expect_error($$select public.start_challenge('c0000000-0000-0000-0000-00000000000c', 'early-7')$$, 'must be active');
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000004');
select pg_temp.ok((select jsonb_array_length(public.get_challenges() -> 'templates') >= 6), 'predefined challenges');
select pg_temp.expect_error($$select public.start_challenge('c0000000-0000-0000-0000-00000000000c', 'early-7')$$, 'not found');
select pg_temp.expect_error($$insert into public.challenges (user_id, habit_id, title, start_date, end_date, weekdays, required_days, bonus_points)
                              select user_id, id, 'x', current_date, current_date, '{1}', 1, 99999 from public.habits limit 1$$, 'permission denied');
select pg_temp.expect_error($$select public.start_challenge((select id from public.habits where title = 'Workout — 30 min'), null, 'Mine', 2)$$, '3–90 days');
select pg_temp.expect_error($$select public.start_challenge((select id from public.habits where title = 'Workout — 30 min'), null, 'Mine', 9, 4)$$, 'allowed misses');
select public.start_challenge((select id from public.habits where title = 'Workout — 30 min'), 'early-7') is not null;
select pg_temp.ok((select required_days = 7 and bonus_points = 70 and status = 'active' from public.challenges), 'early-7: 7 required days, bonus 7 × 10');
select pg_temp.expect_error($$select public.start_challenge((select id from public.habits where title = 'Workout — 30 min'), 'fitness-30')$$, 'already has an active challenge');
select pg_temp.ok((select (public.challenge_progress(id) ->> 'lost')::integer = 0 from public.challenges), 'fresh challenge: nothing lost');
select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000005');
select pg_temp.ok((select not public.abandon_challenge((select id from public.challenges limit 1))), 'others cannot abandon my challenge');
select pg_temp.ok((select public.challenge_progress('00000000-0000-0000-0000-000000000000') is null), 'progress of unknown/other challenges is hidden');

-- Fast-forward: the challenge ran over the last 7 days and every day was verified.
reset role;
update public.challenges set start_date = (now() at time zone 'Europe/Bucharest')::date - 7,
                             end_date   = (now() at time zone 'Europe/Bucharest')::date - 1;
insert into public.targets (habit_id, user_id, local_date, due_at, status, settled_at)
select h.id, h.user_id, d, (d + time '07:00') at time zone 'Europe/Bucharest', 'verified', now()
  from public.habits h, (select ((now() at time zone 'Europe/Bucharest')::date - g) as d from generate_series(1, 7) g) x
 where h.title = 'Workout — 30 min'
on conflict (habit_id, local_date) do update set status = 'verified';
select pg_temp.as_service();
select pg_temp.ok((select public.settle_challenges() = 1), 'settle finishes the challenge');
reset role;
select pg_temp.ok((select status = 'completed' from public.challenges), 'challenge completed');
select pg_temp.ok((select count(*) = 1 and sum(delta) = 70 from public.score_events where reason::text = 'challenge_bonus'), 'bonus written to the ledger once');
select pg_temp.ok((select total_points = 180 from public.profiles where id = 'dddddddd-0000-0000-0000-000000000004'), 'bonus added to the total (110 + 70)');
select pg_temp.as_service();
select pg_temp.ok((select public.settle_challenges() = 0), 'nothing left to settle');
reset role;
select pg_temp.ok((select count(*) = 1 from public.score_events where reason::text = 'challenge_bonus'), 'no duplicate bonus');

-- A zero-miss challenge with one missed day fails, and pays nothing.
insert into public.habits (id, user_id, title, target_time, weekdays, is_active)
values ('e0000000-0000-0000-0000-00000000000e', 'eeeeeeee-0000-0000-0000-000000000005', 'Cold shower',
        ((now() at time zone 'Europe/Bucharest') + interval '4 hours')::time, '{1,2,3,4,5,6,7}', true);
select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000005');
select public.start_challenge('e0000000-0000-0000-0000-00000000000e', 'no-excuses-30') is not null;
reset role;
update public.challenges set start_date = (now() at time zone 'Europe/Bucharest')::date - 3
 where habit_id = 'e0000000-0000-0000-0000-00000000000e';
insert into public.targets (habit_id, user_id, local_date, due_at, status, settled_at)
select 'e0000000-0000-0000-0000-00000000000e', 'eeeeeeee-0000-0000-0000-000000000005', d,
       (d + time '07:00') at time zone 'Europe/Bucharest', case when g = 2 then 'missed' else 'verified' end::public.target_status, now()
  from (select g, ((now() at time zone 'Europe/Bucharest')::date - g) as d from generate_series(1, 3) g) x;
select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000005');
select pg_temp.ok((select (public.challenge_progress(id) ->> 'lost')::integer = 1 from public.challenges where habit_id = 'e0000000-0000-0000-0000-00000000000e'), 'a missed day counts as lost');
select pg_temp.as_service();
select public.settle_challenges() >= 0;
reset role;
select pg_temp.ok((select status = 'failed' from public.challenges where habit_id = 'e0000000-0000-0000-0000-00000000000e'), 'zero-miss challenge fails after one miss');
select pg_temp.ok((select count(*) = 0 from public.score_events where user_id = 'eeeeeeee-0000-0000-0000-000000000005'), 'a failed challenge pays no bonus');

-- Pausing a commitment mid-challenge does not hide the days it skipped.
select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000005');
select public.start_challenge('e0000000-0000-0000-0000-00000000000e', null, 'Showers', 9, 3) is not null;
reset role;
update public.challenges set start_date = (now() at time zone 'Europe/Bucharest')::date - 6 where status = 'active' and habit_id = 'e0000000-0000-0000-0000-00000000000e';
select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000005');
select pg_temp.ok((select (public.challenge_progress(id) ->> 'lost')::integer >= 3 from public.challenges where status = 'active'),
                  'days with no target (paused) count as lost');
select pg_temp.ok((select public.abandon_challenge(id) from public.challenges where status = 'active'), 'owner can abandon');

-- ---------- War Room ----------
select pg_temp.as_user('dddddddd-0000-0000-0000-000000000004');
select pg_temp.ok((select (public.get_war_room() ->> 'total_points')::integer = 180), 'War Room: total points');
select pg_temp.ok((select jsonb_array_length(public.get_war_room() -> 'recent') = 3), 'War Room: recent ledger entries (2 targets + 1 bonus)');
select pg_temp.ok((select public.get_war_room() -> 'recent' -> 0 ->> 'title' = 'Early Mornings' or
                          public.get_war_room() -> 'recent' -> 0 ->> 'title' in ('7 Days of Early Mornings', '5 AM Protocol')), 'War Room: bonus row shows the challenge title');
select pg_temp.ok((select (public.get_war_room() -> 'week' ->> 'settled')::integer >= 7), 'War Room: weekly numbers come from targets');
select pg_temp.as_user('eeeeeeee-0000-0000-0000-000000000005');
select pg_temp.ok((select (public.get_war_room() ->> 'total_points')::integer = 0), 'War Room only shows the caller''s data');

-- ---------- account deletion still cascades through the append-only ledger ----------
reset role;
delete from auth.users where id = 'dddddddd-0000-0000-0000-000000000004';
select pg_temp.ok((select count(*) = 0 from public.score_events where user_id = 'dddddddd-0000-0000-0000-000000000004'), 'deleting an account removes its ledger rows');
select pg_temp.ok((select count(*) = 0 from public.challenges where user_id = 'dddddddd-0000-0000-0000-000000000004'), 'and its challenges');

reset role;
\echo PHASE 1 TESTS PASSED
