-- Phase 2 tests: verification levels, evidence items, duplicate detection, appeals.
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
-- A settled target in the past: n days ago, at 07:00 local.
create or replace function pg_temp.past_target(p_habit uuid, n integer) returns uuid language plpgsql as $$
declare h public.habits; v uuid; d date;
begin
  select * into h from public.habits where id = p_habit;
  d := (now() at time zone 'Europe/Bucharest')::date - n;
  insert into public.targets (habit_id, user_id, local_date, due_at)
  values (h.id, h.user_id, d, (d + time '07:00') at time zone 'Europe/Bucharest')
  on conflict (habit_id, local_date) do update set status = 'pending' returning id into v;
  return v;
end $$;

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('f0000000-0000-0000-0000-000000000006', 'f@test', '{"display_name":"Fay","timezone":"Europe/Bucharest"}'),
  ('f1000000-0000-0000-0000-000000000007', 'g@test', '{"display_name":"Gus","timezone":"Europe/Bucharest"}');

-- ---------- verification level is Premium for strict / elite ----------
select pg_temp.as_user('f0000000-0000-0000-0000-000000000006');
select pg_temp.expect_error($$insert into public.habits (user_id, title, target_time, weekdays, verification_level)
                              values ('f0000000-0000-0000-0000-000000000006', 'Run', '07:00', '{1,2,3,4,5,6,7}', 'strict')$$, 'premium_required');
insert into public.habits (user_id, title, target_time, weekdays) values ('f0000000-0000-0000-0000-000000000006', 'Run', '07:00', '{1,2,3,4,5,6,7}');
select pg_temp.ok((select verification_level = 'standard' from public.habits where user_id = 'f0000000-0000-0000-0000-000000000006'), 'default level is standard');
select pg_temp.expect_error($$update public.habits set verification_level = 'elite'$$, 'premium_required');
reset role;
insert into public.entitlements (user_id, is_active, expires_at) values ('f0000000-0000-0000-0000-000000000006', true, now() + interval '30 days');
select pg_temp.as_user('f0000000-0000-0000-0000-000000000006');
update public.habits set verification_level = 'elite';
select pg_temp.expect_error($$update public.habits set verification_level = 'ultra'$$, 'check constraint');
select pg_temp.ok((select verification_level = 'elite' from public.habits where user_id = 'f0000000-0000-0000-0000-000000000006'), 'Premium can choose elite');
update public.habits set verification_level = 'standard';

-- ---------- hashes + duplicate evidence ----------
reset role;
select pg_temp.ok(public.hash_distance('0000000000000000', '0000000000000000') = 0, 'hash distance 0 for equal hashes');
select pg_temp.ok(public.hash_distance('0000000000000000', 'ffffffffffffffff') = 64, 'hash distance 64 for opposite hashes');
select pg_temp.ok(public.hash_distance('00000000000000ff', '0000000000000000') = 8, 'hash distance counts differing bits');

create temp table fx (k text primary key, v uuid);
grant all on fx to service_role, authenticated;
insert into fx select 'habit', id from public.habits where user_id = 'f0000000-0000-0000-0000-000000000006';
insert into fx values ('t1', pg_temp.past_target((select v from fx where k = 'habit'), 3)),
                      ('t2', pg_temp.past_target((select v from fx where k = 'habit'), 2)),
                      ('t3', pg_temp.past_target((select v from fx where k = 'habit'), 1));

select pg_temp.as_service();
insert into fx values ('p1', pg_temp.proof_for((select v from fx where k = 't1')));
insert into public.proof_items (proof_id, user_id, kind, position, storage_path, sha256, dhash) values
  ((select v from fx where k = 'p1'), 'f0000000-0000-0000-0000-000000000006', 'live', 0, 'x/1.jpg', repeat('a', 64), '0f0f0f0f0f0f0f0f'),
  ((select v from fx where k = 'p1'), 'f0000000-0000-0000-0000-000000000006', 'screenshot', 1, 'x/2.jpg', repeat('b', 64), 'ff00ff00ff00ff00');

select pg_temp.ok((select count(*) = 1 and bool_and(exact) from public.find_duplicate_evidence('f0000000-0000-0000-0000-000000000006',
    (select v from fx where k = 't2'), array[repeat('a', 64)], array[null::text])), 'exact duplicate found by SHA-256');
select pg_temp.ok((select min(distance) = 1 and not bool_or(exact) from public.find_duplicate_evidence('f0000000-0000-0000-0000-000000000006',
    (select v from fx where k = 't2'), array[repeat('c', 64)], array['ff00ff00ff00ff01'])), 'near duplicate found by dHash distance');
select pg_temp.ok((select count(*) = 0 from public.find_duplicate_evidence('f0000000-0000-0000-0000-000000000006',
    (select v from fx where k = 't1'), array[repeat('a', 64)], array['0f0f0f0f0f0f0f0f'])), 'a retake for the same target is not a duplicate');
select pg_temp.ok((select count(*) = 0 from public.find_duplicate_evidence('f1000000-0000-0000-0000-000000000007',
    (select v from fx where k = 't2'), array[repeat('a', 64)], array['0f0f0f0f0f0f0f0f'])), 'another user''s evidence never matches');
select pg_temp.ok((select count(*) = 0 from public.find_duplicate_evidence('f0000000-0000-0000-0000-000000000006',
    (select v from fx where k = 't2'), array[repeat('c', 64)], array['0000000000000000'])), 'unrelated images do not match');

select pg_temp.as_user('f1000000-0000-0000-0000-000000000007');
select pg_temp.ok((select count(*) = 0 from public.proof_items), 'evidence items are private to their owner');
select pg_temp.expect_error($$select * from public.find_duplicate_evidence('f0000000-0000-0000-0000-000000000006', gen_random_uuid(), array['a'], array['b'])$$, 'permission denied');
select pg_temp.as_user('f0000000-0000-0000-0000-000000000006');
select pg_temp.ok((select count(*) = 2 from public.proof_items), 'the owner can read their evidence items');

-- ---------- appeals ----------
-- t1 verified, t2 rejected, t3 verified → streak 1 after t2's rejection; an overturn makes it 3.
select pg_temp.as_service();
select public.apply_verdict((select v from fx where k = 'p1'), 'verified', 'ok', 0.9, 'm', null);
insert into fx values ('p2', pg_temp.proof_for((select v from fx where k = 't2')));
select pg_temp.expect_error(format($$select public.open_appeal('f0000000-0000-0000-0000-000000000006', %L, 'x')$$, (select v from fx where k = 'p2')), 'only a rejected proof');
select public.apply_verdict((select v from fx where k = 'p2'), 'rejected', 'Desk, no run.', 0.9, 'm', null);
insert into fx values ('p3', pg_temp.proof_for((select v from fx where k = 't3')));
select public.apply_verdict((select v from fx where k = 'p3'), 'verified', 'ok', 0.9, 'm', null);
select pg_temp.ok((select current_streak = 1 from public.habits where id = (select v from fx where k = 'habit')), 'streak after a rejection in the middle is 1');
select pg_temp.ok((select total_points = 0 from public.profiles where id = 'f0000000-0000-0000-0000-000000000006'), 'points: +50 −100 +50 = 0');

select pg_temp.expect_error(format($$select public.open_appeal('f1000000-0000-0000-0000-000000000007', %L, 'x')$$, (select v from fx where k = 'p2')), 'proof not found');
insert into fx values ('a1', public.open_appeal('f0000000-0000-0000-0000-000000000006', (select v from fx where k = 'p2'), '  I was on the treadmill, the screen shows it.  '));
select pg_temp.ok((select note = 'I was on the treadmill, the screen shows it.' and status = 'pending' from public.appeals where id = (select v from fx where k = 'a1')), 'appeal opened with the note trimmed');
select pg_temp.expect_error(format($$select public.open_appeal('f0000000-0000-0000-0000-000000000006', %L, 'again')$$, (select v from fx where k = 'p2')), 'already been appealed');

select pg_temp.ok((select (public.resolve_appeal((select v from fx where k = 'a1'), true, 'Treadmill display visible.', 0.85, 'm', null) ->> 'points_delta')::integer = 150), 'overturn pays back the penalty and the award (+150)');
select pg_temp.ok((select status = 'verified' from public.targets where id = (select v from fx where k = 't2')), 'overturned target becomes verified');
select pg_temp.ok((select current_streak = 3 and longest_streak >= 3 from public.habits where id = (select v from fx where k = 'habit')), 'streak is recomputed from history (3)');
select pg_temp.ok((select total_points = 150 from public.profiles where id = 'f0000000-0000-0000-0000-000000000006'), 'total follows (+150)');
select pg_temp.ok((select sum(delta) = 150 from public.score_events where user_id = 'f0000000-0000-0000-0000-000000000006'), 'ledger still sums to the total');
select pg_temp.ok((select count(*) = 1 from public.score_events where reason = 'appeal_reversal' and appeal_id = (select v from fx where k = 'a1')), 'the overturn is one new ledger row');
select pg_temp.ok((select count(*) = 1 from public.score_events where target_id = (select v from fx where k = 't2') and delta = -100), 'the original penalty row is kept (append-only)');
select pg_temp.ok((select (public.resolve_appeal((select v from fx where k = 'a1'), true, 'again', 0.9, 'm', null) ->> 'already_decided')::boolean), 'resolving twice is a no-op');
select pg_temp.ok((select total_points = 150 from public.profiles where id = 'f0000000-0000-0000-0000-000000000006'), 'no double payment');
select pg_temp.expect_error($$insert into public.score_events (user_id, delta, reason, streak_after)
                              values ('f0000000-0000-0000-0000-000000000006', 150, 'appeal_reversal', 0)$$, 'score_events_source');

-- Upheld, window closed, and "unavailable" paths on fresh rejected targets.
insert into fx values ('t4', pg_temp.past_target((select v from fx where k = 'habit'), 4)),
                      ('t5', pg_temp.past_target((select v from fx where k = 'habit'), 5)),
                      ('t6', pg_temp.past_target((select v from fx where k = 'habit'), 6));
insert into fx values ('p4', pg_temp.proof_for((select v from fx where k = 't4'))),
                      ('p5', pg_temp.proof_for((select v from fx where k = 't5'))),
                      ('p6', pg_temp.proof_for((select v from fx where k = 't6')));
select public.apply_verdict((select v from fx where k = k2), 'rejected', 'no', 0.9, 'm', null) from (values ('p4'), ('p5'), ('p6')) x(k2);
insert into fx values ('a4', public.open_appeal('f0000000-0000-0000-0000-000000000006', (select v from fx where k = 'p4'), null));
select pg_temp.ok((select public.resolve_appeal((select v from fx where k = 'a4'), false, 'Still only a desk.', 0.9, 'm', null) ->> 'status' = 'upheld'), 'upheld appeal');
select pg_temp.ok((select status = 'rejected' from public.targets where id = (select v from fx where k = 't4')), 'upheld: the verdict stands');
reset role;
update public.proofs set judged_at = now() - interval '49 hours' where id = (select v from fx where k = 'p5');
select pg_temp.as_service();
select pg_temp.expect_error(format($$select public.open_appeal('f0000000-0000-0000-0000-000000000006', %L, null)$$, (select v from fx where k = 'p5')), 'appeal window has closed');
insert into fx values ('a6', public.open_appeal('f0000000-0000-0000-0000-000000000006', (select v from fx where k = 'p6'), null));
select public.fail_appeal((select v from fx where k = 'a6'), '{"error":"timeout"}') from generate_series(1, 4);
select pg_temp.ok((select status = 'pending' and attempts = 4 from public.appeals where id = (select v from fx where k = 'a6')), 'failed re-reviews are retried');
select pg_temp.ok((select public.fail_appeal((select v from fx where k = 'a6'), '{}') = 'unavailable'), 'after the last attempt the appeal is closed as unavailable');
select pg_temp.ok((select status = 'rejected' from public.targets where id = (select v from fx where k = 't6')), 'unavailable: the verdict stands');

select pg_temp.as_user('f1000000-0000-0000-0000-000000000007');
select pg_temp.ok((select count(*) = 0 from public.appeals), 'appeals are private');
select pg_temp.expect_error($$select public.open_appeal('f1000000-0000-0000-0000-000000000007', gen_random_uuid(), null)$$, 'permission denied');
select pg_temp.expect_error($$select public.resolve_appeal(gen_random_uuid(), true, 'x', 1, 'm', null)$$, 'permission denied');

-- ---------- an overturn revives a challenge that failed only because of it ----------
reset role;
select set_config('request.jwt.claim.sub', '', false);
insert into public.habits (id, user_id, title, target_time, weekdays)
values ('a7000000-0000-0000-0000-0000000000a7', 'f1000000-0000-0000-0000-000000000007', 'Read', '07:00', '{1,2,3,4,5,6,7}');
insert into public.challenges (user_id, habit_id, title, start_date, end_date, weekdays, required_days, allowed_misses, bonus_points, status, finished_at)
values ('f1000000-0000-0000-0000-000000000007', 'a7000000-0000-0000-0000-0000000000a7', 'Read 10',
        (now() at time zone 'Europe/Bucharest')::date - 1, (now() at time zone 'Europe/Bucharest')::date + 7,
        '{1,2,3,4,5,6,7}', 10, 0, 100, 'failed', now());
insert into fx values ('rt', pg_temp.past_target('a7000000-0000-0000-0000-0000000000a7', 1));
select pg_temp.as_service();
insert into fx values ('rp', pg_temp.proof_for((select v from fx where k = 'rt')));
select public.apply_verdict((select v from fx where k = 'rp'), 'rejected', 'no', 0.9, 'm', null);
insert into fx values ('ra', public.open_appeal('f1000000-0000-0000-0000-000000000007', (select v from fx where k = 'rp'), null));
select public.resolve_appeal((select v from fx where k = 'ra'), true, 'ok', 0.9, 'm', null);
reset role;
select pg_temp.ok((select status = 'active' and finished_at is null from public.challenges where habit_id = 'a7000000-0000-0000-0000-0000000000a7'), 'challenge failed by the overturned rejection is active again');

reset role;
delete from auth.users where id in ('f0000000-0000-0000-0000-000000000006', 'f1000000-0000-0000-0000-000000000007');
select pg_temp.ok((select count(*) = 0 from public.appeals) and (select count(*) = 0 from public.proof_items), 'account deletion removes appeals and evidence');
\echo PHASE 2 TESTS PASSED
