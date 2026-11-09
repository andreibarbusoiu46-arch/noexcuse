-- Phase 7: restore and permanent deletion of commitments, deleting finished challenges,
-- profile photos and public-profile controls, and the community Arena (weekly / monthly / all-time).

-- =====================================================================
-- 1. Commitments: archive ⇄ restore, permanent deletion
-- =====================================================================
-- deleted_at marks a commitment whose content was erased but whose settled results must stay
-- (they back points and the Discipline Score, which cannot be reset by deleting history).
alter table public.habits add column deleted_at timestamptz;

create or replace function public.habits_archive_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.deleted_at is not null and auth.uid() is not null then
    raise exception 'this commitment was deleted' using errcode = '42501';
  end if;
  if new.archived_at is not null then
    new.is_active := false;                                 -- an archived commitment never schedules
    if old.archived_at is null then
      perform public.audit(new.user_id, 'commitment_archived', new.id, jsonb_build_object('title', new.title));
    end if;
  end if;
  if old.archived_at is not null and new.archived_at is null then
    new.is_active := false;                                 -- restored commitments come back paused
    perform public.audit(new.user_id, 'commitment_restored', new.id, '{}'::jsonb);
  end if;
  return new;
end $$;

-- Deleted commitments disappear from every client read and can't be edited.
drop policy habits_own_select on public.habits;
create policy habits_own_select on public.habits for select to authenticated
  using (user_id = (select auth.uid()) and deleted_at is null);
drop policy habits_own_update on public.habits;
create policy habits_own_update on public.habits for update to authenticated
  using (user_id = (select auth.uid()) and deleted_at is null)
  with check (user_id = (select auth.uid()));

/**
 * Checks that a commitment can be deleted now and returns the evidence files to remove first.
 * Refused while a window is open or waiting to be settled, while a verification or an appeal
 * is running, or while the commitment is part of an active challenge.
 */
create or replace function public.commitment_deletion_check(p_user uuid, p_habit uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare h public.habits;
begin
  select * into h from public.habits where id = p_habit and user_id = p_user and deleted_at is null;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if exists (select 1 from public.targets t where t.habit_id = h.id and t.status = 'pending'
              and t.due_at - interval '15 minutes' <= now()) then
    return jsonb_build_object('error', 'window_open');
  end if;
  if exists (select 1 from public.proofs p join public.targets t on t.id = p.target_id
              where t.habit_id = h.id and p.outcome in ('processing', 'error'))
     or exists (select 1 from public.appeals a join public.targets t on t.id = a.target_id
              where t.habit_id = h.id and a.status = 'pending') then
    return jsonb_build_object('error', 'busy');
  end if;
  if exists (select 1 from public.challenges c where c.status = 'active'
              and (c.habit_id = h.id or exists (select 1 from public.challenge_habits ch where ch.challenge_id = c.id and ch.habit_id = h.id))) then
    return jsonb_build_object('error', 'in_challenge');
  end if;
  return jsonb_build_object(
    'error', null,
    'paths', coalesce((select jsonb_agg(distinct x) from (
        select p.storage_path as x from public.proofs p join public.targets t on t.id = p.target_id
         where t.habit_id = h.id and p.evidence_deleted_at is null
        union
        select pi.storage_path from public.proof_items pi join public.proofs p on p.id = pi.proof_id
          join public.targets t on t.id = p.target_id
         where t.habit_id = h.id and p.evidence_deleted_at is null) s), '[]'::jsonb));
end $$;

/**
 * Deletes a commitment (call after its photos were removed from storage).
 * Never settled → the row and its schedule are erased.
 * Has results → title, description, notes, proof text, AI notes and photo references are erased and the
 * commitment disappears everywhere; its anonymous results stay so points and the score keep their history.
 */
create or replace function public.delete_commitment(p_user uuid, p_habit uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_check jsonb; v_title text;
begin
  v_check := public.commitment_deletion_check(p_user, p_habit);
  if v_check ->> 'error' is not null then raise exception '%', v_check ->> 'error' using errcode = '22023'; end if;
  select title into v_title from public.habits where id = p_habit;

  delete from public.targets where habit_id = p_habit and status = 'pending';   -- windows that haven't opened

  if not exists (select 1 from public.targets where habit_id = p_habit) then
    delete from public.habits where id = p_habit;
    perform public.audit(p_user, 'commitment_deleted', p_habit, jsonb_build_object('mode', 'erased'));
    return 'erased';
  end if;

  delete from public.proof_items pi using public.proofs p, public.targets t
   where pi.proof_id = p.id and p.target_id = t.id and t.habit_id = p_habit;
  update public.proofs p set critique = null, ai_raw = null, analysis = null, requested_evidence = null,
                             evidence_deleted_at = coalesce(p.evidence_deleted_at, now())
    from public.targets t where p.target_id = t.id and t.habit_id = p_habit;
  update public.appeals a set note = null, critique = null
    from public.targets t where a.target_id = t.id and t.habit_id = p_habit;
  update public.habits
     set title = 'Deleted commitment', description = null, notes = null, proof_hint = null,
         category = 'personal', custom_category = null, activity = null,
         is_active = false, archived_at = coalesce(archived_at, now()), deleted_at = now()
   where id = p_habit;
  perform public.audit(p_user, 'commitment_deleted', p_habit, jsonb_build_object('mode', 'removed'));
  return 'removed';
end $$;

-- =====================================================================
-- 2. Challenges: delete a failed or abandoned challenge
-- =====================================================================
-- Completed challenges earned a bonus in the points ledger and stay as part of the record.
create or replace function public.delete_challenge(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); c public.challenges;
begin
  select * into c from public.challenges where id = p_id and user_id = v_uid;
  if not found then raise exception 'challenge not found' using errcode = 'P0002'; end if;
  if c.status = 'active' then raise exception 'abandon the challenge before deleting it' using errcode = '22023'; end if;
  if c.status = 'completed' then raise exception 'completed challenges stay on your record' using errcode = '22023'; end if;
  delete from public.challenges where id = p_id;
  perform public.audit(v_uid, 'challenge_deleted', p_id, jsonb_build_object('title', c.title, 'status', c.status));
end $$;

-- =====================================================================
-- 3. Profiles: username, photo, what the Arena may show
-- =====================================================================
alter table public.profiles
  add column username       text unique check (username is null or username ~ '^[a-z0-9_]{3,20}$'),
  add column avatar_path    text check (avatar_path is null or avatar_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{8,64}\.(jpg|png|webp)$'),
  add column arena_visible  boolean not null default true,
  add column show_streak    boolean not null default true,
  add column show_challenge boolean not null default true;

-- avatar_url was free text written by the client; photos now go through set_avatar (server-checked path).
update public.profiles set avatar_url = null where avatar_url is not null;
revoke update (avatar_url) on public.profiles from authenticated;
grant update (username, arena_visible, show_streak, show_challenge) on public.profiles to authenticated;

/** Points the profile at a photo the caller uploaded to avatars/<uid>/…; returns the previous path to remove. */
create or replace function public.set_avatar(p_path text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_old text;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_path is null or split_part(p_path, '/', 1) <> v_uid::text
     or p_path !~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{8,64}\.(jpg|png|webp)$' then
    raise exception 'invalid photo path' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'avatars' and o.name = p_path) then
    raise exception 'photo not uploaded' using errcode = '22023';
  end if;
  select avatar_path into v_old from public.profiles where id = v_uid;
  update public.profiles set avatar_path = p_path where id = v_uid;
  return case when v_old is distinct from p_path then v_old end;
end $$;

/** Removes the profile photo reference; returns the path so the app can delete the file. */
create or replace function public.remove_avatar()
returns text language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_old text;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select avatar_path into v_old from public.profiles where id = v_uid;
  update public.profiles set avatar_path = null where id = v_uid;
  return v_old;
end $$;

-- =====================================================================
-- 4. Arena: the community board
-- =====================================================================
-- Levels from all-time points (also in src/lib/level.ts — keep both in sync).
create or replace function public.level_for(p_points integer)
returns integer language sql immutable set search_path = '' as $$
  select case when p_points >= 12000 then 7 when p_points >= 6000 then 6 when p_points >= 3000 then 5
              when p_points >= 1500 then 4 when p_points >= 750 then 3 when p_points >= 250 then 2 else 1 end
$$;

/**
 * Registered users who chose to appear (confirmed account, Arena visibility on), ranked by points in the
 * period: week = since Monday 00:00 UTC, month = since the 1st 00:00 UTC, all = all-time points.
 * Ties share a rank. Never returns e-mail or anything the user marked private. Paged (≤ 50 per page).
 */
create or replace function public.get_arena_board(
  p_period text default 'week', p_sort text default 'points', p_search text default null,
  p_scope text default 'all', p_offset integer default 0, p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_since timestamptz;
  v_lim integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_q text := nullif(trim(coalesce(p_search, '')), '');
  v_res jsonb;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_period not in ('week', 'month', 'all') or p_sort not in ('points', 'streak') or p_scope not in ('all', 'partners') then
    raise exception 'invalid arena query' using errcode = '22023';
  end if;
  v_since := case p_period
    when 'week'  then date_trunc('week',  now() at time zone 'UTC') at time zone 'UTC'
    when 'month' then date_trunc('month', now() at time zone 'UTC') at time zone 'UTC' end;
  if v_q is not null then v_q := '%' || replace(replace(replace(left(v_q, 40), '\', '\\'), '%', '\%'), '_', '\_') || '%'; end if;

  with eligible as (
    select p.id, p.display_name, p.username, p.avatar_path, p.total_points, p.show_streak, p.show_challenge
      from public.profiles p join auth.users u on u.id = p.id
     where u.email_confirmed_at is not null and p.arena_visible
  ),
  period_points as (
    select se.user_id, sum(se.delta)::integer as pts
      from public.score_events se
     where v_since is not null and se.created_at >= v_since
     group by se.user_id
  ),
  streaks as (
    select hb.user_id, max(hb.current_streak)::integer as streak
      from public.habits hb where hb.archived_at is null group by hb.user_id
  ),
  board as (
    select e.*, case when v_since is null then e.total_points else coalesce(pp.pts, 0) end as points,
           coalesce(s.streak, 0) as streak
      from eligible e left join period_points pp on pp.user_id = e.id left join streaks s on s.user_id = e.id
  ),
  ranked as (
    select b.*, rank() over (order by b.points desc)::integer as rnk,
           (b.id = v_uid) as is_me,
           exists (select 1 from public.partnerships ps
                    where (ps.user_a = v_uid and ps.user_b = b.id) or (ps.user_b = v_uid and ps.user_a = b.id)) as is_partner
      from board b
  ),
  filtered as (
    select r.* from ranked r
     where (v_q is null or r.display_name ilike v_q or r.username ilike v_q)
       and (p_scope = 'all' or r.is_partner or r.is_me)
  ),
  page as (
    select f.* from filtered f
     order by case when p_sort = 'streak' then (case when f.show_streak then f.streak else -1 end) end desc nulls last,
              f.rnk, f.id
     offset v_off limit v_lim
  )
  select jsonb_build_object(
    'period', p_period, 'since', v_since,
    'total', (select count(*) from filtered),
    'eligible', (select count(*) from ranked),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'rank', pg.rnk, 'user_id', pg.id, 'display_name', pg.display_name, 'username', pg.username,
        'avatar_path', pg.avatar_path, 'points', pg.points, 'total_points', pg.total_points,
        'level', public.level_for(pg.total_points),
        'streak', case when pg.show_streak or pg.is_me then pg.streak end,
        'challenge', case when pg.show_challenge or pg.is_me then (
            select c.title from public.challenges c where c.user_id = pg.id and c.status = 'active'
             order by c.created_at desc limit 1) end,
        'is_me', pg.is_me, 'is_partner', pg.is_partner)
        order by case when p_sort = 'streak' then (case when pg.show_streak then pg.streak else -1 end) end desc nulls last, pg.rnk, pg.id)
      from page pg), '[]'::jsonb),
    'me', (select jsonb_build_object('rank', r.rnk, 'points', r.points, 'level', public.level_for(r.total_points))
             from ranked r where r.is_me)
  ) into v_res;

  -- The caller's own standing even when hidden from the board (not ranked, so others aren't affected).
  if v_res -> 'me' = 'null'::jsonb or v_res -> 'me' is null then
    v_res := v_res || jsonb_build_object('me', (
      select jsonb_build_object('rank', null, 'hidden', true,
               'points', case when v_since is null then p.total_points
                         else coalesce((select sum(delta) from public.score_events where user_id = p.id and created_at >= v_since), 0) end,
               'level', public.level_for(p.total_points))
        from public.profiles p where p.id = v_uid));
  end if;
  return v_res;
end $$;

-- Arena rows only carry the photo path; keep the old daily board returning it too.
-- (get_arena keeps its signature: avatar_url now carries the storage path of the photo.)
create or replace function public.get_arena(p_day date default null, p_limit integer default 50)
returns table (rank integer, user_id uuid, display_name text, avatar_url text,
               points integer, streak integer, rank_change integer, is_me boolean)
language sql stable security definer set search_path = '' as $$
  with params as (
    select coalesce(p_day, (now() at time zone 'UTC')::date) as d,
           least(greatest(coalesce(p_limit, 50), 1), 100)     as lim
  ),
  visible as (
    select p.id from public.profiles p join auth.users u on u.id = p.id
     where (u.email_confirmed_at is not null and p.arena_visible) or p.id = auth.uid()
  ),
  streaks as (
    select hb.user_id, max(hb.current_streak) as streak from public.habits hb where hb.archived_at is null group by hb.user_id
  ),
  day_points as (
    select se.user_id,
           sum(se.delta) filter (where se.created_at >= (pr.d::timestamp at time zone 'UTC')
                                   and se.created_at <  ((pr.d + 1)::timestamp at time zone 'UTC'))::integer as today,
           sum(se.delta) filter (where se.created_at >= ((pr.d - 1)::timestamp at time zone 'UTC')
                                   and se.created_at <  (pr.d::timestamp at time zone 'UTC'))::integer as yesterday
      from public.score_events se, params pr
     where se.created_at >= ((pr.d - 1)::timestamp at time zone 'UTC')
       and se.created_at <  ((pr.d + 1)::timestamp at time zone 'UTC')
       and se.user_id in (select id from visible)
     group by se.user_id
  ),
  ranked as (
    select dp.user_id, dp.today as points, coalesce(s.streak, 0) as streak,
           row_number() over (order by dp.today desc, coalesce(s.streak, 0) desc, dp.user_id)::integer as rnk
      from day_points dp left join streaks s on s.user_id = dp.user_id
     where dp.today is not null
  ),
  ranked_y as (
    select dp.user_id,
           row_number() over (order by dp.yesterday desc, dp.user_id)::integer as rnk
      from day_points dp where dp.yesterday is not null
  )
  select r.rnk, r.user_id, p.display_name, p.avatar_path, r.points,
         case when p.show_streak or r.user_id = auth.uid() then r.streak else null end,
         (y.rnk - r.rnk) as rank_change, r.user_id = auth.uid()
    from ranked r
    join public.profiles p on p.id = r.user_id
    left join ranked_y y on y.user_id = r.user_id, params pr
   where r.rnk <= pr.lim or r.user_id = auth.uid()
   order by r.rnk;
$$;

-- =====================================================================
-- 5. Privileges
-- =====================================================================
revoke execute on function public.commitment_deletion_check(uuid, uuid), public.delete_commitment(uuid, uuid),
  public.delete_challenge(uuid), public.set_avatar(text), public.remove_avatar(), public.level_for(integer),
  public.get_arena_board(text, text, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.commitment_deletion_check(uuid, uuid), public.delete_commitment(uuid, uuid) to service_role;
grant execute on function public.delete_challenge(uuid), public.set_avatar(text), public.remove_avatar(),
  public.level_for(integer), public.get_arena_board(text, text, text, text, integer, integer) to authenticated;
