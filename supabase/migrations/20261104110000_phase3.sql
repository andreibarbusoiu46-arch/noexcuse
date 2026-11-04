-- =====================================================================
-- Phase 3 — coaching
--   * AI coach: conversation history + a data snapshot built on the server.
--   * Weekly reports: computed from targets and the ledger, Monday morning local time.
--   * Smart reminders: a heads-up for commitments you keep missing, and a last call
--     before a window closes; per-user notification preferences.
-- =====================================================================

insert into public.app_config (key, value, description) values
  ('coach_daily_messages', 20, 'Coach messages a user can send per day.'),
  ('heads_up_minutes', 60, 'How long before a window opens the smart heads-up is sent.'),
  ('heads_up_miss_threshold', 2, 'Misses in the last 7 settled targets of a commitment that trigger the heads-up.'),
  ('last_call_minutes', 5, 'How long before a window closes the last call is sent.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 1. Notification preferences (the user's own switches)
-- ---------------------------------------------------------------------
alter table public.profiles add column notify_prefs jsonb not null
  default '{"reminders": true, "heads_up": true, "last_call": true, "weekly_report": true, "partners": true}'::jsonb
  check (jsonb_typeof(notify_prefs) = 'object');
grant update (notify_prefs) on public.profiles to authenticated;

create or replace function public.wants(p_user uuid, p_kind text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select (notify_prefs ->> p_kind)::boolean from public.profiles where id = p_user), true)
$$;

-- ---------------------------------------------------------------------
-- 2. AI coach
-- ---------------------------------------------------------------------
create table public.coach_messages (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  role        text not null check (role in ('user', 'coach')),
  content     text not null check (char_length(content) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index coach_messages_user_idx on public.coach_messages (user_id, created_at desc);
alter table public.coach_messages enable row level security;
create policy coach_messages_own_select on public.coach_messages for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.coach_messages from anon, authenticated;
grant select on public.coach_messages to authenticated;

-- Messages the user sent today (their local day), for the daily limit.
create or replace function public.coach_messages_today(p_user uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.coach_messages m join public.profiles p on p.id = m.user_id
   where m.user_id = p_user and m.role = 'user'
     and (m.created_at at time zone p.timezone)::date = (now() at time zone p.timezone)::date
$$;

-- Everything the coach may know, computed on the server. Titles and numbers only — never photos,
-- never private notes.
create or replace function public.get_coach_context(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_tz text; v_today date; v jsonb;
begin
  select timezone into v_tz from public.profiles where id = p_user;
  if v_tz is null then return null; end if;
  v_today := (now() at time zone v_tz)::date;
  select jsonb_build_object(
    'today', v_today,
    'weekday', to_char(v_today, 'FMDay'),
    'local_time', to_char(now() at time zone v_tz, 'HH24:MI'),
    'name', p.display_name,
    'total_points', p.total_points,
    'discipline', (select jsonb_build_object('score', d.score, 'provisional', d.provisional, 'components', d.detail -> 'components', 'counts', d.detail -> 'counts')
                     from public.discipline_scores d where d.user_id = p_user order by d.day desc limit 1),
    'commitments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'title', h.title, 'category', coalesce(h.custom_category, h.category), 'time', to_char(h.target_time, 'HH24:MI'),
               'weekdays', h.weekdays, 'level', h.verification_level, 'active', h.is_active,
               'streak', h.current_streak, 'longest_streak', h.longest_streak,
               'last_28', (select jsonb_build_object(
                                    'verified', count(*) filter (where t.status = 'verified'),
                                    'missed', count(*) filter (where t.status = 'missed'),
                                    'rejected', count(*) filter (where t.status = 'rejected'),
                                    'excused', count(*) filter (where t.status = 'excused'))
                             from public.targets t where t.habit_id = h.id and t.status <> 'pending'
                              and t.local_date between v_today - 27 and v_today))
             order by h.target_time)
        from public.habits h where h.user_id = p_user and h.archived_at is null), '[]'::jsonb),
    'recent_failures', coalesce((
      select jsonb_agg(x order by x ->> 'date' desc) from (
        select jsonb_build_object('date', t.local_date, 'weekday', to_char(t.local_date, 'FMDy'), 'title', h.title,
                                  'due', to_char(t.due_at at time zone v_tz, 'HH24:MI'), 'status', t.status,
                                  'reason', (select pr.critique from public.proofs pr where pr.target_id = t.id and pr.critique is not null
                                              order by pr.created_at desc limit 1)) as x
          from public.targets t join public.habits h on h.id = t.habit_id
         where t.user_id = p_user and t.status in ('missed', 'rejected') and t.local_date >= v_today - 13
         order by t.due_at desc limit 10) f), '[]'::jsonb),
    'by_weekday', coalesce((
      select jsonb_object_agg(wd, rate) from (
        select to_char(t.local_date, 'FMDy') as wd,
               round(100.0 * count(*) filter (where t.status = 'verified') / nullif(count(*) filter (where t.status in ('verified', 'missed', 'rejected')), 0)) as rate
          from public.targets t where t.user_id = p_user and t.local_date between v_today - 27 and v_today and t.status <> 'pending'
         group by 1) w where rate is not null), '{}'::jsonb),
    'challenges', coalesce((
      select jsonb_agg(jsonb_build_object('title', c.title, 'commitment', h.title, 'progress', public.challenge_progress(c.id)))
        from public.challenges c join public.habits h on h.id = c.habit_id where c.user_id = p_user and c.status = 'active'), '[]'::jsonb),
    'today_targets', coalesce((
      select jsonb_agg(jsonb_build_object('title', h.title, 'due', to_char(t.due_at at time zone v_tz, 'HH24:MI'), 'status', t.status) order by t.due_at)
        from public.targets t join public.habits h on h.id = t.habit_id where t.user_id = p_user and t.local_date = v_today), '[]'::jsonb)
  ) into v
  from public.profiles p where p.id = p_user;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 3. Weekly reports
-- ---------------------------------------------------------------------
create table public.weekly_reports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  week_start  date not null,             -- local Monday
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  unique (user_id, week_start)
);
alter table public.weekly_reports enable row level security;
-- No direct client access: reports are read through get_weekly_reports(), which checks Premium.
revoke all on public.weekly_reports from anon, authenticated;

create or replace function public.build_weekly_report(p_user uuid, p_week_start date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text; v_end date := p_week_start + 6; v_out jsonb; v_prev_rate integer;
  v_from timestamptz; v_to timestamptz;
begin
  select timezone into v_tz from public.profiles where id = p_user;
  v_from := p_week_start::timestamp at time zone v_tz;
  v_to   := (v_end + 1)::timestamp at time zone v_tz;
  select round(100.0 * count(*) filter (where status = 'verified') / nullif(count(*) filter (where status in ('verified', 'missed', 'rejected')), 0))
    into v_prev_rate from public.targets where user_id = p_user and local_date between p_week_start - 7 and p_week_start - 1;

  with t as (
    select t.*, h.title from public.targets t join public.habits h on h.id = t.habit_id
     where t.user_id = p_user and t.local_date between p_week_start and v_end and t.status <> 'pending'
  ), per as (
    select title, count(*) filter (where status = 'verified') as v, count(*) filter (where status in ('verified', 'missed', 'rejected')) as n
      from t group by title
  ), wd as (
    select extract(isodow from local_date)::int as d, to_char(local_date, 'FMDay') as name,
           count(*) filter (where status = 'verified') as v, count(*) filter (where status in ('verified', 'missed', 'rejected')) as n
      from t group by 1, 2
  )
  select jsonb_build_object(
    'week_start', p_week_start, 'week_end', v_end,
    'settled', (select count(*) from t where status in ('verified', 'missed', 'rejected')),
    'verified', (select count(*) from t where status = 'verified'),
    'missed', (select count(*) from t where status = 'missed'),
    'rejected', (select count(*) from t where status = 'rejected'),
    'excused', (select count(*) from t where status = 'excused'),
    'success_rate', (select round(100.0 * count(*) filter (where status = 'verified') / nullif(count(*) filter (where status in ('verified', 'missed', 'rejected')), 0)) from t),
    'previous_success_rate', v_prev_rate,
    'points', (select coalesce(sum(delta), 0) from public.score_events where user_id = p_user and created_at >= v_from and created_at < v_to),
    'score_start', (select score from public.discipline_scores where user_id = p_user and day <= p_week_start order by day desc limit 1),
    'score_end', (select score from public.discipline_scores where user_id = p_user and day <= v_end order by day desc limit 1),
    'best', (select jsonb_build_object('title', title, 'verified', v, 'settled', n) from per where n >= 2 order by v::numeric / n desc, n desc, title limit 1),
    'worst', (select jsonb_build_object('title', title, 'verified', v, 'settled', n) from per where n >= 2 and v < n order by v::numeric / n, n desc, title limit 1),
    'best_day', (select name from wd where n > 0 order by v::numeric / n desc, n desc, d limit 1),
    'hardest_day', (select name from wd where n > 0 and v < n order by v::numeric / n, n desc, d limit 1),
    'commitments', coalesce((select jsonb_agg(jsonb_build_object('title', title, 'verified', v, 'settled', n) order by title) from per), '[]'::jsonb),
    'challenges_completed', (select count(*) from public.challenges where user_id = p_user and status = 'completed' and finished_at >= v_from and finished_at < v_to),
    'challenges_failed', (select count(*) from public.challenges where user_id = p_user and status = 'failed' and finished_at >= v_from and finished_at < v_to),
    'longest_streak', (select coalesce(max(current_streak), 0) from public.habits where user_id = p_user and archived_at is null)
  ) into v_out;
  return v_out;
end $$;

-- Monday from 06:00 local time: last week's report for everyone who had a scheduled target.
create or replace function public.generate_weekly_reports(p_now timestamptz default now())
returns table (user_id uuid, report_id uuid, week_start date)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare u record; v_week date; v_id uuid;
begin
  for u in select p.id, p.timezone, (p_now at time zone p.timezone) as local_now from public.profiles p loop
    continue when extract(isodow from u.local_now) <> 1 or extract(hour from u.local_now) < 6;
    v_week := u.local_now::date - 7;
    continue when exists (select 1 from public.weekly_reports r where r.user_id = u.id and r.week_start = v_week);
    continue when not exists (select 1 from public.targets t where t.user_id = u.id and t.local_date between v_week and v_week + 6);
    insert into public.weekly_reports (user_id, week_start, data)
    values (u.id, v_week, public.build_weekly_report(u.id, v_week))
    on conflict do nothing returning id into v_id;
    if v_id is not null then
      user_id := u.id; report_id := v_id; week_start := v_week; return next;
    end if;
  end loop;
end $$;

-- Premium read. Free accounts see how many reports are waiting, not their content.
create or replace function public.get_weekly_reports(p_limit integer default 12)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when public.has_premium(auth.uid()) then jsonb_build_object(
           'locked', false,
           'reports', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'week_start', r.week_start, 'data', r.data, 'created_at', r.created_at) order by r.week_start desc)
                                  from (select * from public.weekly_reports where user_id = auth.uid() order by week_start desc limit least(greatest(p_limit, 1), 52)) r), '[]'::jsonb))
         else jsonb_build_object('locked', true, 'count', (select count(*) from public.weekly_reports where user_id = auth.uid()), 'reports', '[]'::jsonb)
         end
$$;

-- ---------------------------------------------------------------------
-- 4. Smart reminders
-- ---------------------------------------------------------------------
-- Targets that need a heads-up (a commitment missed often lately) or a last call (window
-- closing, nothing submitted). Premium only; respects the user's switches.
create or replace function public.smart_reminder_candidates(p_now timestamptz default now())
returns table (kind text, target_id uuid, user_id uuid, title text, due_at timestamptz, timezone text, misses integer)
language sql stable security definer set search_path = '' as $$
  with base as (
    select t.id, t.user_id, t.habit_id, t.due_at, h.title, p.timezone
      from public.targets t join public.habits h on h.id = t.habit_id join public.profiles p on p.id = t.user_id
     where t.status = 'pending' and h.is_active and h.archived_at is null
       and t.due_at between p_now - interval '15 minutes' and p_now + interval '3 hours'
       and public.has_premium(t.user_id)
  )
  select 'heads_up', b.id, b.user_id, b.title, b.due_at, b.timezone, m.n
    from base b
    cross join lateral (select count(*) filter (where s.status in ('missed', 'rejected'))::integer as n
                          from (select status from public.targets x where x.habit_id = b.habit_id and x.status in ('verified', 'missed', 'rejected')
                                 order by x.due_at desc limit 7) s) m
   where m.n >= public.cfg('heads_up_miss_threshold')
     and p_now >= b.due_at - interval '15 minutes' - make_interval(mins => public.cfg('heads_up_minutes'))
     and p_now <  b.due_at - interval '15 minutes' - make_interval(mins => public.cfg('heads_up_minutes')) + interval '10 minutes'
     and public.wants(b.user_id, 'heads_up')
  union all
  select 'last_call', b.id, b.user_id, b.title, b.due_at, b.timezone, 0
    from base b
   where p_now >= b.due_at + interval '15 minutes' - make_interval(mins => public.cfg('last_call_minutes'))
     and p_now <  b.due_at + interval '15 minutes'
     and not exists (select 1 from public.proofs pr where pr.target_id = b.id and pr.outcome in ('processing', 'verified', 'error'))
     and public.wants(b.user_id, 'last_call')
$$;

-- ---------------------------------------------------------------------
-- 5. Privileges
-- ---------------------------------------------------------------------
revoke execute on function public.wants(uuid, text), public.coach_messages_today(uuid), public.get_coach_context(uuid),
  public.build_weekly_report(uuid, date), public.generate_weekly_reports(timestamptz), public.get_weekly_reports(integer),
  public.smart_reminder_candidates(timestamptz)
  from public, anon, authenticated;
grant execute on function public.wants(uuid, text), public.coach_messages_today(uuid), public.get_coach_context(uuid),
  public.build_weekly_report(uuid, date), public.generate_weekly_reports(timestamptz), public.smart_reminder_candidates(timestamptz)
  to service_role;
grant execute on function public.get_weekly_reports(integer) to authenticated;
