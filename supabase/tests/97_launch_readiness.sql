-- Launch readiness: the Arena privacy model (visible by default, opt-out), and how a Premium grant is labelled.
\set QUIET on
\pset tuples_only on

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false); execute 'set role authenticated'; end $$;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok - %', msg; end $$;
create or replace function pg_temp.board_json(p_viewer uuid) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  perform pg_temp.as_user(p_viewer);
  j := public.get_arena_board('all', 'points', null, 'all', 0, 50);
  reset role;
  return j;
end $$;
create or replace function pg_temp.on_board(p_viewer uuid, p_user uuid) returns boolean language plpgsql as $$
declare j jsonb;
begin
  perform pg_temp.as_user(p_viewer);
  j := public.get_arena_board('all', 'points', null, 'all', 0, 50);
  reset role;
  return exists (select 1 from jsonb_array_elements(j -> 'rows') r where (r ->> 'user_id')::uuid = p_user);
end $$;

reset role;
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('97000000-0000-0000-0000-000000000001', 'quiet@test', '{"display_name":"Quiet","timezone":"Europe/Bucharest"}', now()),
  ('97000000-0000-0000-0000-000000000002', 'loud@test',  '{"display_name":"Loud","timezone":"Europe/Bucharest"}', now()),
  ('97000000-0000-0000-0000-000000000003', 'odd@test',   '{"display_name":"Odd","timezone":"Europe/Bucharest"}', now()),
  ('97000000-0000-0000-0000-000000000004', 'no@test',    '{"display_name":"No","timezone":"Europe/Bucharest"}', now());

-- ---------- Arena: visible by default, with an opt-out (agreed privacy model) ----------
select pg_temp.ok((select arena_visible from public.profiles where id = '97000000-0000-0000-0000-000000000001'),
                  'a new account is visible in the Arena by default');
select pg_temp.ok((select column_default = 'true' from information_schema.columns
                    where table_schema = 'public' and table_name = 'profiles' and column_name = 'arena_visible'),
                  'the column default is visible');
select pg_temp.ok(pg_temp.on_board('97000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001'),
                  'other members see a new account on the board');

-- Opt-out in Settings (the person's own column grant).
select pg_temp.as_user('97000000-0000-0000-0000-000000000001');
update public.profiles set arena_visible = false where id = '97000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.ok(not pg_temp.on_board('97000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001'),
                  'opting out hides the account from other members');
select pg_temp.ok((select (j -> 'me' ->> 'hidden')::boolean from (select 1) x,
                     lateral (select pg_temp.board_json('97000000-0000-0000-0000-000000000001') j) y),
                  'a hidden person still sees their own standing, marked hidden');

-- Someone else cannot change your visibility.
select pg_temp.as_user('97000000-0000-0000-0000-000000000002');
update public.profiles set arena_visible = true where id = '97000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.ok((select not arena_visible from public.profiles where id = '97000000-0000-0000-0000-000000000001'),
                  'another member cannot switch your Arena visibility back on');

-- Opting back in.
select pg_temp.as_user('97000000-0000-0000-0000-000000000001');
update public.profiles set arena_visible = true where id = '97000000-0000-0000-0000-000000000001';
reset role;
select pg_temp.ok(pg_temp.on_board('97000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001'),
                  'turning the Arena back on makes the account visible again');

-- Only approved public fields leave the database.
select pg_temp.ok((select bool_and(k in ('rank','user_id','display_name','username','avatar_path','points','total_points','level','streak','challenge','is_me','is_partner'))
                     from jsonb_array_elements(pg_temp.board_json('97000000-0000-0000-0000-000000000002') -> 'rows') r, jsonb_object_keys(r) k),
                  'board rows contain only approved public fields');
select pg_temp.ok(position('@test' in pg_temp.board_json('97000000-0000-0000-0000-000000000002')::text) = 0,
                  'no e-mail address appears anywhere in the board');

-- ---------- Premium source labels ----------
insert into public.entitlements (user_id, is_active, expires_at, store, period_type) values
  ('97000000-0000-0000-0000-000000000001', true, null, null, 'test'),
  ('97000000-0000-0000-0000-000000000002', true, now() + interval '30 days', 'promotional', 'normal'),
  ('97000000-0000-0000-0000-000000000003', true, now() + interval '30 days', 'app_store', 'normal'),
  ('97000000-0000-0000-0000-000000000004', true, now() + interval '30 days', 'PLAY_STORE', 'normal');

create or replace function pg_temp.source_for(p uuid) returns text language plpgsql as $$
declare v text;
begin perform pg_temp.as_user(p); v := public.get_entitlement() ->> 'source'; reset role; return v; end $$;

select pg_temp.ok(pg_temp.source_for('97000000-0000-0000-0000-000000000001') = 'manual', 'a grant without a store is labelled manual, not App Store');
select pg_temp.ok(pg_temp.source_for('97000000-0000-0000-0000-000000000002') = 'manual', 'a RevenueCat promotional grant is labelled manual');
select pg_temp.ok(pg_temp.source_for('97000000-0000-0000-0000-000000000003') = 'app_store', 'an App Store purchase stays app_store');
select pg_temp.ok(pg_temp.source_for('97000000-0000-0000-0000-000000000004') = 'play_store', 'store names are normalised to lower case');

-- ---------- Data export (GDPR Art. 15/20) ----------
reset role;
insert into public.partnerships (user_a, user_b) values ('97000000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000002');
insert into public.coach_messages (user_id, role, content) values ('97000000-0000-0000-0000-000000000002', 'user', 'secret of user two');
select public.audit('97000000-0000-0000-0000-000000000001', 'test_action', null, '{"k":1}');
insert into public.push_tokens (token, user_id, platform) values ('ExponentPushToken[abcdefghijklmnopqrstuvwxyz]', '97000000-0000-0000-0000-000000000001', 'ios');

create or replace function pg_temp.export_as(p uuid) returns jsonb language plpgsql as $$
declare j jsonb;
begin perform pg_temp.as_user(p); j := public.export_my_data(); reset role; return j; end $$;

select pg_temp.ok((select bool_and(pg_temp.export_as('97000000-0000-0000-0000-000000000001') ? k) from unnest(array[
    'account','profile','commitments','targets','proofs','proof_photos','points_ledger','discipline_scores','challenges','appeals',
    'coach_messages','weekly_reports','achievements','partners','partner_invites','nudges','entitlement','billing','ai_usage',
    'activity_log','push_devices','reminders_sent','camera_sessions']) k),
  'the export covers every personal-data table');
select pg_temp.ok(pg_temp.export_as('97000000-0000-0000-0000-000000000001') -> 'account' ->> 'email' = 'quiet@test', 'the export includes the account e-mail');
select pg_temp.ok(jsonb_array_length(pg_temp.export_as('97000000-0000-0000-0000-000000000001') -> 'partners') = 1, 'partners are exported');
select pg_temp.ok(jsonb_array_length(pg_temp.export_as('97000000-0000-0000-0000-000000000001') -> 'activity_log') >= 1, 'the activity log is exported');
select pg_temp.ok(position('secret of user two' in pg_temp.export_as('97000000-0000-0000-0000-000000000001')::text) = 0,
  'another member''s data never appears in an export');
select pg_temp.ok(position('abcdefghijklmnopqrstuvwxyz' in pg_temp.export_as('97000000-0000-0000-0000-000000000001')::text) = 0,
  'push tokens are shortened in the export');
do $$ begin
  perform pg_temp.as_user(null); set role anon;
  begin perform public.export_my_data(); raise exception 'FAIL: anon could export'; exception when insufficient_privilege then null; end;
  reset role; raise notice 'ok - anonymous callers cannot export';
end $$;

-- ---------- "Delete all my evidence": cursor paging (evidence_for_user_deletion_page) ----------
reset role;
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('97000000-0000-0000-0000-000000000005', 'pager@test', '{"display_name":"Pager","timezone":"Europe/Bucharest"}', now());
insert into public.habits (id, user_id, title, target_time, weekdays) values
  ('97000000-0000-0000-0000-0000000000a1', '97000000-0000-0000-0000-000000000005', 'Read 20 pages', '07:00', '{1,2,3,4,5,6,7}');
-- One target still open (its photos must be kept) and one settled (its photos may go).
insert into public.targets (id, habit_id, user_id, local_date, due_at, status) values
  ('97000000-0000-0000-0000-0000000000b1', '97000000-0000-0000-0000-0000000000a1', '97000000-0000-0000-0000-000000000005', current_date, now() + interval '1 hour', 'pending'),
  ('97000000-0000-0000-0000-0000000000b2', '97000000-0000-0000-0000-0000000000a1', '97000000-0000-0000-0000-000000000005', current_date - 1, now() - interval '1 day', 'verified');
insert into public.capture_sessions (id, user_id, target_id, issued_at, expires_at)
select format('00000000-0000-4000-9000-%s', lpad(i::text, 12, '0'))::uuid, '97000000-0000-0000-0000-000000000005',
       case when i <= 1000 then '97000000-0000-0000-0000-0000000000b1' else '97000000-0000-0000-0000-0000000000b2' end::uuid,
       now() - interval '2 days', now() - interval '2 days' + interval '3 minutes'
  from generate_series(1, 1200) i;
-- 1,200 proofs. Ordered by id, the FIRST 1,000 belong to the open target (kept); the last 200 can be deleted.
insert into public.proofs (id, user_id, target_id, capture_session_id, storage_path, outcome, created_at)
select format('00000000-0000-4000-8000-%s', lpad(i::text, 12, '0'))::uuid, '97000000-0000-0000-0000-000000000005',
       case when i <= 1000 then '97000000-0000-0000-0000-0000000000b1' else '97000000-0000-0000-0000-0000000000b2' end::uuid,
       format('00000000-0000-4000-9000-%s', lpad(i::text, 12, '0'))::uuid,
       '97000000-0000-0000-0000-000000000005/x/' || i || '.jpg',
       (case when i <= 1000 then 'processing' else 'verified' end)::public.proof_outcome, now() - interval '2 days'
  from generate_series(1, 1200) i;
-- Someone else's evidence, which must never appear.
insert into public.habits (id, user_id, title, target_time, weekdays) values
  ('97000000-0000-0000-0000-0000000000a2', '97000000-0000-0000-0000-000000000004', 'Read', '07:00', '{1,2,3,4,5,6,7}');
insert into public.targets (id, habit_id, user_id, local_date, due_at, status) values
  ('97000000-0000-0000-0000-0000000000b3', '97000000-0000-0000-0000-0000000000a2', '97000000-0000-0000-0000-000000000004', current_date - 1, now() - interval '1 day', 'verified');
insert into public.capture_sessions (id, user_id, target_id, issued_at, expires_at) values
  ('97000000-0000-0000-0000-0000000000c3', '97000000-0000-0000-0000-000000000004', '97000000-0000-0000-0000-0000000000b3', now() - interval '2 days', now() - interval '2 days');
insert into public.proofs (id, user_id, target_id, capture_session_id, storage_path, outcome) values
  ('00000000-0000-4000-8000-0000000005ff', '97000000-0000-0000-0000-000000000004', '97000000-0000-0000-0000-0000000000b3',
   '97000000-0000-0000-0000-0000000000c3', '97000000-0000-0000-0000-000000000004/x/other.jpg', 'verified');

create temp table pg_pages (n integer, proof_id uuid, kept boolean);
do $$
declare v_after uuid := null; v_page integer := 0; v_rows integer;
begin
  loop
    v_page := v_page + 1;
    insert into pg_pages select v_page, r.proof_id, r.kept
      from public.evidence_for_user_deletion_page('97000000-0000-0000-0000-000000000005', v_after, 500) r;
    get diagnostics v_rows = row_count;
    exit when v_rows < 500 or v_page > 10;
    select proof_id into v_after from pg_pages where n = v_page order by proof_id desc limit 1;
  end loop;
end $$;
select pg_temp.ok((select count(*) = 1200 and count(distinct proof_id) = 1200 from pg_pages),
  'cursor paging returns all 1,200 records exactly once, past a first 1,000 that are all kept');
select pg_temp.ok((select bool_and(kept) from pg_pages where n <= 2), 'the first two pages hold only kept photos');
select pg_temp.ok((select count(*) filter (where kept) = 1000 and count(*) filter (where not kept) = 200 from pg_pages),
  'kept and deletable counts are exact: 1,000 kept, 200 deletable');
select pg_temp.ok((select max(n) = 3 from pg_pages), '3 pages of up to 500');
select pg_temp.ok((select bool_and(x.proof_id < x.next_id) from (
                     select proof_id, lead(proof_id) over (order by n, proof_id) as next_id from pg_pages) x where x.next_id is not null),
  'pages are strictly ordered by proof id across page boundaries (deterministic)');
select pg_temp.ok(not exists (select 1 from pg_pages where proof_id = '00000000-0000-4000-8000-0000000005ff'),
  'another member''s evidence never appears, even with an id inside the range');
select pg_temp.ok((select count(*) = 1000 from public.evidence_for_user_deletion_page('97000000-0000-0000-0000-000000000005', null, 5000)),
  'a page never exceeds 1,000 rows (the API cap)');
-- Marking the deletable ones as deleted removes them from later runs; the kept ones are still listed.
select public.mark_evidence_deleted(array(select proof_id from pg_pages where not kept));
select pg_temp.ok((select count(*) = 1000 and bool_and(kept) from public.evidence_for_user_deletion_page('97000000-0000-0000-0000-000000000005', null, 1000)),
  'after deletion only the kept photos remain listed');
select pg_temp.ok((select count(*) = 0 from public.evidence_for_user_deletion_page('97000000-0000-0000-0000-000000000005', '00000000-0000-4000-8000-000000001000', 500)),
  'a cursor past the last record returns an empty page (the loop ends)');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.evidence_for_user_deletion_page(uuid, uuid, integer)', 'execute')
                  and not has_function_privilege('anon', 'public.evidence_for_user_deletion_page(uuid, uuid, integer)', 'execute'),
  'app users cannot call the paging function (server only)');
