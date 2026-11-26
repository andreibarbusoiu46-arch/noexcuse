-- AI verification integrity: duplicate search across all of a user's evidence (incl. the same target),
-- similarity signatures (server-only, removed with the photo), and verdicts that never penalise
-- provider errors or "needs more evidence".
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
create or replace function pg_temp.proof_for(p_target uuid, p_received timestamptz default null) returns uuid language plpgsql as $$
declare t public.targets; s uuid; p uuid;
begin
  select * into t from public.targets where id = p_target;
  insert into public.capture_sessions (user_id, target_id, issued_at, expires_at)
  values (t.user_id, t.id, t.due_at - interval '30 seconds', t.due_at + interval '3 minutes') returning id into s;
  insert into public.proofs (user_id, target_id, capture_session_id, storage_path, received_at)
  values (t.user_id, t.id, s, t.user_id || '/' || t.id || '/' || s, coalesce(p_received, t.due_at)) returning id into p;
  return p;
end $$;
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
create or replace function pg_temp.item(p_proof uuid, p_user uuid, p_pos integer, p_sha text, p_dhash text, p_sig text default null)
returns uuid language plpgsql as $$
declare i uuid;
begin
  insert into public.proof_items (proof_id, user_id, kind, position, storage_path, sha256, dhash)
  values (p_proof, p_user, 'live', p_pos, p_user || '/' || p_proof || '-' || p_pos || '.jpg', p_sha, p_dhash) returning id into i;
  if p_sig is not null then
    insert into public.evidence_signatures (proof_item_id, user_id, signature) values (i, p_user, p_sig);
  end if;
  return i;
end $$;

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('f2000000-0000-0000-0000-000000000008', 'h@test', '{"display_name":"Hal","timezone":"Europe/Bucharest"}'),
  ('f3000000-0000-0000-0000-000000000009', 'i@test', '{"display_name":"Ivy","timezone":"Europe/Bucharest"}');
insert into public.habits (user_id, title, target_time, weekdays) values
  ('f2000000-0000-0000-0000-000000000008', 'Read 20 pages', '07:00', '{1,2,3,4,5,6,7}'),
  ('f3000000-0000-0000-0000-000000000009', 'Read 20 pages', '07:00', '{1,2,3,4,5,6,7}');

create temp table fx (k text primary key, v uuid);
grant all on fx to service_role, authenticated;
insert into fx select 'h_hal', id from public.habits where user_id = 'f2000000-0000-0000-0000-000000000008';
insert into fx select 'h_ivy', id from public.habits where user_id = 'f3000000-0000-0000-0000-000000000009';
insert into fx values ('t1', pg_temp.past_target((select v from fx where k = 'h_hal'), 3)),
                      ('t2', pg_temp.past_target((select v from fx where k = 'h_hal'), 2)),
                      ('ti', pg_temp.past_target((select v from fx where k = 'h_ivy'), 2));

select pg_temp.as_service();
-- Hal: first attempt for t2 (judged "needs more evidence"), and an older proof for t1.
insert into fx values ('p1', pg_temp.proof_for((select v from fx where k = 't1'))),
                      ('p2a', pg_temp.proof_for((select v from fx where k = 't2')));
insert into fx values
  ('i1', pg_temp.item((select v from fx where k = 'p1'), 'f2000000-0000-0000-0000-000000000008', 0, repeat('1', 64), '1111111111111111', '48,36,1.3333:AAAA-sig-t1')),
  ('i2a', pg_temp.item((select v from fx where k = 'p2a'), 'f2000000-0000-0000-0000-000000000008', 0, repeat('2', 64), '2222222222222222', '48,36,1.3333:AAAA-sig-t2'));
-- Ivy owns an identical photo (same bytes) — must never be visible to Hal.
insert into fx values ('pi', pg_temp.proof_for((select v from fx where k = 'ti')));
insert into fx values ('ii', pg_temp.item((select v from fx where k = 'pi'), 'f3000000-0000-0000-0000-000000000009', 0, repeat('2', 64), '2222222222222222', '48,36,1.3333:AAAA-sig-ivy'));

-- ---------- find_duplicate_evidence_v2 ----------
select pg_temp.ok((select count(*) = 1 and bool_and(exact) and bool_and(same_target)
                     from public.find_duplicate_evidence_v2('f2000000-0000-0000-0000-000000000008', (select v from fx where k = 't2'),
                          array[repeat('2', 64)], array[null::text])),
                  'reuse after a failed verdict: the same photo for the same target is found (same_target)');
select pg_temp.ok((select count(*) = 0 from public.find_duplicate_evidence('f2000000-0000-0000-0000-000000000008', (select v from fx where k = 't2'),
                          array[repeat('2', 64)], array[null::text])),
                  'v1 is unchanged: it still ignores the same target (old functions keep working during rollout)');
select pg_temp.ok((select count(*) = 1 and bool_and(exact) and not bool_or(same_target)
                     from public.find_duplicate_evidence_v2('f2000000-0000-0000-0000-000000000008', (select v from fx where k = 't2'),
                          array[repeat('1', 64)], array[null::text])),
                  'reuse across commitments/targets: an earlier proof''s photo is found');
select pg_temp.ok((select min(distance) = 1 from public.find_duplicate_evidence_v2('f2000000-0000-0000-0000-000000000008', (select v from fx where k = 't2'),
                          array[repeat('9', 64)], array['1111111111111110'])),
                  'dHash near-duplicates are still reported with their distance');
select pg_temp.ok((select count(*) = 0 from public.find_duplicate_evidence_v2('f2000000-0000-0000-0000-000000000008', (select v from fx where k = 't2'),
                          array[repeat('2', 64)], array[null::text], 6, (select v from fx where k = 'p2a'))),
                  'the proof being re-judged can be excluded (retries and appeals)');
select pg_temp.ok((select count(*) = 1 and bool_and(proof_id = (select v from fx where k = 'p2a'))
                     from public.find_duplicate_evidence_v2('f2000000-0000-0000-0000-000000000008', (select v from fx where k = 't2'),
                          array[repeat('2', 64)], array['2222222222222222'])),
                  'user isolation: another user''s identical photo never matches');

-- ---------- recent_evidence_signatures ----------
select pg_temp.ok((select count(*) = 2 and bool_and(signature like '%AAAA-sig-t%')
                     from public.recent_evidence_signatures('f2000000-0000-0000-0000-000000000008', (select v from fx where k = 't2'))),
                  'signatures: only the caller''s own evidence is returned');
select pg_temp.ok((select bool_and(same_target = (proof_id = (select v from fx where k = 'p2a')))
                     from public.recent_evidence_signatures('f2000000-0000-0000-0000-000000000008', (select v from fx where k = 't2'))),
                  'signatures report whether they belong to the same target');
select pg_temp.ok((select count(*) = 1 from public.recent_evidence_signatures('f2000000-0000-0000-0000-000000000008', (select v from fx where k = 't2'), (select v from fx where k = 'p2a'))),
                  'signatures: the proof being re-judged can be excluded');
select pg_temp.ok((select count(*) = 1 from public.recent_evidence_signatures('f2000000-0000-0000-0000-000000000008', (select v from fx where k = 't2'), null, 1)),
                  'signatures: the limit is honoured');

-- ---------- privacy of signatures ----------
select pg_temp.as_user('f2000000-0000-0000-0000-000000000008');
select pg_temp.expect_error($$select count(*) from public.evidence_signatures$$, 'permission denied');
select pg_temp.expect_error($$insert into public.evidence_signatures (proof_item_id, user_id, signature) values (gen_random_uuid(), 'f2000000-0000-0000-0000-000000000008', repeat('x', 20))$$, 'permission denied');
select pg_temp.expect_error($$select * from public.recent_evidence_signatures('f3000000-0000-0000-0000-000000000009', gen_random_uuid())$$, 'permission denied');
select pg_temp.expect_error($$select * from public.find_duplicate_evidence_v2('f3000000-0000-0000-0000-000000000009', gen_random_uuid(), array['a'], array['b'])$$, 'permission denied');
select pg_temp.ok(true, 'app users can''t read or write signatures, or call the duplicate searches for anyone');
reset role;
set role anon;
select pg_temp.expect_error($$select count(*) from public.evidence_signatures$$, 'permission denied');
reset role;

select pg_temp.as_service();
-- A signature is a miniature of the photo: deleting the photo (retention / "delete my evidence") removes it.
select public.mark_evidence_deleted(array[(select v from fx where k = 'p1')]);
select pg_temp.ok((select count(*) = 0 from public.evidence_signatures where proof_item_id = (select v from fx where k = 'i1')),
                  'signatures are deleted when the proof''s photos are deleted');
select pg_temp.ok((select count(*) = 1 from public.recent_evidence_signatures('f2000000-0000-0000-0000-000000000008', (select v from fx where k = 't2'))),
                  'evidence without photos is no longer offered for similarity checks');
select pg_temp.ok((select count(*) = 1 from public.find_duplicate_evidence_v2('f2000000-0000-0000-0000-000000000008', (select v from fx where k = 't2'),
                          array[repeat('1', 64)], array[null::text])),
                  'exact reuse is still caught after the photo is deleted (the SHA-256 stays)');
delete from public.proof_items where id = (select v from fx where k = 'i2a');
select pg_temp.ok((select count(*) = 0 from public.evidence_signatures where proof_item_id = (select v from fx where k = 'i2a')),
                  'signatures go with their evidence item (cascade)');

-- ---------- verdicts: only "rejected" (and late proof) cost points ----------
insert into fx values ('p2b', pg_temp.proof_for((select v from fx where k = 't2')));
select pg_temp.ok((select (r->>'points_delta')::int = 0 and r->>'target_status' = 'pending'
                     from (select public.apply_verdict((select v from fx where k = 'p2b'), 'error', 'Verification is delayed.', null, null, '{"error":"timeout"}') r) x),
                  'PROVIDER_ERROR (timeout): no points, target stays open');
select pg_temp.ok((select (r->>'points_delta')::int = 0 and r->>'target_status' = 'pending'
                     from (select public.apply_verdict((select v from fx where k = 'p2b'), 'error', 'Verification is delayed.', null, null, '{"error":"server"}') r) x),
                  'PROVIDER_ERROR (outage): no points, target stays open');
select pg_temp.ok((select (r->>'points_delta')::int = 0 and r->>'target_status' = 'pending'
                     from (select public.apply_verdict((select v from fx where k = 'p2b'), 'insufficient', 'Show the open book.', 0.9, 'm', null) r) x),
                  'NEEDS_MORE_EVIDENCE: no points, target stays open');
select pg_temp.ok((select total_points = 0 from public.profiles where id = 'f2000000-0000-0000-0000-000000000008'),
                  'no points were deducted by errors or needs-more-evidence');
select pg_temp.ok((select (r->>'points_delta')::int = -100 and r->>'target_status' = 'rejected'
                     from (select public.apply_verdict((select v from fx where k = 'p2b'), 'rejected', 'Unrelated photo.', 1, 'm', null) r) x),
                  'REJECTED: the only AI verdict that deducts points');
