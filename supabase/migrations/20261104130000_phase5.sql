-- =====================================================================
-- Phase 5 — free tier and achievements
--   * Free: up to 2 active commitments, Standard verification, points, Discipline Score,
--     War Room, Arena, achievements. Everything else is Premium — enforced here and in the
--     edge functions, never by the app alone.
--   * Achievements: computed from the record on the server, unlocked once, with the moment.
-- =====================================================================

insert into public.app_config (key, value, description) values
  ('free_max_commitments', 2, 'Active commitments a free account can have.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 1. Free-tier limits
-- ---------------------------------------------------------------------
create or replace function public.habits_free_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or public.has_premium(new.user_id) then return new; end if;
  if new.is_active and new.archived_at is null
     and (tg_op = 'INSERT' or not old.is_active or old.archived_at is not null)
     and (select count(*) from public.habits h
           where h.user_id = new.user_id and h.is_active and h.archived_at is null and h.id <> new.id) >= public.cfg('free_max_commitments') then
    raise exception 'premium_required: Free accounts can have % active commitments. Pause one or go Premium.', public.cfg('free_max_commitments')
      using errcode = '42501';
  end if;
  return new;
end $$;
create trigger habits_free_limit before insert or update of is_active, archived_at on public.habits
  for each row execute function public.habits_free_limit();

create or replace function public.challenges_premium_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.has_premium(new.user_id) then
    raise exception 'premium_required: Challenges are part of Premium' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger challenges_premium_guard before insert on public.challenges
  for each row execute function public.challenges_premium_guard();

-- What the signed-in account may do (for the app's UI; every rule is enforced server-side).
create or replace function public.get_plan()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'premium', public.has_premium(auth.uid()),
    'free_max_commitments', public.cfg('free_max_commitments'),
    'active_commitments', (select count(*) from public.habits where user_id = auth.uid() and is_active and archived_at is null)
  )
$$;

-- ---------------------------------------------------------------------
-- 2. Achievements
-- ---------------------------------------------------------------------
create table public.achievement_defs (
  key          text primary key,
  title        text not null,
  description  text not null,
  sort         smallint not null
);
insert into public.achievement_defs (key, title, description, sort) values
  ('first_proof',     'First proof',        'Your first verified target.', 1),
  ('streak_7',        'One week straight',  'A 7-day streak on one commitment.', 2),
  ('perfect_week',    'Perfect week',       'A Monday-to-Sunday week with at least 5 targets, all verified.', 3),
  ('comeback',        'Comeback',           'Verified the next target after a miss.', 4),
  ('points_1000',     '1,000 points',       'Reach 1,000 total points.', 5),
  ('challenge_done',  'Challenge complete', 'Finish a challenge.', 6),
  ('score_80',        'Disciplined',        'A Discipline Score of 80 or more (not provisional).', 7),
  ('streak_30',       'Thirty days',        'A 30-day streak on one commitment.', 8),
  ('elite_proof',     'Elite proof',        'A target verified at Elite level.', 9),
  ('appeal_won',      'Overturned',         'Win an appeal.', 10),
  ('challenges_3',    'Three challenges',   'Finish three challenges.', 11),
  ('points_5000',     '5,000 points',       'Reach 5,000 total points.', 12),
  ('streak_100',      'One hundred',        'A 100-day streak on one commitment.', 13);

create table public.achievements (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  key          text not null references public.achievement_defs (key),
  unlocked_at  timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.achievement_defs enable row level security;
alter table public.achievements enable row level security;
revoke all on public.achievement_defs, public.achievements from anon, authenticated;
grant select on public.achievement_defs, public.achievements to authenticated;
create policy achievement_defs_read on public.achievement_defs for select to authenticated using (true);
create policy achievements_own on public.achievements for select to authenticated using (user_id = (select auth.uid()));

-- Which achievements the record already earns. Pure read; award_achievements() stores them.
create or replace function public.earned_achievements(p_user uuid)
returns setof text language sql stable security definer set search_path = '' as $$
  with h as (select coalesce(max(longest_streak), 0) as best from public.habits where user_id = p_user),
       p as (select total_points from public.profiles where id = p_user),
       c as (select count(*) as n from public.challenges where user_id = p_user and status = 'completed')
  select k from (
    select 'first_proof' as k where exists (select 1 from public.targets where user_id = p_user and status = 'verified')
    union all select 'streak_7'  from h where best >= 7
    union all select 'streak_30' from h where best >= 30
    union all select 'streak_100' from h where best >= 100
    union all select 'points_1000' from p where total_points >= 1000
    union all select 'points_5000' from p where total_points >= 5000
    union all select 'challenge_done' from c where n >= 1
    union all select 'challenges_3' from c where n >= 3
    union all select 'score_80' where exists (select 1 from public.discipline_scores where user_id = p_user and score >= 80 and not provisional)
    union all select 'appeal_won' where exists (select 1 from public.appeals where user_id = p_user and status = 'overturned')
    union all select 'elite_proof' where exists (select 1 from public.proofs pr join public.targets t on t.id = pr.target_id
                                                  where pr.user_id = p_user and pr.level = 'elite' and pr.outcome = 'verified' and t.status = 'verified')
    union all select 'perfect_week' where exists (
      select 1 from public.targets where user_id = p_user and status in ('verified', 'missed', 'rejected')
       group by date_trunc('week', local_date)
      having count(*) >= 5 and count(*) filter (where status <> 'verified') = 0
         and date_trunc('week', min(local_date)) < date_trunc('week', now()))
    union all select 'comeback' where exists (
      select 1 from (
        select status, lag(status) over (partition by habit_id order by due_at) as prev
          from public.targets where user_id = p_user and status in ('verified', 'missed', 'rejected')) s
       where s.status = 'verified' and s.prev in ('missed', 'rejected'))
  ) x
$$;

create or replace function public.award_achievements(p_user uuid)
returns setof text language sql security definer set search_path = '' as $$
  insert into public.achievements (user_id, key)
  select p_user, k from public.earned_achievements(p_user) k
  on conflict do nothing
  returning key
$$;

-- For cron: everyone with ledger or challenge activity since p_since.
create or replace function public.award_achievements_recent(p_since timestamptz)
returns table (user_id uuid, key text, title text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare u uuid; k text;
begin
  for u in select distinct s.user_id from public.score_events s where s.created_at >= p_since
           union select distinct a.user_id from public.appeals a where a.decided_at >= p_since
           union select distinct d.user_id from public.discipline_scores d where d.computed_at >= p_since and d.score >= 80 loop
    for k in select public.award_achievements(u) loop
      user_id := u; key := k; title := (select d.title from public.achievement_defs d where d.key = k); return next;
    end loop;
  end loop;
end $$;

create or replace function public.get_achievements()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '42501'; end if;
  perform public.award_achievements(v_uid);   -- never wait for the cron to show what's earned
  return coalesce((
    select jsonb_agg(jsonb_build_object('key', d.key, 'title', d.title, 'description', d.description, 'unlocked_at', a.unlocked_at) order by d.sort)
      from public.achievement_defs d left join public.achievements a on a.key = d.key and a.user_id = v_uid), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 3. Privileges
-- ---------------------------------------------------------------------
revoke execute on function public.habits_free_limit(), public.challenges_premium_guard(), public.get_plan(),
  public.earned_achievements(uuid), public.award_achievements(uuid), public.award_achievements_recent(timestamptz),
  public.get_achievements()
  from public, anon, authenticated;
grant execute on function public.get_plan(), public.get_achievements() to authenticated;
grant execute on function public.earned_achievements(uuid), public.award_achievements(uuid), public.award_achievements_recent(timestamptz) to service_role;
