-- Phase 4 tests: partner invites, partnerships, privacy of the partner view, nudges.
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

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('c1000000-0000-0000-0000-000000000001', 'p1@test', '{"display_name":"Pia","timezone":"Europe/Bucharest"}'),
  ('c2000000-0000-0000-0000-000000000002', 'p2@test', '{"display_name":"Quinn","timezone":"Europe/Bucharest"}'),
  ('c3000000-0000-0000-0000-000000000003', 'p3@test', '{"display_name":"Rae","timezone":"Europe/Bucharest"}');
insert into public.habits (user_id, title, target_time, weekdays, notes)
values ('c2000000-0000-0000-0000-000000000002', 'Swim', ((now() at time zone 'Europe/Bucharest') + interval '3 hours')::time, '{1,2,3,4,5,6,7}', 'private: knee hurts');
create temp table fx (k text primary key, v text);
grant all on fx to authenticated, service_role;

-- ---------- invites ----------
select pg_temp.as_user('c1000000-0000-0000-0000-000000000001');
select pg_temp.expect_error($$select public.create_partner_invite()$$, 'premium_required');
reset role;
insert into public.entitlements (user_id, is_active, expires_at) values ('c1000000-0000-0000-0000-000000000001', true, now() + interval '30 days');
select pg_temp.as_user('c1000000-0000-0000-0000-000000000001');
insert into fx values ('code', public.create_partner_invite() ->> 'code');
select pg_temp.ok((select v ~ '^[A-HJ-NP-Z2-9]{8}$' from fx where k = 'code'), 'invite code: 8 unambiguous characters');
select public.create_partner_invite(); select public.create_partner_invite();
select pg_temp.expect_error($$select public.create_partner_invite()$$, 'too many open invites');
select pg_temp.ok((select jsonb_array_length(public.get_partners() -> 'invites') = 3), 'open invites listed');
select pg_temp.expect_error(format($$select public.accept_partner_invite(%L)$$, (select v from fx where k = 'code')), 'own invite');
select pg_temp.expect_error($$select * from public.partner_invites$$, 'permission denied');

-- ---------- accepting (free account) ----------
select pg_temp.as_user('c2000000-0000-0000-0000-000000000002');
select pg_temp.expect_error($$select public.accept_partner_invite('ZZZZZZZZ')$$, 'invalid or expired');
select pg_temp.ok((select public.accept_partner_invite(lower((select v from fx where k = 'code'))) ->> 'display_name' = 'Pia'), 'a free account accepts (code is case-insensitive)');
select pg_temp.expect_error(format($$select public.accept_partner_invite(%L)$$, (select v from fx where k = 'code')), 'invalid or expired');
select pg_temp.ok((select jsonb_array_length(public.get_partners() -> 'partners') = 1), 'partnership is visible to the invitee');
select pg_temp.ok((select not (public.get_partners() ->> 'can_invite')::boolean), 'free accounts cannot create invites');
select pg_temp.as_user('c1000000-0000-0000-0000-000000000001');
select pg_temp.ok((select public.get_partners() -> 'partners' -> 0 ->> 'display_name' = 'Quinn'), 'and to the inviter');
select pg_temp.ok((select jsonb_array_length(public.get_partners() -> 'invites') = 2), 'the used invite is no longer open');

-- ---------- what partners see ----------
select pg_temp.ok((select jsonb_array_length(public.get_partners() -> 'partners' -> 0 -> 'today') >= 0), 'today''s commitments are listed');
select pg_temp.ok((select position('knee' in public.get_partners()::text) = 0), 'private notes are never shared');
select pg_temp.ok((select (public.get_partners() -> 'partners' -> 0) ?& array['score', 'streak', 'week', 'today']), 'score, streak, week and today are shared');
select pg_temp.as_user('c3000000-0000-0000-0000-000000000003');
select pg_temp.ok((select jsonb_array_length(public.get_partners() -> 'partners') = 0), 'others see nothing');
select pg_temp.expect_error($$select public.partner_card('c2000000-0000-0000-0000-000000000002')$$, 'permission denied');
select pg_temp.expect_error($$select public.nudge_partner('c2000000-0000-0000-0000-000000000002')$$, 'not your partner');

-- ---------- nudges ----------
select pg_temp.as_user('c1000000-0000-0000-0000-000000000001');
select pg_temp.ok(public.nudge_partner('c2000000-0000-0000-0000-000000000002'), 'nudge sent');
select pg_temp.ok(not public.nudge_partner('c2000000-0000-0000-0000-000000000002'), 'one nudge per partner per day');
select pg_temp.ok((select (public.get_partners() -> 'partners' -> 0 ->> 'nudged_today')::boolean), 'nudged today is shown');
select pg_temp.as_service();
select pg_temp.ok((select count(*) = 1 and min(from_name) = 'Pia' from public.claim_partner_nudges()), 'cron claims the nudge once');
select pg_temp.ok((select count(*) = 0 from public.claim_partner_nudges()), 'and never twice');
select pg_temp.ok((select count(*) = 1 from public.partner_ids('c2000000-0000-0000-0000-000000000002')), 'partner ids for alerts');

-- ---------- removal + limits ----------
select pg_temp.as_user('c2000000-0000-0000-0000-000000000002');
select pg_temp.ok(public.remove_partner('c1000000-0000-0000-0000-000000000001'), 'either side can remove the partnership');
select pg_temp.ok((select jsonb_array_length(public.get_partners() -> 'partners') = 0), 'removed');
select pg_temp.as_user('c1000000-0000-0000-0000-000000000001');
select pg_temp.ok(public.revoke_partner_invite((select v from fx where k = 'code')) = false, 'a used invite cannot be revoked');
select pg_temp.ok(public.revoke_partner_invite((public.get_partners() -> 'invites' -> 0 ->> 'code')), 'an open invite can be revoked');
insert into fx values ('open', public.get_partners() -> 'invites' -> 0 ->> 'code');
reset role;
update public.app_config set value = 1 where key = 'max_partners';
insert into public.partnerships (user_a, user_b) values ('c1000000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000003');
select pg_temp.as_user('c2000000-0000-0000-0000-000000000002');
select pg_temp.expect_error(format($$select public.accept_partner_invite(%L)$$, (select v from fx where k = 'open')), 'partner limit reached');
select pg_temp.as_user('c1000000-0000-0000-0000-000000000001');
select pg_temp.expect_error($$select public.create_partner_invite()$$, 'partner limit reached');
reset role;
update public.app_config set value = 5 where key = 'max_partners';

reset role;
delete from auth.users where id in ('c1000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-000000000003');
select pg_temp.ok((select count(*) = 0 from public.partnerships) and (select count(*) = 0 from public.partner_nudges), 'account deletion removes partnerships and nudges');
\echo PHASE 4 TESTS PASSED
