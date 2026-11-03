-- =====================================================================
-- Phase 1 — core accountability
--   * Central points configuration (no hard-coded +50/−100 in scoring code).
--   * The points ledger (score_events) becomes append-only for every role.
--   * Commitment details: category, description, private notes, archive.
--   * Discipline Score 0–100: transparent formula, daily history.
--   * Challenges: templates + participations, progress, bonus paid once.
--   * Read models for the War Room.
--   * Audit log for actions that change standing.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Central configuration
-- ---------------------------------------------------------------------
create table public.app_config (
  key          text primary key,
  value        integer not null,
  description  text not null,
  updated_at   timestamptz not null default now()
);
insert into public.app_config (key, value, description) values
  ('points_verified', 50, 'Points added when a target is verified.'),
  ('points_failed', -100, 'Points added (negative) when a target is missed, late or rejected.'),
  ('challenge_bonus_per_day', 10, 'Bonus per required challenge day, paid once when the challenge is completed.');

create or replace function public.cfg(p_key text)
returns integer language sql stable security invoker set search_path = '' as $$
  select value from public.app_config where key = p_key
$$;

-- ---------------------------------------------------------------------
-- 2. Audit log (written only by server functions)
-- ---------------------------------------------------------------------
create table public.audit_log (
  id       bigint generated always as identity primary key,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  action   text not null,
  ref_id   uuid,
  data     jsonb not null default '{}'::jsonb,
  at       timestamptz not null default now()
);
create index audit_log_user_idx on public.audit_log (user_id, at desc);

create or replace function public.audit(p_user uuid, p_action text, p_ref uuid, p_data jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (user_id, action, ref_id, data) values (p_user, p_action, p_ref, coalesce(p_data, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------
-- 3. Points ledger: configurable values, challenge bonuses, append-only
-- ---------------------------------------------------------------------
alter type public.score_reason add value if not exists 'challenge_bonus';

alter table public.score_events
  drop constraint score_events_delta_check,
  drop constraint score_events_check,
  alter column target_id drop not null,
  alter column habit_id drop not null,
  add column challenge_id uuid unique;

-- Gains only for verified targets and challenge bonuses; every other reason is a loss.
alter table public.score_events add constraint score_events_sign check (
  delta <> 0 and ((reason::text in ('verified', 'challenge_bonus')) = (delta > 0)));
-- Every row comes from exactly one source: a target, or a completed challenge.
alter table public.score_events add constraint score_events_source check (
  (target_id is not null and challenge_id is null and reason::text <> 'challenge_bonus')
  or (target_id is null and challenge_id is not null and reason::text = 'challenge_bonus'));

-- Append-only for every role, including the service role. Rows only leave through a cascade
-- (account deletion), which runs inside a referential-integrity trigger.
create or replace function public.score_events_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'the points ledger is append-only' using errcode = '42501';
end $$;
create trigger score_events_append_only before update or delete on public.score_events
  for each row execute function public.score_events_append_only();

-- Scoring now reads its values from app_config.
create or replace function public.apply_verdict(
  p_proof_id    uuid,
  p_outcome     text,
  p_critique    text,
  p_confidence  numeric,
  p_model       text,
  p_raw         jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  pr        public.proofs;
  t         public.targets;
  h         public.habits;
  v_delta   integer;
  v_reason  public.score_reason;
  v_status  public.target_status;
  v_streak  integer;
  v_total   integer;
  c         integer;
begin
  if p_outcome not in ('verified', 'rejected', 'insufficient', 'expired', 'error') then
    raise exception 'invalid outcome %', p_outcome using errcode = '22023';
  end if;

  select * into pr from public.proofs where id = p_proof_id for update;
  if not found then raise exception 'proof not found' using errcode = 'P0002'; end if;
  select * into t from public.targets where id = pr.target_id for update;
  select * into h from public.habits  where id = t.habit_id  for update;

  update public.proofs
     set outcome = p_outcome::public.proof_outcome, critique = left(p_critique, 600),
         confidence = p_confidence, model = p_model, ai_raw = p_raw,
         attempts = attempts + 1, judged_at = now()
   where id = pr.id;

  select total_points into v_total from public.profiles where id = t.user_id;

  if t.status <> 'pending' then
    return jsonb_build_object('outcome', p_outcome, 'points_delta', 0, 'streak', h.current_streak,
                              'total_points', v_total, 'target_status', t.status, 'already_settled', true);
  end if;

  if p_outcome = 'verified' then
    if pr.received_at not between t.due_at - interval '15 minutes' and t.due_at + interval '15 minutes' then
      raise exception 'proof received outside the window' using errcode = '22023';
    end if;
    v_delta := public.cfg('points_verified'); v_reason := 'verified'; v_status := 'verified'; v_streak := h.current_streak + 1;
  elsif p_outcome = 'rejected' then
    v_delta := public.cfg('points_failed');   v_reason := 'rejected'; v_status := 'rejected'; v_streak := 0;
  elsif p_outcome = 'expired' then
    v_delta := public.cfg('points_failed');   v_reason := 'expired';  v_status := 'missed';   v_streak := 0;
  else
    return jsonb_build_object('outcome', p_outcome, 'points_delta', 0, 'streak', h.current_streak,
                              'total_points', v_total, 'target_status', 'pending', 'already_settled', false);
  end if;

  insert into public.score_events (user_id, habit_id, target_id, proof_id, delta, reason, streak_after)
  values (t.user_id, h.id, t.id, pr.id, v_delta, v_reason, v_streak)
  on conflict (target_id) do nothing;
  get diagnostics c = row_count;
  if c = 0 then
    return jsonb_build_object('outcome', p_outcome, 'points_delta', 0, 'streak', h.current_streak,
                              'total_points', v_total, 'target_status', t.status, 'already_settled', true);
  end if;

  update public.targets set status = v_status, settled_at = now() where id = t.id;
  update public.habits set current_streak = v_streak, longest_streak = greatest(longest_streak, v_streak)
   where id = h.id;
  update public.profiles set total_points = total_points + v_delta where id = t.user_id
   returning total_points into v_total;

  return jsonb_build_object('outcome', p_outcome, 'points_delta', v_delta, 'streak', v_streak,
                            'total_points', v_total, 'target_status', v_status, 'already_settled', false);
end $$;

create or replace function public.settle_due_targets(p_now timestamptz default now())
returns table (target_id uuid, user_id uuid, habit_id uuid, habit_title text, next_due_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare t record; c integer; v_next timestamptz; v_fail integer := public.cfg('points_failed');
begin
  for t in
    select tg.id, tg.user_id, tg.habit_id, hb.title
      from public.targets tg join public.habits hb on hb.id = tg.habit_id
     where tg.status = 'pending'
       and tg.due_at + interval '15 minutes' < p_now
       and not exists (
         select 1 from public.proofs p
          where p.target_id = tg.id and p.outcome in ('processing', 'error')
            and p.received_at <= tg.due_at + interval '15 minutes')
     order by tg.due_at
     for update of tg skip locked
  loop
    insert into public.score_events (user_id, habit_id, target_id, delta, reason, streak_after)
    values (t.user_id, t.habit_id, t.id, v_fail, 'missed', 0)
    on conflict (target_id) do nothing;
    get diagnostics c = row_count;
    continue when c = 0;

    update public.targets set status = 'missed', settled_at = p_now where id = t.id;
    update public.habits set current_streak = 0 where id = t.habit_id;
    update public.profiles set total_points = total_points + v_fail where id = t.user_id;

    select min(n.due_at) into v_next from public.targets n
     where n.habit_id = t.habit_id and n.status = 'pending' and n.due_at > p_now;

    target_id := t.id; user_id := t.user_id; habit_id := t.habit_id; habit_title := t.title; next_due_at := v_next;
    return next;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. Commitment details + archive (history is kept; archived = inactive for good)
-- ---------------------------------------------------------------------
alter table public.habits
  add column category        text not null default 'personal'
    check (category in ('fitness', 'health', 'education', 'productivity', 'business', 'personal', 'lifestyle', 'custom')),
  add column custom_category text check (custom_category is null or char_length(trim(custom_category)) between 1 and 30),
  add column description     text check (description is null or char_length(description) <= 500),
  add column notes           text check (notes is null or char_length(notes) <= 1000),
  add column archived_at     timestamptz,
  add constraint habits_custom_category check ((category = 'custom') = (custom_category is not null));
create index habits_user_active_idx on public.habits (user_id) where archived_at is null;

create or replace function public.habits_archive_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.archived_at is not null then
    new.is_active := false;                                 -- an archived commitment never schedules again
    if old.archived_at is null then
      perform public.audit(new.user_id, 'commitment_archived', new.id, jsonb_build_object('title', new.title));
    end if;
  end if;
  if old.archived_at is not null and new.archived_at is null then
    raise exception 'archived commitments cannot be restored; create a new one' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger habits_archive_guard before update on public.habits
  for each row execute function public.habits_archive_guard();

-- Archiving must also drop windows that have not opened yet.
drop trigger habits_schedule_upd on public.habits;
create trigger habits_schedule_upd after update of target_time, weekdays, is_active, archived_at on public.habits
  for each row execute function public.habits_reschedule();

grant insert (category, custom_category, description, notes) on public.habits to authenticated;
grant update (category, custom_category, description, notes, archived_at) on public.habits to authenticated;

-- ---------------------------------------------------------------------
-- 5. Discipline Score (0–100)
--   completion  45%  verified / settled targets, last 28 days
--   recent      25%  same, last 7 days (falls back to completion)
--   consistency 20%  share of the last 14 days with targets and no failure
--   streak      10%  best current streak, capped at 21 days
--   Settled = verified, missed or rejected. Excused (our outage) never counts.
--   Provisional until 5 targets have been settled in the last 28 days.
--   Targets cannot be deleted by users, and archiving keeps them, so the score
--   cannot be reset by removing and re-creating commitments.
-- ---------------------------------------------------------------------
create table public.discipline_scores (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  day          date not null,
  score        smallint check (score between 0 and 100),
  provisional  boolean not null,
  detail       jsonb not null,
  computed_at  timestamptz not null default now(),
  primary key (user_id, day)
);

create or replace function public.compute_discipline_score(p_user uuid, p_day date default null)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_tz text; v_day date;
  s28 integer; v28 integer; s7 integer; v7 integer; d14 integer; clean14 integer; v_streak integer;
  c_completion numeric; c_recent numeric; c_consistency numeric; c_streak numeric;
begin
  select timezone into v_tz from public.profiles where id = p_user;
  if v_tz is null then return null; end if;
  v_day := coalesce(p_day, (now() at time zone v_tz)::date);

  select count(*) filter (where status in ('verified', 'rejected', 'missed')),
         count(*) filter (where status = 'verified')
    into s28, v28
    from public.targets where user_id = p_user and local_date between v_day - 27 and v_day;
  select count(*) filter (where status in ('verified', 'rejected', 'missed')),
         count(*) filter (where status = 'verified')
    into s7, v7
    from public.targets where user_id = p_user and local_date between v_day - 6 and v_day;
  select count(*), count(*) filter (where fails = 0)
    into d14, clean14
    from (select local_date, count(*) filter (where status in ('rejected', 'missed')) as fails
            from public.targets
           where user_id = p_user and local_date between v_day - 13 and v_day
             and status in ('verified', 'rejected', 'missed')
           group by local_date) d;
  select coalesce(max(current_streak), 0) into v_streak
    from public.habits where user_id = p_user and archived_at is null;

  if s28 = 0 then
    return jsonb_build_object('score', null, 'provisional', true, 'day', v_day, 'components', null,
      'weights', jsonb_build_object('completion', 45, 'recent', 25, 'consistency', 20, 'streak', 10),
      'counts', jsonb_build_object('settled_28', 0, 'verified_28', 0, 'settled_7', s7, 'verified_7', v7,
                                   'days_14', d14, 'clean_days_14', clean14, 'streak', v_streak));
  end if;

  c_completion  := v28::numeric / s28;
  c_recent      := case when s7 > 0 then v7::numeric / s7 else c_completion end;
  c_consistency := case when d14 > 0 then clean14::numeric / d14 else c_completion end;
  c_streak      := least(v_streak, 21)::numeric / 21;

  return jsonb_build_object(
    'score', round(100 * (0.45 * c_completion + 0.25 * c_recent + 0.20 * c_consistency + 0.10 * c_streak))::integer,
    'provisional', s28 < 5,
    'day', v_day,
    'components', jsonb_build_object('completion', round(100 * c_completion)::integer, 'recent', round(100 * c_recent)::integer,
                                     'consistency', round(100 * c_consistency)::integer, 'streak', round(100 * c_streak)::integer),
    'weights', jsonb_build_object('completion', 45, 'recent', 25, 'consistency', 20, 'streak', 10),
    'counts', jsonb_build_object('settled_28', s28, 'verified_28', v28, 'settled_7', s7, 'verified_7', v7,
                                 'days_14', d14, 'clean_days_14', clean14, 'streak', v_streak));
end $$;

-- Daily snapshot for every user (latest value of the user's local day wins). Run by cron.
create or replace function public.snapshot_discipline_scores()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; j jsonb; n integer := 0;
begin
  for r in select id from public.profiles loop
    j := public.compute_discipline_score(r.id, null);
    continue when j is null;
    insert into public.discipline_scores (user_id, day, score, provisional, detail)
    values (r.id, (j ->> 'day')::date, (j ->> 'score')::smallint, (j ->> 'provisional')::boolean, j)
    on conflict (user_id, day) do update
      set score = excluded.score, provisional = excluded.provisional, detail = excluded.detail, computed_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;

-- Score now, the last 90 days, and weekly / monthly averages (caller's own data only).
create or replace function public.get_discipline()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'current', public.compute_discipline_score(auth.uid(), null),
    'history', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'score', score, 'provisional', provisional) order by day)
                           from public.discipline_scores
                          where user_id = auth.uid() and day > current_date - 90 and score is not null), '[]'::jsonb),
    'weekly',  coalesce((select jsonb_agg(jsonb_build_object('week', w, 'avg', a) order by w)
                           from (select date_trunc('week', day)::date as w, round(avg(score))::integer as a
                                   from public.discipline_scores
                                  where user_id = auth.uid() and score is not null and day > current_date - 56
                                  group by 1) x), '[]'::jsonb),
    'monthly', coalesce((select jsonb_agg(jsonb_build_object('month', m, 'avg', a) order by m)
                           from (select date_trunc('month', day)::date as m, round(avg(score))::integer as a
                                   from public.discipline_scores
                                  where user_id = auth.uid() and score is not null and day > current_date - 186
                                  group by 1) x), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------
-- 6. Challenges
-- ---------------------------------------------------------------------
create table public.challenge_templates (
  id              text primary key check (id ~ '^[a-z0-9-]{3,40}$'),
  title           text not null,
  tagline         text not null,
  description     text not null,
  category        text not null,
  duration_days   smallint not null check (duration_days between 3 and 90),
  allowed_misses  smallint not null default 0 check (allowed_misses between 0 and 10),
  -- Suggested commitment; null means "bring one of your own commitments".
  habit_title     text,
  habit_time      time,
  habit_weekdays  smallint[],
  proof_hint      text,
  sort            smallint not null default 0
);

insert into public.challenge_templates
  (id, title, tagline, description, category, duration_days, allowed_misses, habit_title, habit_time, habit_weekdays, proof_hint, sort) values
  ('discipline-30', '30 Days of Discipline', 'One commitment. Thirty days. Up to two misses.',
   'Pick any commitment you already have and keep it for 30 days. You can miss at most two scheduled days.',
   'personal', 30, 2, null, null, null, null, 1),
  ('no-excuses-30', '30 Days Without Excuses', 'Thirty days. Zero misses.',
   'Keep one commitment every scheduled day for 30 days. A single miss ends the challenge.',
   'personal', 30, 0, null, null, null, null, 2),
  ('early-7', '7 Days of Early Mornings', 'Up at six, seven days running.',
   'Prove you are up and moving at 06:00 every day for a week.',
   'lifestyle', 7, 0, 'Up at 06:00', '06:00', '{1,2,3,4,5,6,7}',
   'My face and a clock or phone screen showing the time, in a lit room.', 3),
  ('fitness-30', '30 Days of Fitness', 'A workout a day for a month. Three misses allowed.',
   'Train every day for 30 days. Gym, run, home workout — the photo has to show it.',
   'fitness', 30, 3, 'Workout — 30 min', '18:00', '{1,2,3,4,5,6,7}',
   'Me training, or the gym floor / equipment with me in frame.', 4),
  ('deep-work-21', '21 Days of Deep Work', 'Ninety focused minutes, every weekday.',
   'Three weeks of weekday deep-work blocks. One miss allowed.',
   'productivity', 21, 1, 'Deep work — 90 min', '09:00', '{1,2,3,4,5}',
   'My desk with the focus timer or the work itself on screen.', 5),
  ('reading-30', '30 Days of Reading', 'Twenty pages a night for a month.',
   'Read every evening for 30 days. Two misses allowed.',
   'education', 30, 2, 'Read 20 pages', '21:30', '{1,2,3,4,5,6,7}',
   'The open book with the page number visible.', 6);

create table public.challenges (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  template_id     text references public.challenge_templates (id),
  habit_id        uuid not null references public.habits (id) on delete cascade,
  title           text not null check (char_length(trim(title)) between 1 and 60),
  start_date      date not null,
  end_date        date not null,
  weekdays        smallint[] not null,
  required_days   smallint not null check (required_days >= 1),
  allowed_misses  smallint not null default 0 check (allowed_misses >= 0),
  bonus_points    integer not null check (bonus_points >= 0),
  status          text not null default 'active' check (status in ('active', 'completed', 'failed', 'abandoned')),
  finished_at     timestamptz,
  created_at      timestamptz not null default now(),
  check (end_date >= start_date)
);
create index challenges_user_idx on public.challenges (user_id, created_at desc);
create unique index challenges_one_active_per_habit on public.challenges (habit_id) where status = 'active';

alter table public.score_events
  add constraint score_events_challenge_fk foreign key (challenge_id) references public.challenges (id) on delete cascade;

-- Progress is always derived from the targets themselves, never stored by the client.
--   done   = scheduled days in range with a verified (or excused: our outage) target
--   lost   = past scheduled days without one, plus today if today's target already failed
--   left   = scheduled days still ahead (today included while it can still be done)
create or replace function public.challenge_progress(p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  ch public.challenges; v_tz text; v_today date;
  v_done integer; v_lost integer; v_left integer; v_today_failed boolean;
begin
  select * into ch from public.challenges where id = p_id;
  if not found then return null; end if;
  select timezone into v_tz from public.profiles where id = ch.user_id;
  v_today := (now() at time zone v_tz)::date;

  select count(*) into v_done from public.targets
   where habit_id = ch.habit_id and local_date between ch.start_date and ch.end_date and status in ('verified', 'excused');
  select exists (select 1 from public.targets where habit_id = ch.habit_id and local_date = v_today
                   and v_today between ch.start_date and ch.end_date and status in ('missed', 'rejected'))
    into v_today_failed;
  select count(*) into v_lost
    from generate_series(ch.start_date, least(ch.end_date, v_today - 1), interval '1 day') g(d)
   where extract(isodow from g.d)::smallint = any (ch.weekdays)
     and not exists (select 1 from public.targets t where t.habit_id = ch.habit_id and t.local_date = g.d::date
                       and t.status in ('verified', 'excused'));
  v_lost := v_lost + case when v_today_failed then 1 else 0 end;
  select count(*) into v_left
    from generate_series(greatest(ch.start_date, v_today), ch.end_date, interval '1 day') g(d)
   where extract(isodow from g.d)::smallint = any (ch.weekdays)
     and not (g.d::date = v_today and v_today_failed)
     and not exists (select 1 from public.targets t where t.habit_id = ch.habit_id and t.local_date = g.d::date
                       and t.status in ('verified', 'excused'));

  return jsonb_build_object(
    'done', v_done, 'lost', v_lost, 'left', v_left, 'required', ch.required_days,
    'allowed_misses', ch.allowed_misses, 'misses_left', greatest(ch.allowed_misses - v_lost, 0),
    'percent', least(100, round(100.0 * v_done / ch.required_days))::integer,
    'days_remaining', greatest((ch.end_date - v_today) + 1, 0),
    'today', v_today);
end $$;

create or replace function public.start_challenge(
  p_habit_id uuid, p_template_id text default null,
  p_title text default null, p_days integer default null, p_allowed_misses integer default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); h public.habits; tpl public.challenge_templates; v_tz text;
  v_title text; v_days integer; v_allowed integer; v_start date; v_end date; v_required integer; v_id uuid;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '42501'; end if;
  select * into h from public.habits where id = p_habit_id and user_id = v_uid;
  if not found then raise exception 'commitment not found' using errcode = 'P0002'; end if;
  if h.archived_at is not null or not h.is_active then
    raise exception 'the commitment must be active' using errcode = '22023';
  end if;
  if exists (select 1 from public.challenges where habit_id = h.id and status = 'active') then
    raise exception 'this commitment already has an active challenge' using errcode = '23505';
  end if;

  if p_template_id is not null then
    select * into tpl from public.challenge_templates where id = p_template_id;
    if not found then raise exception 'challenge not found' using errcode = 'P0002'; end if;
    v_title := tpl.title; v_days := tpl.duration_days; v_allowed := tpl.allowed_misses;
  else
    v_title := trim(coalesce(p_title, ''));
    v_days := p_days; v_allowed := coalesce(p_allowed_misses, 0);
    if char_length(v_title) not between 1 and 60 then raise exception 'title must be 1–60 characters' using errcode = '22023'; end if;
    if v_days is null or v_days not between 3 and 90 then raise exception 'duration must be 3–90 days' using errcode = '22023'; end if;
    if v_allowed < 0 or v_allowed > v_days / 3 then raise exception 'allowed misses must be between 0 and a third of the days' using errcode = '22023'; end if;
  end if;

  select timezone into v_tz from public.profiles where id = v_uid;
  v_start := (now() at time zone v_tz)::date;
  -- Start today only if today's window for this commitment is still open or ahead.
  if not exists (select 1 from public.targets where habit_id = h.id and local_date = v_start
                   and status = 'pending' and due_at + interval '15 minutes' > now()) then
    v_start := v_start + 1;
  end if;
  v_end := v_start + v_days - 1;
  select count(*) into v_required from generate_series(v_start, v_end, interval '1 day') g(d)
   where extract(isodow from g.d)::smallint = any (h.weekdays);
  if v_required = 0 then raise exception 'the commitment is not scheduled on any day of this challenge' using errcode = '22023'; end if;
  if v_allowed >= v_required then raise exception 'allowed misses must be fewer than the scheduled days' using errcode = '22023'; end if;

  insert into public.challenges (user_id, template_id, habit_id, title, start_date, end_date, weekdays,
                                 required_days, allowed_misses, bonus_points)
  values (v_uid, p_template_id, h.id, v_title, v_start, v_end, h.weekdays,
          v_required, v_allowed, v_required * public.cfg('challenge_bonus_per_day'))
  returning id into v_id;
  perform public.audit(v_uid, 'challenge_started', v_id,
    jsonb_build_object('title', v_title, 'habit_id', h.id, 'start', v_start, 'end', v_end, 'required', v_required));
  return v_id;
end $$;

create or replace function public.abandon_challenge(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); c integer;
begin
  update public.challenges set status = 'abandoned', finished_at = now()
   where id = p_id and user_id = v_uid and status = 'active';
  get diagnostics c = row_count;
  if c = 1 then perform public.audit(v_uid, 'challenge_abandoned', p_id, '{}'::jsonb); end if;
  return c = 1;
end $$;

-- Finish challenges: fail once misses exceed the allowance, complete when every scheduled day
-- is behind us (or done). The bonus is a ledger row keyed by challenge_id → paid at most once.
create or replace function public.settle_challenges()
returns integer language plpgsql security definer set search_path = '' as $$
declare ch record; p jsonb; c integer; n integer := 0; v_streak integer;
begin
  for ch in select * from public.challenges where status = 'active' for update skip locked loop
    p := public.challenge_progress(ch.id);
    if (p ->> 'lost')::integer > ch.allowed_misses then
      update public.challenges set status = 'failed', finished_at = now() where id = ch.id;
      perform public.audit(ch.user_id, 'challenge_failed', ch.id, p);
      n := n + 1;
    elsif (p ->> 'left')::integer = 0 then
      select current_streak into v_streak from public.habits where id = ch.habit_id;
      insert into public.score_events (user_id, habit_id, challenge_id, delta, reason, streak_after)
      values (ch.user_id, ch.habit_id, ch.id, ch.bonus_points, 'challenge_bonus', coalesce(v_streak, 0))
      on conflict (challenge_id) do nothing;
      get diagnostics c = row_count;
      if c = 1 and ch.bonus_points > 0 then
        update public.profiles set total_points = total_points + ch.bonus_points where id = ch.user_id;
      end if;
      update public.challenges set status = 'completed', finished_at = now() where id = ch.id;
      perform public.audit(ch.user_id, 'challenge_completed', ch.id, p || jsonb_build_object('bonus', ch.bonus_points));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.get_challenges()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'templates', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort) from public.challenge_templates t), '[]'::jsonb),
    'mine', coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('progress', public.challenge_progress(c.id),
                                                                           'habit_title', h.title)
                                       order by (c.status = 'active') desc, c.created_at desc)
                        from public.challenges c join public.habits h on h.id = c.habit_id
                       where c.user_id = auth.uid()), '[]'::jsonb),
    'bonus_per_day', public.cfg('challenge_bonus_per_day')
  );
$$;

-- ---------------------------------------------------------------------
-- 7. War Room read model (one call, caller's own data)
-- Display states: pending → in_progress (window open) → submitted (being verified)
--   → needs_evidence (last photo inconclusive, window still open) → verified | failed | excused
-- ---------------------------------------------------------------------
create or replace function public.get_war_room()
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_tz text; v_today date;
begin
  select timezone into v_tz from public.profiles where id = v_uid;
  if v_tz is null then return null; end if;
  v_today := (now() at time zone v_tz)::date;
  return jsonb_build_object(
    'today', v_today,
    'score', public.compute_discipline_score(v_uid, v_today),
    'total_points', (select total_points from public.profiles where id = v_uid),
    'streak', coalesce((select max(current_streak) from public.habits where user_id = v_uid and archived_at is null), 0),
    'week', (select jsonb_build_object(
                      'settled', count(*) filter (where status in ('verified', 'rejected', 'missed')),
                      'verified', count(*) filter (where status = 'verified'),
                      'success_rate', case when count(*) filter (where status in ('verified', 'rejected', 'missed')) = 0 then null
                                           else round(100.0 * count(*) filter (where status = 'verified')
                                                      / count(*) filter (where status in ('verified', 'rejected', 'missed')))::integer end)
               from public.targets where user_id = v_uid and local_date between v_today - 6 and v_today),
    'commitments', coalesce((select jsonb_agg(x order by x ->> 'due_at') from (
        select jsonb_build_object(
          'target_id', t.id, 'habit_id', h.id, 'title', h.title, 'category', h.category,
          'custom_category', h.custom_category, 'due_at', t.due_at, 'streak', h.current_streak,
          'state', case
            when t.status = 'verified' then 'verified'
            when t.status in ('missed', 'rejected') then 'failed'
            when t.status = 'excused' then 'excused'
            when lp.outcome in ('processing', 'error') then 'submitted'
            when lp.outcome = 'insufficient' and now() <= t.due_at + interval '15 minutes' then 'needs_evidence'
            when now() between t.due_at - interval '15 minutes' and t.due_at + interval '15 minutes' then 'in_progress'
            else 'pending' end,
          'critique', lp.critique) as x
          from public.targets t join public.habits h on h.id = t.habit_id
          left join lateral (select p.outcome, p.critique from public.proofs p where p.target_id = t.id
                              order by p.received_at desc limit 1) lp on true
         where t.user_id = v_uid and t.local_date = v_today) s), '[]'::jsonb),
    'upcoming', coalesce((select jsonb_agg(jsonb_build_object('target_id', t.id, 'title', h.title, 'due_at', t.due_at) order by t.due_at)
                            from (select * from public.targets where user_id = v_uid and status = 'pending'
                                     and due_at - interval '15 minutes' > now() order by due_at limit 5) t
                            join public.habits h on h.id = t.habit_id), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'delta', e.delta, 'reason', e.reason, 'at', e.created_at,
                                                              'title', coalesce(c.title, h.title)) order by e.created_at desc)
                          from (select * from public.score_events where user_id = v_uid order by created_at desc limit 8) e
                          left join public.habits h on h.id = e.habit_id
                          left join public.challenges c on c.id = e.challenge_id), '[]'::jsonb),
    'challenges', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'end_date', c.end_date,
                                                                  'progress', public.challenge_progress(c.id)) order by c.end_date)
                              from public.challenges c where c.user_id = v_uid and c.status = 'active'), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------
-- 8. Row level security + privileges for the new objects
-- ---------------------------------------------------------------------
alter table public.app_config          enable row level security;
alter table public.audit_log           enable row level security;
alter table public.discipline_scores   enable row level security;
alter table public.challenge_templates enable row level security;
alter table public.challenges          enable row level security;

revoke all on public.app_config, public.audit_log, public.discipline_scores,
              public.challenge_templates, public.challenges from anon, authenticated;
grant select on public.app_config, public.audit_log, public.discipline_scores,
                public.challenge_templates, public.challenges to authenticated;

create policy app_config_read          on public.app_config          for select to authenticated using (true);
create policy challenge_templates_read on public.challenge_templates for select to authenticated using (true);
create policy audit_log_own            on public.audit_log           for select to authenticated using (user_id = (select auth.uid()));
create policy discipline_scores_own    on public.discipline_scores   for select to authenticated using (user_id = (select auth.uid()));
create policy challenges_own           on public.challenges          for select to authenticated using (user_id = (select auth.uid()));

revoke execute on function public.audit(uuid, text, uuid, jsonb),
                           public.snapshot_discipline_scores(),
                           public.settle_challenges(),
                           public.habits_archive_guard(),
                           public.score_events_append_only()
  from public, anon, authenticated;
grant execute on function public.snapshot_discipline_scores(), public.settle_challenges() to service_role;

revoke execute on function public.cfg(text),
                           public.compute_discipline_score(uuid, date),
                           public.get_discipline(),
                           public.challenge_progress(uuid),
                           public.start_challenge(uuid, text, text, integer, integer),
                           public.abandon_challenge(uuid),
                           public.get_challenges(),
                           public.get_war_room()
  from public, anon;
grant execute on function public.cfg(text),
                          public.compute_discipline_score(uuid, date),
                          public.get_discipline(),
                          public.challenge_progress(uuid),
                          public.start_challenge(uuid, text, text, integer, integer),
                          public.abandon_challenge(uuid),
                          public.get_challenges(),
                          public.get_war_room()
  to authenticated;
