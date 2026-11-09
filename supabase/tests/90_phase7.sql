-- Phase 7 tests: time edits, archive/restore, permanent deletion, challenge deletion, profile photos, Arena board.
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
-- A settled (or pending) target at a given instant, with its ledger row when settled.
create or replace function pg_temp.settled(p_habit uuid, p_due timestamptz, st public.target_status) returns uuid language plpgsql as $$
declare h public.habits; v uuid;
begin
  select * into h from public.habits where id = p_habit;
  -- local_date only needs to be unique per commitment here; due_at carries the real instant.
  insert into public.targets (habit_id, user_id, local_date, due_at, status, settled_at)
  values (h.id, h.user_id, date '2001-01-01' + nextval('pg_temp.dayseq')::integer, p_due, st, case when st = 'pending' then null else p_due end)
  returning id into v;
  if st in ('verified', 'missed') then
    insert into public.score_events (user_id, habit_id, target_id, delta, reason, streak_after, created_at)
    values (h.user_id, h.id, v, case when st = 'verified' then 50 else -100 end, st::text::public.score_reason, 0, p_due);
    update public.profiles set total_points = total_points + case when st = 'verified' then 50 else -100 end where id = h.user_id;
  end if;
  return v;
end $$;

select pg_temp.as_admin();
create sequence pg_temp.dayseq;
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('a7000000-0000-0000-0000-000000000001', 'ana@test',  '{"display_name":"Ana Pop","timezone":"Europe/Bucharest"}', now()),
  ('a7000000-0000-0000-0000-000000000002', 'bo@test',   '{"display_name":"Bogdan","timezone":"Europe/Bucharest"}', now()),
  ('a7000000-0000-0000-0000-000000000003', 'cy@test',   '{"display_name":"Cyra","timezone":"Europe/Bucharest"}', now()),
  ('a7000000-0000-0000-0000-000000000004', 'dan@test',  '{"display_name":"Dan Hidden","timezone":"Europe/Bucharest"}', now()),
  ('a7000000-0000-0000-0000-000000000005', 'eve@test',  '{"display_name":"Eve Unconfirmed","timezone":"Europe/Bucharest"}', null);
create temp table fx (k text primary key, v uuid);
grant all on fx to authenticated, service_role;

-- ---------- time edits persist exactly ----------
insert into public.habits (id, user_id, title, target_time, weekdays)
values ('a7000000-0000-0000-0000-0000000000f1', 'a7000000-0000-0000-0000-000000000001', 'Gym', '07:00', '{1,2,3,4,5,6,7}');
select pg_temp.as_user('a7000000-0000-0000-0000-000000000001');
update public.habits set target_time = '07:13', title = 'Gym session' where id = 'a7000000-0000-0000-0000-0000000000f1';
select pg_temp.ok((select target_time = '07:13'::time and title = 'Gym session' and weekdays = '{1,2,3,4,5,6,7}' and is_active
                     from public.habits where id = 'a7000000-0000-0000-0000-0000000000f1'), 'a time edit saves the exact minute and keeps the other fields');
select pg_temp.as_admin();
select pg_temp.ok(not exists (select 1 from public.targets t where t.habit_id = 'a7000000-0000-0000-0000-0000000000f1' and t.status = 'pending'
                               and (t.due_at at time zone 'Europe/Bucharest')::time <> '07:13'::time),
                  'upcoming windows follow the new local time (no UTC shift)');

-- ---------- archive → restore ----------
select pg_temp.as_user('a7000000-0000-0000-0000-000000000001');
update public.habits set archived_at = now() where id = 'a7000000-0000-0000-0000-0000000000f1';
select pg_temp.ok((select archived_at is not null and not is_active from public.habits where id = 'a7000000-0000-0000-0000-0000000000f1'), 'archiving pauses the commitment');
select pg_temp.ok(not exists (select 1 from public.targets where habit_id = 'a7000000-0000-0000-0000-0000000000f1' and status = 'pending' and due_at - interval '15 minutes' > now()),
                  'archiving drops windows that have not opened');
update public.habits set archived_at = null where id = 'a7000000-0000-0000-0000-0000000000f1';
select pg_temp.ok((select archived_at is null and not is_active and target_time = '07:13'::time from public.habits where id = 'a7000000-0000-0000-0000-0000000000f1'),
                  'restoring brings it back paused, with its settings');
update public.habits set is_active = true where id = 'a7000000-0000-0000-0000-0000000000f1';
select pg_temp.ok((select is_active from public.habits where id = 'a7000000-0000-0000-0000-0000000000f1'), 'a restored commitment can be reactivated');
select pg_temp.as_user('a7000000-0000-0000-0000-000000000002');
update public.habits set archived_at = now() where id = 'a7000000-0000-0000-0000-0000000000f1';
select pg_temp.as_admin();
select pg_temp.ok((select archived_at is null from public.habits where id = 'a7000000-0000-0000-0000-0000000000f1'), 'another user cannot archive it');

-- ---------- permanent deletion ----------
select pg_temp.as_user('a7000000-0000-0000-0000-000000000001');
select pg_temp.expect_error($$select public.delete_commitment('a7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-0000000000f1')$$, 'permission denied');
select pg_temp.as_service();
select pg_temp.ok((select public.commitment_deletion_check('a7000000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-0000000000f1') ->> 'error') = 'not_found',
                  'deletion checks ownership');
select pg_temp.ok(public.delete_commitment('a7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-0000000000f1') = 'erased',
                  'a commitment that never settled is erased');
select pg_temp.as_admin();
select pg_temp.ok(not exists (select 1 from public.habits where id = 'a7000000-0000-0000-0000-0000000000f1')
                  and not exists (select 1 from public.targets where habit_id = 'a7000000-0000-0000-0000-0000000000f1'), 'row and schedule are gone');

-- With history: content erased, results kept, points unchanged.
insert into public.habits (id, user_id, title, target_time, weekdays, notes, description, proof_hint, is_active)
values ('a7000000-0000-0000-0000-0000000000f2', 'a7000000-0000-0000-0000-000000000001', 'Secret diary', '21:00', '{1,2,3,4,5,6,7}', 'private note', 'desc', 'my desk', false);
select pg_temp.settled('a7000000-0000-0000-0000-0000000000f2', now() - interval '3 days', 'verified');
select pg_temp.settled('a7000000-0000-0000-0000-0000000000f2', now() - interval '2 days', 'missed');
insert into fx values ('open', pg_temp.settled('a7000000-0000-0000-0000-0000000000f2', now() + interval '5 minutes', 'pending'));
create temp table before7 as select total_points from public.profiles where id = 'a7000000-0000-0000-0000-000000000001';
select pg_temp.as_service();
select pg_temp.ok((public.commitment_deletion_check('a7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-0000000000f2') ->> 'error') = 'window_open',
                  'deletion is refused while a window is open');
select pg_temp.as_admin();
delete from public.targets where id = (select v from fx where k = 'open');
select pg_temp.as_service();
select pg_temp.ok(public.delete_commitment('a7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-0000000000f2') = 'removed',
                  'a commitment with results is removed');
select pg_temp.as_admin();
select pg_temp.ok((select title = 'Deleted commitment' and notes is null and description is null and proof_hint is null and deleted_at is not null
                     from public.habits where id = 'a7000000-0000-0000-0000-0000000000f2'), 'its content is erased');
select pg_temp.ok((select count(*) = 2 from public.score_events where habit_id = 'a7000000-0000-0000-0000-0000000000f2')
                  and (select total_points from public.profiles where id = 'a7000000-0000-0000-0000-000000000001') = (select total_points from before7),
                  'points and the ledger are untouched (history can''t be wiped to reset the score)');
select pg_temp.as_user('a7000000-0000-0000-0000-000000000001');
select pg_temp.ok(not exists (select 1 from public.habits where id = 'a7000000-0000-0000-0000-0000000000f2'), 'it no longer appears for its owner');
update public.habits set archived_at = null where id = 'a7000000-0000-0000-0000-0000000000f2';
select pg_temp.as_admin();
select pg_temp.ok((select archived_at is not null from public.habits where id = 'a7000000-0000-0000-0000-0000000000f2'), 'a deleted commitment cannot be restored');

-- ---------- challenge deletion ----------
insert into public.habits (id, user_id, title, target_time, weekdays)
values ('a7000000-0000-0000-0000-0000000000f3', 'a7000000-0000-0000-0000-000000000001', 'Read', '22:00', '{1,2,3,4,5,6,7}');
insert into public.challenges (id, user_id, habit_id, title, start_date, end_date, weekdays, required_days, bonus_points, status)
values ('a7000000-0000-0000-0000-0000000000c1', 'a7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-0000000000f3', 'Read 7', current_date, current_date + 6, '{1,2,3,4,5,6,7}', 7, 100, 'active');
select pg_temp.as_user('a7000000-0000-0000-0000-000000000001');
select pg_temp.expect_error($$select public.delete_challenge('a7000000-0000-0000-0000-0000000000c1')$$, 'abandon the challenge');
select pg_temp.as_service();
select pg_temp.ok((public.commitment_deletion_check('a7000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-0000000000f3') ->> 'error') = 'in_challenge',
                  'a commitment in an active challenge cannot be deleted');
select pg_temp.as_user('a7000000-0000-0000-0000-000000000002');
select pg_temp.expect_error($$select public.delete_challenge('a7000000-0000-0000-0000-0000000000c1')$$, 'not found');
select pg_temp.as_user('a7000000-0000-0000-0000-000000000001');
select public.abandon_challenge('a7000000-0000-0000-0000-0000000000c1');
select public.delete_challenge('a7000000-0000-0000-0000-0000000000c1');
select pg_temp.as_admin();
select pg_temp.ok(not exists (select 1 from public.challenges where id = 'a7000000-0000-0000-0000-0000000000c1')
                  and exists (select 1 from public.habits where id = 'a7000000-0000-0000-0000-0000000000f3'),
                  'an abandoned challenge is deleted; its commitment stays');

-- ---------- profile photos ----------
select pg_temp.as_user('a7000000-0000-0000-0000-000000000001');
select pg_temp.expect_error($$update public.profiles set avatar_url = 'https://evil.example/x.png' where id = 'a7000000-0000-0000-0000-000000000001'$$, 'permission denied');
select pg_temp.expect_error($$select public.set_avatar('a7000000-0000-0000-0000-000000000002/abcdefgh12.jpg')$$, 'invalid photo path');
select pg_temp.expect_error($$select public.set_avatar('a7000000-0000-0000-0000-000000000001/../x.jpg')$$, 'invalid photo path');
select pg_temp.expect_error($$select public.set_avatar('a7000000-0000-0000-0000-000000000001/abcdefgh12.gif')$$, 'invalid photo path');
select pg_temp.expect_error($$select public.set_avatar('a7000000-0000-0000-0000-000000000001/abcdefgh12.jpg')$$, 'not uploaded');
select pg_temp.as_admin();
insert into storage.objects (bucket_id, name) values
  ('avatars', 'a7000000-0000-0000-0000-000000000001/abcdefgh12.jpg'),
  ('avatars', 'a7000000-0000-0000-0000-000000000001/zyxwvuts98.webp');
select pg_temp.as_user('a7000000-0000-0000-0000-000000000001');
select pg_temp.ok(public.set_avatar('a7000000-0000-0000-0000-000000000001/abcdefgh12.jpg') is null, 'first photo set');
select pg_temp.ok(public.set_avatar('a7000000-0000-0000-0000-000000000001/zyxwvuts98.webp') = 'a7000000-0000-0000-0000-000000000001/abcdefgh12.jpg',
                  'replacing returns the old file to delete');
select pg_temp.ok(public.remove_avatar() = 'a7000000-0000-0000-0000-000000000001/zyxwvuts98.webp', 'removing returns the file to delete');
select pg_temp.ok((select avatar_path is null from public.profiles where id = 'a7000000-0000-0000-0000-000000000001'), 'removing clears it');
select public.set_avatar('a7000000-0000-0000-0000-000000000001/abcdefgh12.jpg');

-- ---------- Arena board ----------
select pg_temp.as_admin();
-- Users from earlier test files stay out of this board.
update public.profiles set arena_visible = false where id::text not like 'a7000000-%';
update public.profiles set username = 'ana_pop' where id = 'a7000000-0000-0000-0000-000000000001';
update public.profiles set arena_visible = false where id = 'a7000000-0000-0000-0000-000000000004';
update public.profiles set show_streak = false, show_challenge = false where id = 'a7000000-0000-0000-0000-000000000003';
-- Bogdan: lots of old points, few this week. Cyra: most points this week.
insert into public.habits (id, user_id, title, target_time, weekdays, current_streak, is_active) values
  ('a7000000-0000-0000-0000-0000000000b1', 'a7000000-0000-0000-0000-000000000002', 'Run', '06:00', '{1,2,3,4,5,6,7}', 4, false),
  ('a7000000-0000-0000-0000-0000000000e9', 'a7000000-0000-0000-0000-000000000003', 'Swim', '06:00', '{1,2,3,4,5,6,7}', 9, false),
  ('a7000000-0000-0000-0000-0000000000d1', 'a7000000-0000-0000-0000-000000000004', 'Walk', '06:00', '{1,2,3,4,5,6,7}', 20, false),
  ('a7000000-0000-0000-0000-0000000000e1', 'a7000000-0000-0000-0000-000000000005', 'Yoga', '06:00', '{1,2,3,4,5,6,7}', 1, false);
select pg_temp.settled('a7000000-0000-0000-0000-0000000000b1', now() - make_interval(days => d), 'verified') from generate_series(40, 69) d;
select pg_temp.settled('a7000000-0000-0000-0000-0000000000b1', date_trunc('week', now() at time zone 'UTC') at time zone 'UTC' + interval '1 minute', 'verified');
select pg_temp.settled('a7000000-0000-0000-0000-0000000000e9', date_trunc('week', now() at time zone 'UTC') at time zone 'UTC' + make_interval(mins => d), 'verified') from generate_series(2, 4) d;
select pg_temp.settled('a7000000-0000-0000-0000-0000000000d1', date_trunc('week', now() at time zone 'UTC') at time zone 'UTC' + make_interval(mins => d), 'verified') from generate_series(2, 9) d;
select pg_temp.settled('a7000000-0000-0000-0000-0000000000e1', date_trunc('week', now() at time zone 'UTC') at time zone 'UTC' + make_interval(mins => d), 'verified') from generate_series(2, 9) d;

select pg_temp.as_user('a7000000-0000-0000-0000-000000000002');
create temp table wk as select public.get_arena_board('week', 'points', null, 'all', 0, 20) as b;
create temp table al as select public.get_arena_board('all', 'points', null, 'all', 0, 20) as b;
grant all on wk, al to authenticated;
select pg_temp.ok((select jsonb_array_length(b -> 'rows') = 3 and (b ->> 'eligible')::int = 3 from wk),
                  'only confirmed, visible users are listed (hidden and unconfirmed excluded)');
select pg_temp.ok((select position('@' in b::text) = 0 and position('email' in b::text) = 0 from wk), 'no e-mail anywhere in the board');
select pg_temp.ok((select b -> 'rows' -> 0 ->> 'display_name' = 'Cyra' and (b -> 'rows' -> 0 ->> 'points')::int = 150
                     and b -> 'rows' -> 1 ->> 'display_name' = 'Bogdan' and (b -> 'rows' -> 1 ->> 'points')::int = 50 from wk),
                  'weekly ranking counts only this week''s ledger');
select pg_temp.ok((select b -> 'rows' -> 0 ->> 'display_name' = 'Bogdan' and (b -> 'rows' -> 0 ->> 'points')::int = 1550
                     and (b -> 'rows' -> 0 ->> 'level')::int = 4 from al), 'all-time ranking uses total points and levels');
select pg_temp.ok((select b -> 'rows' -> 0 -> 'streak' = 'null'::jsonb and b -> 'rows' -> 0 -> 'challenge' = 'null'::jsonb from wk),
                  'a private streak and challenge are not exposed');
select pg_temp.ok((select (b -> 'me' ->> 'rank')::int = 2 from wk), 'the caller gets their own rank');
select pg_temp.ok((select (b -> 'rows' -> 2 ->> 'display_name') = 'Ana Pop' and (b -> 'rows' -> 2 ->> 'avatar_path') like 'a7000000-0000-0000-0000-000000000001/%' from wk),
                  'profile photos appear on the board');
select pg_temp.ok((select jsonb_array_length(public.get_arena_board('week', 'points', 'ana', 'all', 0, 20) -> 'rows') = 1), 'search by name');
select pg_temp.ok((select jsonb_array_length(public.get_arena_board('week', 'points', 'ANA_P', 'all', 0, 20) -> 'rows') = 1), 'search by username, case-insensitive');
select pg_temp.ok((select jsonb_array_length(public.get_arena_board('week', 'points', '%', 'all', 0, 20) -> 'rows') = 0), 'search wildcards are literal');
select pg_temp.ok((select jsonb_array_length(b -> 'rows') = 1 and (b ->> 'total')::int = 3 and b -> 'rows' -> 0 ->> 'display_name' = 'Bogdan'
                     from (select public.get_arena_board('week', 'points', null, 'all', 1, 1) as b) x), 'pagination: page 2 of size 1');
select pg_temp.ok((select (b -> 'rows' -> 0 ->> 'display_name') = 'Bogdan' from (select public.get_arena_board('week', 'streak', null, 'all', 0, 20) as b) x),
                  'sort by streak (private streaks sort last)');
select pg_temp.ok((select jsonb_array_length(public.get_arena_board('week', 'points', null, 'partners', 0, 20) -> 'rows') = 1), 'partners scope: only me without partners');
select pg_temp.expect_error($$select public.get_arena_board('year', 'points', null, 'all', 0, 20)$$, 'invalid arena query');
select pg_temp.as_user('a7000000-0000-0000-0000-000000000004');
select pg_temp.ok((select b -> 'me' ->> 'hidden' = 'true' and (b -> 'me' ->> 'points')::int = 400
                     from (select public.get_arena_board('week', 'points', null, 'all', 0, 20) as b) x),
                  'a hidden user still sees their own points, unranked');
select pg_temp.as_admin();
select pg_temp.expect_error($$set role anon; select public.get_arena_board()$$, 'permission denied');
reset role;
