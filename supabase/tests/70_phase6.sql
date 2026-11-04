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
  ('e1000000-0000-0000-0000-000000000001', 'ro@test', '{"display_name":"Radu","timezone":"Europe/Bucharest","language":"ro"}'),
  ('e2000000-0000-0000-0000-000000000002', 'en@test', '{"display_name":"Ella","timezone":"Europe/Bucharest"}');
insert into public.entitlements (user_id, is_active, expires_at) values ('e1000000-0000-0000-0000-000000000001', true, now() + interval '30 days');
create temp table fx (k text primary key, v uuid);
grant all on fx to authenticated, service_role;

-- ---------- preferences ----------
select pg_temp.ok((select language = 'ro' and theme = 'dark' and evidence_retention = 'keep' from public.profiles where id = 'e1000000-0000-0000-0000-000000000001'), 'sign-up language is kept; dark is the default theme');
select pg_temp.ok((select language = 'en' from public.profiles where id = 'e2000000-0000-0000-0000-000000000002'), 'English is the default language');
select pg_temp.as_user('e2000000-0000-0000-0000-000000000002');
update public.profiles set language = 'ro', theme = 'light', evidence_retention = '30d' where id = 'e2000000-0000-0000-0000-000000000002';
select pg_temp.ok((select language = 'ro' and theme = 'light' and evidence_retention = '30d' from public.profiles where id = 'e2000000-0000-0000-0000-000000000002'), 'the user changes language, theme and retention');
select pg_temp.expect_error($$update public.profiles set language = 'de' where id = 'e2000000-0000-0000-0000-000000000002'$$, 'check constraint');
select pg_temp.expect_error($$update public.profiles set theme = 'blue' where id = 'e2000000-0000-0000-0000-000000000002'$$, 'check constraint');
update public.profiles set language = 'en' where id = 'e1000000-0000-0000-0000-000000000001';
select pg_temp.as_admin();
select pg_temp.ok((select language = 'ro' from public.profiles where id = 'e1000000-0000-0000-0000-000000000001'), 'nobody changes another user''s preferences');

-- ---------- templates ----------
select pg_temp.ok((select count(*) >= 12 from public.challenge_templates), 'template library');
select pg_temp.ok((select kind = 'elite' and difficulty = 'elite' and jsonb_array_length(objectives) = 4 and allowed_misses = 0 and position('Hard' in title) = 0
                     from public.challenge_templates where id = 'iron-75'), '75-day program: elite, four objectives, own name');
select pg_temp.ok((select kind = 'daily' and duration_days = 1 from public.challenge_templates where id = 'daily-reset'), 'daily challenge');
select pg_temp.ok((select kind = 'weekly' and allowed_misses = 3 from public.challenge_templates where id = 'four-of-seven'), 'weekly challenge: 4 of 7');
select pg_temp.ok((select objectives -> 0 ->> 'time' = '05:00' from public.challenge_templates where id = 'early-7'), 'single-habit templates became one-objective plans');

-- ---------- starting a plan ----------
select pg_temp.as_user('e2000000-0000-0000-0000-000000000002');
select pg_temp.expect_error($$select public.start_challenge_plan('{"objectives":[{}]}'::jsonb, 'daily-reset')$$, 'Premium');
select pg_temp.as_user('e1000000-0000-0000-0000-000000000001');
insert into fx values ('daily', public.start_challenge_plan(
  '{"objectives":[{"time":"07:30"},{"time":"18:00"},{"time":"23:50","weekdays":[1,2,3,4,5,6,7]}]}'::jsonb, 'daily-reset'));
select pg_temp.ok((select kind = 'daily' and difficulty = 'beginner' and source = 'template' and end_date = start_date
                     from public.challenges where id = (select v from fx where k = 'daily')), 'template plan starts with the template''s rules');
select pg_temp.ok((select count(*) = 3 from public.challenge_habits where challenge_id = (select v from fx where k = 'daily')), 'one commitment per objective');
select pg_temp.ok((select count(*) = 3 and bool_and(challenge_id = (select v from fx where k = 'daily')) from public.habits where title in ('Make the bed', 'Move — 20 min', 'Plan tomorrow')),
                  'objective commitments belong to the challenge');
select pg_temp.ok((select to_char(target_time, 'HH24:MI') = '23:50' from public.habits where title = 'Plan tomorrow'), 'the user may move an objective''s time');
select pg_temp.expect_error($$select public.start_challenge_plan('{"objectives":[{"time":"07:00"}]}'::jsonb, 'daily-reset')$$, 'do not match the template');
insert into fx values ('dw', public.start_challenge_plan('{"objectives":[{"time":"08:00","title":"Muncă profundă — 90 min","proof_hint":"Biroul și cronometrul."}]}'::jsonb, 'deep-work-7'));
select pg_temp.ok((select h.title = 'Muncă profundă — 90 min' and h.proof_hint = 'Biroul și cronometrul.' and c.allowed_misses = 1 and c.difficulty = 'beginner'
                     from public.challenges c join public.habits h on h.challenge_id = c.id where c.id = (select v from fx where k = 'dw')),
                  'template objectives may carry a translated title and proof description; the rules stay the template''s');
select pg_temp.ok(public.abandon_challenge((select v from fx where k = 'dw')), 'abandoned (keeps the objective cap free)');
select pg_temp.expect_error($$select public.start_challenge_plan('{"title":"X","duration_days":10,"objectives":[{"title":" ","time":"07:00"}]}'::jsonb)$$, 'needs a title');
select pg_temp.expect_error($$select public.start_challenge_plan('{"title":"X","duration_days":10,"objectives":[{"title":"A","time":"07:00","verification_level":"lenient"}]}'::jsonb)$$, 'invalid verification level');

-- custom / AI plans are validated on the server
select pg_temp.expect_error($$select public.start_challenge_plan('{"title":"X","kind":"daily","duration_days":3,"objectives":[{"title":"A","time":"07:00"}]}'::jsonb)$$, 'does not match the category');
select pg_temp.expect_error($$select public.start_challenge_plan('{"title":"X","kind":"elite","difficulty":"elite","duration_days":10,"allowed_misses":1,"objectives":[{"title":"A","time":"07:00"}]}'::jsonb)$$, 'elite challenges allow no misses');
select pg_temp.expect_error($$select public.start_challenge_plan('{"title":"X","duration_days":10,"objectives":[{"title":"A","time":"7am"}]}'::jsonb)$$, 'needs a time');
select pg_temp.expect_error($$select public.start_challenge_plan('{"title":"X","duration_days":10,"objectives":[]}'::jsonb)$$, '1–5 objectives');
select pg_temp.expect_error($$select public.start_challenge_plan('{"title":"X","duration_days":10,"allowed_misses":5,"objectives":[{"title":"A","time":"07:00"}]}'::jsonb)$$, 'a third of the days');
select pg_temp.expect_error($$select public.start_challenge_plan('{"title":"X","duration_days":10,"objectives":[{"title":"A","time":"07:00"}]}'::jsonb, null, 'hacked')$$, 'invalid source');
insert into fx values ('ai', public.start_challenge_plan(
  '{"title":"Morning engine","description":"Run then read.","rules":"Both, every day.","kind":"custom","difficulty":"advanced","duration_days":6,"allowed_misses":0,
    "objectives":[{"title":"Run 3 km","time":"06:30","proof_hint":"Watch with distance"},{"title":"Read 10 pages","time":"21:00","verification_level":"strict"}]}'::jsonb, null, 'ai'));
select pg_temp.ok((select source = 'ai' and difficulty = 'advanced' and bonus_points = required_days * 10 * 150 / 100
                     from public.challenges where id = (select v from fx where k = 'ai')), 'AI plan: source recorded, advanced bonus ×1.5');
select pg_temp.ok((select verification_level = 'strict' from public.habits where title = 'Read 10 pages' and challenge_id = (select v from fx where k = 'ai')), 'objective verification level kept (Premium)');

-- ---------- multi-objective progress ----------
-- Pin the AI challenge to: 3 days ago … 2 days ahead, both objectives every day.
select pg_temp.as_admin();
create temp table d as select (now() at time zone 'Europe/Bucharest')::date as today;
grant select on d to authenticated, service_role;
update public.challenges set start_date = (select today from d) - 3, end_date = (select today from d) + 2, weekdays = '{1,2,3,4,5,6,7}', required_days = 6
 where id = (select v from fx where k = 'ai');
insert into fx select 'run', id from public.habits where title = 'Run 3 km';
insert into fx select 'read', id from public.habits where title = 'Read 10 pages' and challenge_id = (select v from fx where k = 'ai');
delete from public.targets where habit_id in ((select v from fx where k = 'run'), (select v from fx where k = 'read'));
select pg_temp.t((select v from fx where k = 'run'),  (select today from d) - 3, 'verified');
select pg_temp.t((select v from fx where k = 'read'), (select today from d) - 3, 'verified');   -- day -3: done
select pg_temp.t((select v from fx where k = 'run'),  (select today from d) - 2, 'verified');
select pg_temp.t((select v from fx where k = 'read'), (select today from d) - 2, 'missed');     -- day -2: lost
select pg_temp.t((select v from fx where k = 'run'),  (select today from d) - 1, 'verified');
select pg_temp.t((select v from fx where k = 'read'), (select today from d) - 1, 'excused');    -- day -1: done (excused = our outage)
select pg_temp.as_user('e1000000-0000-0000-0000-000000000001');
create temp table pr as select public.challenge_progress((select v from fx where k = 'ai')) as p;
select pg_temp.ok((select (p ->> 'done')::int = 2 and (p ->> 'lost')::int = 1 and (p ->> 'left')::int = 3 from pr), 'a day counts only when every objective is verified: 2 done, 1 lost, 3 left');
create temp table det as select public.get_challenge_detail((select v from fx where k = 'ai')) as j;
select pg_temp.ok((select jsonb_array_length(j -> 'days') = 6 and j -> 'days' -> 1 ->> 'state' = 'lost' and j -> 'days' -> 3 ->> 'state' = 'today' from det), 'calendar: one state per scheduled day');
select pg_temp.ok((select (j ->> 'streak')::int = 1 from det), 'current streak counts back to the last lost day');
select pg_temp.ok((select jsonb_array_length(j -> 'objectives') = 2 and (j -> 'objectives' -> 0 ->> 'verified')::int = 3 and (j -> 'objectives' -> 1 ->> 'failed')::int = 1 from det), 'per-objective results');
select pg_temp.ok((select jsonb_array_length(j -> 'evidence') = 6 from det), 'evidence history lists each settled target');
select pg_temp.as_user('e2000000-0000-0000-0000-000000000002');
select pg_temp.ok((select public.get_challenge_detail((select v from fx where k = 'ai')) is null), 'detail is private');

-- ---------- ending pauses the challenge's own commitments ----------
select pg_temp.as_service();
select public.settle_challenges();
select pg_temp.ok((select status = 'failed' from public.challenges where id = (select v from fx where k = 'ai')), 'a lost day with no misses allowed fails the challenge');
select pg_temp.ok((select bool_and(not is_active) from public.habits where challenge_id = (select v from fx where k = 'ai')), 'its commitments are paused, not deleted');
select pg_temp.as_user('e1000000-0000-0000-0000-000000000001');
select pg_temp.ok(public.abandon_challenge((select v from fx where k = 'daily')), 'abandon');
select pg_temp.ok((select bool_and(not is_active) from public.habits where challenge_id = (select v from fx where k = 'daily')), 'abandoning pauses its commitments too');
select pg_temp.ok((select (public.get_challenges() -> 'stats' ->> 'failed')::int = 1 and (public.get_challenges() -> 'stats' ->> 'abandoned')::int = 2
                          and (public.get_challenges() -> 'stats' ->> 'completion_rate')::int = 0), 'history statistics');
select pg_temp.ok((select (public.get_challenges() -> 'mine' -> 0 ->> 'objective_count')::int >= 2), 'objective count per challenge');

-- ---------- privacy ----------
select pg_temp.ok((select (public.export_my_data() -> 'profile' ->> 'display_name') = 'Radu' and jsonb_array_length(public.export_my_data() -> 'commitments') >= 5), 'data export');
select pg_temp.ok((select position('ai_raw' in public.export_my_data()::text) = 0), 'export leaves out raw AI payloads');
select pg_temp.expect_error($$select * from public.evidence_due_for_deletion()$$, 'permission denied');
select pg_temp.as_admin();
insert into public.capture_sessions (id, user_id, target_id, expires_at) select 'e2000000-0000-0000-0000-0000000000c1', 'e2000000-0000-0000-0000-000000000002', t.id, now()
  from public.targets t where false;
insert into public.habits (id, user_id, title, target_time, weekdays, is_active) values ('e2000000-0000-0000-0000-0000000000a1', 'e2000000-0000-0000-0000-000000000002', 'Old', '07:00', '{1}', false);
insert into fx values ('old_t', pg_temp.t('e2000000-0000-0000-0000-0000000000a1', (select today from d) - 40, 'verified'));
insert into public.capture_sessions (id, user_id, target_id, expires_at) values ('e2000000-0000-0000-0000-0000000000c1', 'e2000000-0000-0000-0000-000000000002', (select v from fx where k = 'old_t'), now());
insert into public.proofs (id, user_id, target_id, capture_session_id, storage_path, outcome, created_at)
values ('e2000000-0000-0000-0000-0000000000f1', 'e2000000-0000-0000-0000-000000000002', (select v from fx where k = 'old_t'), 'e2000000-0000-0000-0000-0000000000c1', 'u/old.jpg', 'verified', now() - interval '40 days');
select pg_temp.as_service();
select pg_temp.ok((select count(*) = 1 and min(paths[1]) = 'u/old.jpg' from public.evidence_due_for_deletion() where user_id = 'e2000000-0000-0000-0000-000000000002'), '30-day retention finds old evidence');
select pg_temp.ok((select count(*) = 1 and bool_and(not kept) from public.evidence_for_user_deletion('e2000000-0000-0000-0000-000000000002')), 'user deletion lists settled evidence as deletable');
insert into fx values ('rej_t', pg_temp.t('e2000000-0000-0000-0000-0000000000a1', (select today from d) - 1, 'rejected'));
select pg_temp.as_admin();
insert into public.capture_sessions (id, user_id, target_id, expires_at) values ('e2000000-0000-0000-0000-0000000000c2', 'e2000000-0000-0000-0000-000000000002', (select v from fx where k = 'rej_t'), now());
insert into public.proofs (id, user_id, target_id, capture_session_id, storage_path, outcome, judged_at)
values ('e2000000-0000-0000-0000-0000000000f2', 'e2000000-0000-0000-0000-000000000002', (select v from fx where k = 'rej_t'), 'e2000000-0000-0000-0000-0000000000c2', 'u/rej.jpg', 'rejected', now() - interval '1 hour');
select pg_temp.as_service();
select pg_temp.ok((select kept from public.evidence_for_user_deletion('e2000000-0000-0000-0000-000000000002') where proof_id = 'e2000000-0000-0000-0000-0000000000f2'),
                  'a rejection still inside its appeal window is kept');
select pg_temp.ok(public.mark_evidence_deleted(array['e2000000-0000-0000-0000-0000000000f1'::uuid]) = 1, 'evidence marked deleted');
select pg_temp.ok((select count(*) = 0 from public.evidence_due_for_deletion() where user_id = 'e2000000-0000-0000-0000-000000000002'), 'and not listed again');

select pg_temp.as_admin();
delete from auth.users where id in ('e1000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000002');
select pg_temp.ok((select count(*) = 0 from public.challenges where user_id::text like 'e1%'), 'account deletion removes challenges');
\echo PHASE 6 TESTS PASSED
