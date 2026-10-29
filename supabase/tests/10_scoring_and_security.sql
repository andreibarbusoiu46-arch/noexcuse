-- NoExcuse database tests. Run after the shim + migrations on a fresh database.
-- Every block raises on failure; psql -v ON_ERROR_STOP=1 makes the run fail fast.
\set QUIET on
\pset tuples_only on

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false);
  execute 'set role authenticated';
end $$;
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

-- ---------- fixtures ----------
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@test', '{"display_name":"Andrei","timezone":"Europe/Bucharest"}'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@test', '{"display_name":"Bianca","timezone":"Not/AZone"}');

select pg_temp.ok((select count(*) = 2 from public.profiles), 'profiles auto-created for new auth users');
select pg_temp.ok((select timezone = 'UTC' from public.profiles where id = 'bbbbbbbb-0000-0000-0000-000000000002'),
                  'invalid sign-up timezone falls back to UTC');

-- ---------- client security ----------
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
-- habit due one hour from now (local), every day → today's (and tomorrow's) targets are generated
insert into public.habits (user_id, title, target_time, weekdays)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'Morning run — 5 km',
        ((now() at time zone 'Europe/Bucharest') + interval '1 hour')::time, '{1,2,3,4,5,6,7}');
select pg_temp.ok((select count(*) >= 1 from public.targets), 'insert habit generates targets (visible to owner)');
select pg_temp.expect_error($$update public.habits set current_streak = 99$$, 'permission denied');
select pg_temp.expect_error($$update public.profiles set total_points = 100000$$, 'permission denied');
select pg_temp.expect_error($$insert into public.score_events (user_id, habit_id, target_id, delta, reason, streak_after)
                              select user_id, habit_id, id, 50, 'verified', 1 from public.targets limit 1$$, 'permission denied');
select pg_temp.expect_error($$update public.targets set status = 'verified'$$, 'permission denied');
select pg_temp.expect_error($$delete from public.habits$$, 'permission denied');
select pg_temp.expect_error($$select public.apply_verdict(gen_random_uuid(), 'verified', '', 1, 'x', '{}')$$, 'permission denied');
select pg_temp.expect_error($$select public.settle_due_targets()$$, 'permission denied');
select pg_temp.expect_error($$insert into public.entitlements (user_id, is_active) values ('aaaaaaaa-0000-0000-0000-000000000001', true)$$, 'permission denied');
select pg_temp.expect_error($$update public.profiles set timezone = 'Mars/Olympus'$$, 'invalid timezone');
update public.profiles set display_name = 'Andrei B.';
select pg_temp.ok((select display_name = 'Andrei B.' from public.profiles), 'owner can edit display name');

select pg_temp.as_user('bbbbbbbb-0000-0000-0000-000000000002');
select pg_temp.ok((select count(*) = 0 from public.habits), 'other users cannot read my habits');
select pg_temp.ok((select count(*) = 0 from public.targets), 'other users cannot read my targets');
select pg_temp.ok((select count(*) = 1 from public.profiles), 'profiles: only own row visible');
select pg_temp.expect_error($$insert into public.habits (user_id, title, target_time, weekdays)
                              values ('aaaaaaaa-0000-0000-0000-000000000001', 'x', '07:00', '{1}')$$, 'row-level security');

select pg_temp.as_user(null);
set role anon;
select pg_temp.expect_error($$select * from public.habits$$, 'permission denied');
select pg_temp.expect_error($$select * from public.get_arena()$$, 'permission denied');

-- ---------- scoring ----------
select pg_temp.as_service();
create temp table fx (k text primary key, v uuid);
grant all on fx to service_role;

-- helper: a target due at p_due for habit of user A, plus a capture session and a proof received at p_recv
create or replace function pg_temp.mk(p_key text, p_date date, p_due timestamptz, p_recv timestamptz) returns uuid language plpgsql as $$
declare h uuid; t uuid; s uuid; p uuid;
begin
  select id into h from public.habits where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' limit 1;
  insert into public.targets (habit_id, user_id, local_date, due_at) values (h, 'aaaaaaaa-0000-0000-0000-000000000001', p_date, p_due) returning id into t;
  insert into public.capture_sessions (user_id, target_id, issued_at, expires_at) values ('aaaaaaaa-0000-0000-0000-000000000001', t, p_recv - interval '30 seconds', p_recv + interval '3 minutes') returning id into s;
  insert into public.proofs (user_id, target_id, capture_session_id, storage_path, received_at) values ('aaaaaaaa-0000-0000-0000-000000000001', t, s, 'a/' || t, p_recv) returning id into p;
  insert into fx values (p_key || ':target', t), (p_key || ':proof', p);
  return p;
end $$;

-- Verified inside window: +50, streak 1. Second call: idempotent.
select pg_temp.mk('v1', date '2030-01-01', now(), now());
select pg_temp.ok(((public.apply_verdict((select v from fx where k='v1:proof'), 'verified', 'Shoes, track, watch visible.', 0.92, 'm', '{}'))->>'points_delta')::int = 50, 'verified → +50');
select pg_temp.ok((select current_streak = 1 and longest_streak = 1 from public.habits limit 1), 'verified → streak 1');
select pg_temp.ok(((public.apply_verdict((select v from fx where k='v1:proof'), 'verified', 'again', 0.92, 'm', '{}'))->>'already_settled')::boolean, 'repeat verdict is a no-op');
select pg_temp.ok((select total_points = 50 from public.profiles where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'no duplicate reward (total 50)');
select pg_temp.ok((select count(*) = 1 from public.score_events), 'exactly one score event');

-- Second verified day → streak 2, longest 2
select pg_temp.mk('v2', date '2030-01-02', now(), now() + interval '14 minutes');
select public.apply_verdict((select v from fx where k='v2:proof'), 'verified', 'ok', 0.9, 'm', '{}');
select pg_temp.ok((select current_streak = 2 and longest_streak = 2 from public.habits limit 1), 'streak grows to 2 (proof at +14 min accepted)');

-- Verified but received outside the window → refused
select pg_temp.mk('late', date '2030-01-03', now() - interval '1 hour', now());
select pg_temp.expect_error(format($$select public.apply_verdict(%L, 'verified', 'x', 0.9, 'm', '{}')$$, (select v from fx where k='late:proof')), 'outside the window');

-- Rejected: −100, streak 0, longest kept
select pg_temp.mk('r', date '2030-01-04', now(), now());
select pg_temp.ok(((public.apply_verdict((select v from fx where k='r:proof'), 'rejected', 'Desk and laptop; no run visible.', 0.95, 'm', '{}'))->>'points_delta')::int = -100, 'rejected → −100');
select pg_temp.ok((select current_streak = 0 and longest_streak = 2 from public.habits limit 1), 'rejected resets streak, keeps longest');
select pg_temp.ok((select status = 'rejected' from public.targets where id = (select v from fx where k='r:target')), 'target marked rejected');

-- Expired submission: −100 and target missed
select pg_temp.mk('e', date '2030-01-05', now() - interval '40 minutes', now());
select pg_temp.ok(((public.apply_verdict((select v from fx where k='e:proof'), 'expired', 'Received after window.', null, null, null))->>'points_delta')::int = -100, 'expired → −100');
select pg_temp.ok((select status = 'missed' from public.targets where id = (select v from fx where k='e:target')), 'expired target marked missed');

-- Insufficient: no score, target stays open; window closes → settle penalises once
select pg_temp.mk('i', date '2030-01-06', now() - interval '10 minutes', now());
select pg_temp.ok(((public.apply_verdict((select v from fx where k='i:proof'), 'insufficient', 'Too dark.', 0.4, 'm', '{}'))->>'points_delta')::int = 0, 'insufficient → 0');
select pg_temp.ok((select status = 'pending' from public.targets where id = (select v from fx where k='i:target')), 'insufficient keeps target open');
select pg_temp.ok((select count(*) = 0 from public.settle_due_targets(now()) where target_id = (select v from fx where k='i:target')), 'settle does nothing while window is open');
select pg_temp.ok((select status = 'missed' from public.targets where id = (select v from fx where k='late:target')), 'late-only proof → settled as missed');
select pg_temp.ok((select count(*) >= 1 from public.settle_due_targets(now() + interval '30 minutes') where target_id = (select v from fx where k='i:target')), 'window closed → settled as missed');
select pg_temp.ok((select count(*) = 0 from public.settle_due_targets(now() + interval '30 minutes') where target_id = (select v from fx where k='i:target')), 'settle is idempotent');
select pg_temp.ok((select count(*) = 1 from public.score_events where target_id = (select v from fx where k='i:target') and delta = -100 and reason = 'missed'), 'one missed penalty recorded');

-- Verification error in window: settle holds it back; excuse closes it with no score
select pg_temp.mk('err', date '2030-01-07', now() - interval '10 minutes', now());
select public.apply_verdict((select v from fx where k='err:proof'), 'error', 'AI timeout', null, 'm', '{}');
select pg_temp.ok((select count(*) = 0 from public.settle_due_targets(now() + interval '2 hours') where target_id = (select v from fx where k='err:target')), 'our outage is never penalised by settle');
select pg_temp.ok(public.excuse_target((select v from fx where k='err:target')), 'excuse closes the target');
select pg_temp.ok((select count(*) = 0 from public.score_events where target_id = (select v from fx where k='err:target')), 'excused target has no score');

-- Ledger and cached total agree
select pg_temp.ok((select p.total_points = (select coalesce(sum(delta),0) from public.score_events where user_id = p.id)
                     from public.profiles p where p.id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'total_points equals sum of ledger');

-- ---------- scheduling ----------
-- Europe/Bucharest leaves DST on 2026-10-25: 06:00 local is 03:00Z before, 04:00Z after.
insert into public.habits (user_id, title, target_time, weekdays, is_active)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'DST check', '06:00', '{1,2,3,4,5,6,7}', false);
update public.habits set is_active = true where title = 'DST check';  -- activates → generates today/tomorrow only
create temp table dst as select * from public.targets where false;
do $$ declare h uuid; begin
  select id into h from public.habits where title = 'DST check';
  -- generate a fixed range; ensure_targets skips windows already closed, so use a future year
  perform public.ensure_targets_for_habit(h, date '2030-03-30', date '2030-04-01');
end $$;
select pg_temp.ok((select due_at = timestamptz '2030-03-30 04:00:00+00' from public.targets t join public.habits h on h.id = t.habit_id
                    where h.title = 'DST check' and local_date = '2030-03-30'), 'Bucharest 06:00 before spring-forward = 04:00Z');
select pg_temp.ok((select due_at = timestamptz '2030-03-31 03:00:00+00' from public.targets t join public.habits h on h.id = t.habit_id
                    where h.title = 'DST check' and local_date = '2030-03-31'), 'Bucharest 06:00 after spring-forward = 03:00Z');

-- Rescheduling replaces windows that have not opened, keeps settled history
select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
update public.habits set target_time = '23:59', weekdays = '{1,2,3,4,5,6,7}' where title = 'DST check';
select pg_temp.as_service();
select pg_temp.ok((select count(*) = 0 from public.targets t join public.habits h on h.id = t.habit_id
                    where h.title = 'DST check' and t.local_date >= '2030-01-01'), 'future targets dropped on reschedule');
select pg_temp.ok((select count(*) >= 1 from public.targets t join public.habits h on h.id = t.habit_id
                    where h.title = 'DST check' and (t.due_at at time zone 'Europe/Bucharest')::time = '23:59'), 'regenerated at new time');

-- Weekday filter: Mondays only between 2030-01-07 (Mon) and 2030-01-13 (Sun)
insert into public.habits (user_id, title, target_time, weekdays, is_active)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'Mondays', '09:00', '{1}', true);
do $$ declare h uuid; begin select id into h from public.habits where title = 'Mondays';
  perform public.ensure_targets_for_habit(h, date '2030-01-07', date '2030-01-13'); end $$;
select pg_temp.ok((select count(*) = 1 from public.targets t join public.habits h on h.id = t.habit_id
                    where h.title = 'Mondays' and t.local_date between '2030-01-07' and '2030-01-13'), 'weekday filter honoured');

-- ---------- read models ----------
-- Give user B a verified day so the arena has two players
reset role;
insert into public.habits (user_id, title, target_time, weekdays) values ('bbbbbbbb-0000-0000-0000-000000000002', 'Read', '21:00', '{1,2,3,4,5,6,7}');
select pg_temp.as_service();
do $$ declare h uuid; t uuid; s uuid; p uuid; begin
  select id into h from public.habits where user_id = 'bbbbbbbb-0000-0000-0000-000000000002';
  insert into public.targets (habit_id, user_id, local_date, due_at) values (h, 'bbbbbbbb-0000-0000-0000-000000000002', '2030-02-01', now()) returning id into t;
  insert into public.capture_sessions (user_id, target_id, expires_at) values ('bbbbbbbb-0000-0000-0000-000000000002', t, now() + interval '3 min') returning id into s;
  insert into public.proofs (user_id, target_id, capture_session_id, storage_path) values ('bbbbbbbb-0000-0000-0000-000000000002', t, s, 'b/x') returning id into p;
  perform public.apply_verdict(p, 'verified', 'ok', 0.9, 'm', '{}');
end $$;

select pg_temp.as_user('aaaaaaaa-0000-0000-0000-000000000001');
select pg_temp.ok((select count(*) = 2 from public.get_arena()), 'arena lists both players today');
select pg_temp.ok((select rank = 1 and display_name = 'Bianca' from public.get_arena() where rank = 1), 'B (+50) ranks above A (net negative)');
select pg_temp.ok((select is_me from public.get_arena() where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 'arena marks the caller');
select pg_temp.ok((select (public.get_my_stats() ->> 'longest_streak')::int = 2), 'stats: longest streak 2');
select pg_temp.ok((select (public.get_my_stats() ->> 'habits_completed')::int = 2), 'stats: 2 verified targets');
select pg_temp.ok((select (public.get_my_stats() ->> 'premium')::boolean = false), 'stats: no premium without entitlement');

reset role;
select 'ALL DATABASE TESTS PASSED';
