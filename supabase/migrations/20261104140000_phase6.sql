-- =====================================================================
-- Phase 6 — advanced challenges, preferences, privacy
--   * Challenges get a category, a difficulty, several objectives (each one a commitment with its own
--     time, days and verification level), completion rules, a preview-able template library and an
--     AI-generated plan path. Progress is derived from the targets of every linked commitment.
--   * Commitments created by a challenge are paused when it ends, so nothing keeps scoring by surprise.
--   * Preferences: language and appearance, stored on the profile (synced across devices).
--   * Privacy: evidence retention preference and a full data export (no photos).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Preferences + privacy settings on the profile
-- ---------------------------------------------------------------------
alter table public.profiles
  add column language text not null default 'en' check (language in ('en', 'ro')),
  add column theme text not null default 'dark' check (theme in ('dark', 'light', 'system')),
  add column evidence_retention text not null default 'keep' check (evidence_retention in ('keep', '30d'));
grant update (language, theme, evidence_retention) on public.profiles to authenticated;

-- New accounts start in the language the app was using when they signed up.
create or replace function public.handle_new_user_language()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_lang text;
begin
  select raw_user_meta_data ->> 'language' into v_lang from auth.users where id = new.id;
  if v_lang in ('en', 'ro') then new.language := v_lang; end if;
  return new;
end $$;
create trigger profiles_language_from_signup before insert on public.profiles
  for each row execute function public.handle_new_user_language();

alter table public.proofs add column evidence_deleted_at timestamptz;

-- ---------------------------------------------------------------------
-- 2. Challenge model
-- ---------------------------------------------------------------------
insert into public.app_config (key, value, description) values
  ('challenge_bonus_pct_advanced', 150, 'Bonus multiplier (percent) for Advanced challenges.'),
  ('challenge_bonus_pct_elite', 200, 'Bonus multiplier (percent) for Elite challenges.')
on conflict (key) do nothing;

alter table public.challenge_templates drop constraint challenge_templates_duration_days_check;
alter table public.challenge_templates add constraint challenge_templates_duration_days_check check (duration_days between 1 and 90);
alter table public.challenge_templates
  add column kind text not null default 'custom' check (kind in ('daily', 'weekly', 'seven_day', 'thirty_day', 'custom', 'elite')),
  add column difficulty text not null default 'intermediate' check (difficulty in ('beginner', 'intermediate', 'advanced', 'elite')),
  add column objectives jsonb,          -- null = bring your own commitment
  add column rules text,
  add column evidence text;

alter table public.challenges
  add column kind text not null default 'custom' check (kind in ('daily', 'weekly', 'seven_day', 'thirty_day', 'custom', 'elite')),
  add column difficulty text not null default 'intermediate' check (difficulty in ('beginner', 'intermediate', 'advanced', 'elite')),
  add column description text check (description is null or char_length(description) <= 600),
  add column rules text check (rules is null or char_length(rules) <= 600),
  add column source text not null default 'template' check (source in ('template', 'custom', 'ai'));

alter table public.habits add column challenge_id uuid references public.challenges (id) on delete set null;
create index habits_challenge_idx on public.habits (challenge_id) where challenge_id is not null;

create table public.challenge_habits (
  challenge_id  uuid not null references public.challenges (id) on delete cascade,
  habit_id      uuid not null references public.habits (id) on delete cascade,
  position      smallint not null default 0,
  primary key (challenge_id, habit_id)
);
create index challenge_habits_habit_idx on public.challenge_habits (habit_id);
alter table public.challenge_habits enable row level security;
revoke all on public.challenge_habits from anon, authenticated;
grant select on public.challenge_habits to authenticated;
create policy challenge_habits_own on public.challenge_habits for select to authenticated
  using (exists (select 1 from public.challenges c where c.id = challenge_id and c.user_id = (select auth.uid())));

insert into public.challenge_habits (challenge_id, habit_id, position)
select id, habit_id, 0 from public.challenges on conflict do nothing;

-- Template library. Existing ids are kept (running challenges reference them).
update public.challenge_templates set kind = 'thirty_day', difficulty = 'intermediate',
  rules = 'Keep your chosen commitment on every scheduled day for 30 days. Up to 2 missed days.',
  evidence = 'Whatever your commitment already asks for, at its verification level.' where id = 'discipline-30';
update public.challenge_templates set kind = 'thirty_day', difficulty = 'advanced',
  rules = 'Every scheduled day for 30 days. A single missed day ends the challenge.',
  evidence = 'Whatever your commitment already asks for, at its verification level.' where id = 'no-excuses-30';
update public.challenge_templates set title = '5 AM Protocol', tagline = 'Up and moving at 05:00, seven days straight.',
  description = 'Seven mornings in a row, out of bed at 05:00 and proving it before the day starts.',
  habit_title = 'Up at 05:00', habit_time = '05:00', kind = 'seven_day', difficulty = 'advanced',
  proof_hint = 'My face and a clock or phone screen showing the time, in a lit room.',
  rules = '7 days, no misses. The window is 04:45–05:15.', evidence = 'One live photo: you, awake, with the time visible.' where id = 'early-7';
update public.challenge_templates set title = 'No Excuses Fitness', tagline = 'A workout a day for 30 days.',
  description = 'Train every day for 30 days — gym, run or home workout. The photo has to show it.',
  kind = 'thirty_day', difficulty = 'intermediate', rules = '30 days, up to 3 missed days.',
  evidence = 'One live photo of you training, or the equipment with you in frame.' where id = 'fitness-30';
update public.challenge_templates set kind = 'custom', difficulty = 'intermediate',
  rules = 'Every weekday for three weeks. 1 missed day allowed.', evidence = 'Your desk with the focus timer or the work on screen.' where id = 'deep-work-21';
update public.challenge_templates set title = 'Reading Discipline', tagline = 'Twenty pages every night for a month.',
  kind = 'thirty_day', difficulty = 'beginner', rules = '30 days, up to 2 missed days.',
  evidence = 'The open book with the page number visible.' where id = 'reading-30';

-- Templates with a habit become one-objective plans.
update public.challenge_templates set objectives = jsonb_build_array(jsonb_build_object(
  'title', habit_title, 'time', to_char(habit_time, 'HH24:MI'), 'weekdays', to_jsonb(habit_weekdays),
  'proof_hint', proof_hint, 'verification_level', 'standard'))
 where habit_title is not null;

insert into public.challenge_templates (id, title, tagline, description, category, duration_days, allowed_misses, kind, difficulty, objectives, rules, evidence, sort) values
  ('iron-75', '75-Day Iron Standard', 'Two workouts, ten pages, three litres. Every day for 75 days.',
   'A demanding 75-day discipline program inspired by popular 75-day challenges (not affiliated with any of them). Two workouts a day — one outdoors — ten pages of reading and three litres of water. Every day, no exceptions.',
   'fitness', 75, 0, 'elite', 'elite',
   '[{"title":"Workout — 45 min","time":"07:00","weekdays":[1,2,3,4,5,6,7],"proof_hint":"Me training, with the gym or equipment in frame.","verification_level":"standard"},
     {"title":"Outdoor workout — 45 min","time":"18:00","weekdays":[1,2,3,4,5,6,7],"proof_hint":"Me training outdoors, sky or street visible.","verification_level":"standard"},
     {"title":"Read 10 pages","time":"21:00","weekdays":[1,2,3,4,5,6,7],"proof_hint":"The open book with the page number visible.","verification_level":"standard"},
     {"title":"Drink 3 L of water","time":"20:00","weekdays":[1,2,3,4,5,6,7],"proof_hint":"The empty bottles that add up to three litres.","verification_level":"standard"}]'::jsonb,
   '75 days. Every objective, every day. One miss ends the challenge.', 'One live photo per objective, inside each window.', 7),
  ('deep-work-7', 'Deep Work 7D', 'Ninety focused minutes, seven days running.',
   'A one-week reset for your attention: one 90-minute deep-work block every morning.',
   'productivity', 7, 1, 'seven_day', 'beginner',
   '[{"title":"Deep work — 90 min","time":"09:00","weekdays":[1,2,3,4,5,6,7],"proof_hint":"My desk with the focus timer or the work itself on screen.","verification_level":"standard"}]'::jsonb,
   '7 days, 1 missed day allowed.', 'One live photo of the work and the timer.', 8),
  ('digital-detox', 'Digital Detox', 'Two phone-free hours every evening for two weeks.',
   'Take your evenings back: the phone goes off for two hours, every evening, for 14 days.',
   'lifestyle', 14, 2, 'custom', 'intermediate',
   '[{"title":"Phone off — 2 hours","time":"20:00","weekdays":[1,2,3,4,5,6,7],"proof_hint":"The phone switched off or in a drawer, with a clock showing the time.","verification_level":"standard"}]'::jsonb,
   '14 days, up to 2 missed days.', 'One live photo of the phone put away, with the time visible.', 9),
  ('study-14', 'Study Consistency', 'An hour of study every weekday for two weeks.',
   'Build a study habit that survives a busy week: one focused hour, Monday to Friday, for two weeks.',
   'education', 14, 1, 'custom', 'beginner',
   '[{"title":"Study — 60 min","time":"19:00","weekdays":[1,2,3,4,5],"proof_hint":"My notes or book open, with the timer visible.","verification_level":"standard"}]'::jsonb,
   '10 study days, 1 missed day allowed.', 'One live photo of your study material and the timer.', 10),
  ('daily-reset', 'Daily Reset', 'Three small wins in one day.',
   'One day, three proofs: make the bed, move for twenty minutes, plan tomorrow.',
   'personal', 1, 0, 'daily', 'beginner',
   '[{"title":"Make the bed","time":"07:30","weekdays":[1,2,3,4,5,6,7],"proof_hint":"The made bed.","verification_level":"standard"},
     {"title":"Move — 20 min","time":"18:00","weekdays":[1,2,3,4,5,6,7],"proof_hint":"Me exercising or walking.","verification_level":"standard"},
     {"title":"Plan tomorrow","time":"21:30","weekdays":[1,2,3,4,5,6,7],"proof_hint":"Tomorrow''s plan written down.","verification_level":"standard"}]'::jsonb,
   'All three objectives today.', 'One live photo per objective.', 11),
  ('four-of-seven', 'Four of Seven', 'Train on at least four days this week.',
   'A weekly challenge for real life: a 30-minute workout on any four of the next seven days.',
   'fitness', 7, 3, 'weekly', 'beginner',
   '[{"title":"Workout — 30 min","time":"18:00","weekdays":[1,2,3,4,5,6,7],"proof_hint":"Me training, with the equipment or place visible.","verification_level":"standard"}]'::jsonb,
   'At least 4 of 7 days (up to 3 missed days).', 'One live photo of you training.', 12);

-- ---------------------------------------------------------------------
-- 3. Progress across every commitment of a challenge
--   A scheduled day is DONE when it has at least one target and every target that day is
--   verified (or excused — our outage). LOST: a past scheduled day that isn't done, or today
--   once any of today's targets failed.
-- ---------------------------------------------------------------------
create or replace function public.challenge_days(p_id uuid)
returns table (day date, targets integer, ok integer, bad integer, state text)
language plpgsql stable security invoker set search_path = '' as $$
declare ch public.challenges; v_today date;
begin
  select * into ch from public.challenges where id = p_id;
  if not found then return; end if;
  select (now() at time zone p.timezone)::date into v_today from public.profiles p where p.id = ch.user_id;
  return query
  with hs as (select habit_id from public.challenge_habits where challenge_id = ch.id),
  days as (select g::date as d from generate_series(ch.start_date, ch.end_date, interval '1 day') g
            where extract(isodow from g)::smallint = any (ch.weekdays)),
  agg as (
    select d.d, count(t.id)::integer as n,
           (count(t.id) filter (where t.status in ('verified', 'excused')))::integer as okn,
           (count(t.id) filter (where t.status in ('missed', 'rejected')))::integer as badn
      from days d left join public.targets t on t.local_date = d.d and t.habit_id in (select habit_id from hs)
     group by d.d)
  select a.d, a.n, a.okn, a.badn,
         case when a.n > 0 and a.okn = a.n then 'done'
              when a.d < v_today or (a.d = v_today and a.badn > 0) then 'lost'
              when a.d = v_today then 'today'
              else 'upcoming' end
    from agg a order by a.d;
end $$;

create or replace function public.challenge_progress(p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare ch public.challenges; v_today date; v_done integer; v_lost integer; v_left integer;
begin
  select * into ch from public.challenges where id = p_id;
  if not found then return null; end if;
  select (now() at time zone p.timezone)::date into v_today from public.profiles p where p.id = ch.user_id;
  select count(*) filter (where state = 'done'), count(*) filter (where state = 'lost'),
         count(*) filter (where state in ('today', 'upcoming'))
    into v_done, v_lost, v_left from public.challenge_days(ch.id);
  return jsonb_build_object(
    'done', v_done, 'lost', v_lost, 'left', v_left, 'required', ch.required_days,
    'allowed_misses', ch.allowed_misses, 'misses_left', greatest(ch.allowed_misses - v_lost, 0),
    'percent', least(100, round(100.0 * v_done / ch.required_days))::integer,
    'days_remaining', greatest((ch.end_date - v_today) + 1, 0),
    'today', v_today);
end $$;

-- Pausing the commitments a challenge created, when it ends.
create or replace function public.pause_challenge_habits(p_challenge uuid)
returns void language sql security definer set search_path = '' as $$
  update public.habits set is_active = false where challenge_id = p_challenge and is_active;
$$;

create or replace function public.settle_challenges()
returns integer language plpgsql security definer set search_path = '' as $$
declare ch record; p jsonb; c integer; n integer := 0; v_streak integer;
begin
  for ch in select * from public.challenges where status = 'active' for update skip locked loop
    p := public.challenge_progress(ch.id);
    if (p ->> 'lost')::integer > ch.allowed_misses then
      update public.challenges set status = 'failed', finished_at = now() where id = ch.id;
      perform public.pause_challenge_habits(ch.id);
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
      perform public.pause_challenge_habits(ch.id);
      perform public.audit(ch.user_id, 'challenge_completed', ch.id, p || jsonb_build_object('bonus', ch.bonus_points));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.abandon_challenge(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); c integer;
begin
  update public.challenges set status = 'abandoned', finished_at = now()
   where id = p_id and user_id = v_uid and status = 'active';
  get diagnostics c = row_count;
  if c = 1 then
    perform public.pause_challenge_habits(p_id);
    perform public.audit(v_uid, 'challenge_abandoned', p_id, '{}'::jsonb);
  end if;
  return c = 1;
end $$;

-- The single-commitment path also records its commitment in challenge_habits.
create or replace function public.challenge_habits_primary()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.challenge_habits (challenge_id, habit_id, position) values (new.id, new.habit_id, 0)
  on conflict do nothing;
  return new;
end $$;
create trigger challenges_primary_habit after insert on public.challenges
  for each row execute function public.challenge_habits_primary();

-- ---------------------------------------------------------------------
-- 4. Starting a plan (template with objectives, custom, or AI-generated and approved)
-- ---------------------------------------------------------------------
create or replace function public.start_challenge_plan(p_plan jsonb, p_template_id text default null, p_source text default 'custom')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); tpl public.challenge_templates; v_tz text;
  v_title text; v_desc text; v_rules text; v_kind text; v_diff text; v_days integer; v_allowed integer;
  v_objs jsonb; o jsonb; i integer := 0; v_hid uuid; v_first uuid; v_id uuid; v_hids uuid[] := '{}';
  v_weekdays smallint[] := '{}'; v_wd smallint[]; v_time time; v_level text;
  v_start date; v_end date; v_required integer; v_bonus integer; v_pct integer := 100;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if not public.has_premium(v_uid) then
    raise exception 'premium_required: Challenges are part of Premium' using errcode = '42501';
  end if;
  if p_source not in ('template', 'custom', 'ai') then raise exception 'invalid source' using errcode = '22023'; end if;
  v_objs := p_plan -> 'objectives';

  if p_template_id is not null then
    select * into tpl from public.challenge_templates where id = p_template_id;
    if not found or tpl.objectives is null then raise exception 'challenge not found' using errcode = 'P0002'; end if;
    -- The template fixes the rules (length, misses, difficulty, number of objectives, verification level).
    -- The user may choose each objective's time and days, and the app may send the title and proof
    -- description in the user's language.
    if jsonb_typeof(v_objs) <> 'array' or jsonb_array_length(v_objs) <> jsonb_array_length(tpl.objectives) then
      raise exception 'objectives do not match the template' using errcode = '22023';
    end if;
    select jsonb_agg(t || jsonb_build_object('time', coalesce(c ->> 'time', t ->> 'time'),
                                             'weekdays', coalesce(c -> 'weekdays', t -> 'weekdays'),
                                             'title', coalesce(nullif(trim(c ->> 'title'), ''), t ->> 'title'),
                                             'proof_hint', coalesce(nullif(trim(c ->> 'proof_hint'), ''), t ->> 'proof_hint')) order by k)
      into v_objs
      from jsonb_array_elements(tpl.objectives) with ordinality a(t, k)
      join jsonb_array_elements(v_objs) with ordinality b(c, k2) on k2 = k;
    v_title := tpl.title; v_desc := tpl.description; v_rules := tpl.rules; v_kind := tpl.kind;
    v_diff := tpl.difficulty; v_days := tpl.duration_days; v_allowed := tpl.allowed_misses; p_source := 'template';
  else
    v_title := trim(coalesce(p_plan ->> 'title', ''));
    v_desc := nullif(trim(coalesce(p_plan ->> 'description', '')), '');
    v_rules := nullif(trim(coalesce(p_plan ->> 'rules', '')), '');
    v_kind := coalesce(p_plan ->> 'kind', 'custom');
    v_diff := coalesce(p_plan ->> 'difficulty', 'intermediate');
    v_days := (p_plan ->> 'duration_days')::integer;
    v_allowed := coalesce((p_plan ->> 'allowed_misses')::integer, 0);
    if char_length(v_title) not between 1 and 60 then raise exception 'title must be 1–60 characters' using errcode = '22023'; end if;
    if char_length(coalesce(v_desc, '')) > 600 or char_length(coalesce(v_rules, '')) > 600 then
      raise exception 'description and rules must be at most 600 characters' using errcode = '22023';
    end if;
    if v_kind not in ('daily', 'weekly', 'seven_day', 'thirty_day', 'custom', 'elite') then raise exception 'invalid category' using errcode = '22023'; end if;
    if v_diff not in ('beginner', 'intermediate', 'advanced', 'elite') then raise exception 'invalid difficulty' using errcode = '22023'; end if;
    if v_days is null or v_days not between 1 and 90 then raise exception 'duration must be 1–90 days' using errcode = '22023'; end if;
    if (v_kind = 'daily' and v_days <> 1) or (v_kind in ('weekly', 'seven_day') and v_days <> 7) or (v_kind = 'thirty_day' and v_days <> 30) then
      raise exception 'duration does not match the category' using errcode = '22023';
    end if;
    if v_kind = 'elite' and (v_allowed <> 0 or v_diff <> 'elite') then
      raise exception 'elite challenges allow no misses and are elite difficulty' using errcode = '22023';
    end if;
    if v_allowed < 0 or v_allowed > greatest(v_days / 3, case when v_kind = 'weekly' then 3 else 0 end) then
      raise exception 'allowed misses must be between 0 and a third of the days' using errcode = '22023';
    end if;
  end if;

  if jsonb_typeof(v_objs) <> 'array' or jsonb_array_length(v_objs) not between 1 and 5 then
    raise exception 'a challenge needs 1–5 objectives' using errcode = '22023';
  end if;
  if (select count(*) from public.habits h join public.challenges c on c.id = h.challenge_id
       where h.user_id = v_uid and h.is_active and c.status = 'active') + jsonb_array_length(v_objs) > 12 then
    raise exception 'too many active challenge objectives (max 12)' using errcode = '22023';
  end if;

  select timezone into v_tz from public.profiles where id = v_uid;
  insert into public.challenges (user_id, template_id, habit_id, title, start_date, end_date, weekdays, required_days,
                                 allowed_misses, bonus_points, kind, difficulty, description, rules, source)
  values (v_uid, p_template_id, null, v_title, '2000-01-01', '2000-01-01', '{1}', 1, v_allowed, 0, v_kind, v_diff, v_desc, v_rules, p_source)
  returning id into v_id;

  for o in select value from jsonb_array_elements(v_objs) loop
    i := i + 1;
    begin
      v_time := (o ->> 'time')::time;
    exception when others then raise exception 'objective % needs a time like 07:00', i using errcode = '22023';
    end;
    select array_agg(distinct x::smallint order by x::smallint) into v_wd from jsonb_array_elements_text(coalesce(o -> 'weekdays', '[1,2,3,4,5,6,7]'::jsonb)) x;
    if v_wd is null or not (v_wd <@ array[1,2,3,4,5,6,7]::smallint[]) then raise exception 'objective % has invalid days', i using errcode = '22023'; end if;
    if char_length(trim(coalesce(o ->> 'title', ''))) not between 1 and 80 then
      raise exception 'objective % needs a title of 1–80 characters', i using errcode = '22023';
    end if;
    v_level := coalesce(o ->> 'verification_level', 'standard');
    if v_level not in ('standard', 'strict', 'elite') then raise exception 'objective % has an invalid verification level', i using errcode = '22023'; end if;
    insert into public.habits (user_id, title, proof_hint, target_time, weekdays, category, verification_level, challenge_id, description)
    values (v_uid, left(trim(o ->> 'title'), 80), nullif(left(trim(coalesce(o ->> 'proof_hint', '')), 280), ''), v_time, v_wd,
            coalesce((select category from public.challenge_templates where id = p_template_id), 'personal'), v_level, v_id,
            left('Part of the challenge: ' || v_title, 500))
    returning id into v_hid;
    v_hids := v_hids || v_hid;
    v_weekdays := array(select distinct unnest(v_weekdays || v_wd) order by 1);
    insert into public.challenge_habits (challenge_id, habit_id, position) values (v_id, v_hid, i - 1);
  end loop;

  v_start := (now() at time zone v_tz)::date;
  if not exists (select 1 from public.targets where habit_id = any (v_hids) and local_date = v_start
                   and status = 'pending' and due_at + interval '15 minutes' > now()) then
    v_start := v_start + 1;
  end if;
  v_end := v_start + v_days - 1;
  select count(*) into v_required from generate_series(v_start, v_end, interval '1 day') g(d)
   where extract(isodow from g.d)::smallint = any (v_weekdays);
  if v_required = 0 then raise exception 'no objective is scheduled during this challenge' using errcode = '22023'; end if;
  if v_allowed >= v_required then raise exception 'allowed misses must be fewer than the scheduled days' using errcode = '22023'; end if;
  if v_diff = 'advanced' then v_pct := public.cfg('challenge_bonus_pct_advanced');
  elsif v_diff = 'elite' then v_pct := public.cfg('challenge_bonus_pct_elite'); end if;
  v_bonus := (v_required * public.cfg('challenge_bonus_per_day') * v_pct) / 100;

  update public.challenges set habit_id = v_hids[1], start_date = v_start, end_date = v_end, weekdays = v_weekdays,
         required_days = v_required, bonus_points = v_bonus where id = v_id;
  perform public.audit(v_uid, 'challenge_started', v_id,
    jsonb_build_object('title', v_title, 'source', p_source, 'objectives', cardinality(v_hids), 'start', v_start, 'end', v_end, 'required', v_required));
  return v_id;
end $$;

-- challenges.habit_id is set right after the objectives exist (same transaction).
alter table public.challenges alter column habit_id drop not null;
create or replace function public.challenge_habits_primary()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.habit_id is not null then
    insert into public.challenge_habits (challenge_id, habit_id, position) values (new.id, new.habit_id, 0) on conflict do nothing;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 5. Read models
-- ---------------------------------------------------------------------
create or replace function public.get_challenge_detail(p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare ch public.challenges; v_streak integer := 0; r record;
begin
  select * into ch from public.challenges where id = p_id and user_id = auth.uid();
  if not found then return null; end if;
  -- Current streak of done days, counting back from the most recent day that isn't still open.
  for r in select state from public.challenge_days(ch.id) where state in ('done', 'lost') order by day desc loop
    exit when r.state <> 'done';
    v_streak := v_streak + 1;
  end loop;
  return to_jsonb(ch) || jsonb_build_object(
    'progress', public.challenge_progress(ch.id),
    'streak', v_streak,
    'objectives', coalesce((select jsonb_agg(jsonb_build_object(
        'habit_id', h.id, 'title', h.title, 'time', to_char(h.target_time, 'HH24:MI'), 'weekdays', h.weekdays,
        'verification_level', h.verification_level, 'proof_hint', h.proof_hint, 'is_active', h.is_active,
        'verified', (select count(*) from public.targets t where t.habit_id = h.id and t.local_date between ch.start_date and ch.end_date and t.status = 'verified'),
        'failed', (select count(*) from public.targets t where t.habit_id = h.id and t.local_date between ch.start_date and ch.end_date and t.status in ('missed', 'rejected')))
        order by x.position)
      from public.challenge_habits x join public.habits h on h.id = x.habit_id where x.challenge_id = ch.id), '[]'::jsonb),
    'days', coalesce((select jsonb_agg(jsonb_build_object('day', d.day, 'state', d.state, 'targets', d.targets, 'ok', d.ok, 'bad', d.bad) order by d.day)
                        from public.challenge_days(ch.id) d), '[]'::jsonb),
    'evidence', coalesce((select jsonb_agg(e order by e ->> 'due_at' desc) from (
        select jsonb_build_object('target_id', t.id, 'due_at', t.due_at, 'title', h.title, 'status', t.status,
               'outcome', p.outcome, 'level', p.level, 'critique', p.critique, 'requested_evidence', p.requested_evidence,
               'appeal', (select a.status from public.appeals a where a.target_id = t.id)) as e
          from public.challenge_habits x join public.habits h on h.id = x.habit_id
          join public.targets t on t.habit_id = h.id and t.local_date between ch.start_date and ch.end_date
          left join lateral (select * from public.proofs pr where pr.target_id = t.id order by pr.created_at desc limit 1) p on true
         where x.challenge_id = ch.id and (t.status <> 'pending' or p.id is not null)
         order by t.due_at desc limit 90) q), '[]'::jsonb));
end $$;

create or replace function public.get_challenges()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'templates', coalesce((select jsonb_agg(to_jsonb(t) order by t.sort) from public.challenge_templates t), '[]'::jsonb),
    'mine', coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('progress', public.challenge_progress(c.id),
                                                                           'habit_title', h.title,
                                                                           'objective_count', (select count(*) from public.challenge_habits x where x.challenge_id = c.id))
                                       order by (c.status = 'active') desc, c.created_at desc)
                        from public.challenges c left join public.habits h on h.id = c.habit_id
                       where c.user_id = auth.uid()), '[]'::jsonb),
    'bonus_per_day', public.cfg('challenge_bonus_per_day'),
    'stats', (select jsonb_build_object(
                'active', count(*) filter (where status = 'active'),
                'completed', count(*) filter (where status = 'completed'),
                'failed', count(*) filter (where status = 'failed'),
                'abandoned', count(*) filter (where status = 'abandoned'),
                'completion_rate', round(100.0 * count(*) filter (where status = 'completed')
                                         / nullif(count(*) filter (where status in ('completed', 'failed', 'abandoned')), 0)),
                'bonus_earned', (select coalesce(sum(delta), 0) from public.score_events where user_id = auth.uid() and reason = 'challenge_bonus'))
              from public.challenges where user_id = auth.uid())
  );
$$;

-- ---------------------------------------------------------------------
-- 6. Privacy: export everything we hold about the caller (photos excluded; they stay private in storage)
-- ---------------------------------------------------------------------
create or replace function public.export_my_data()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '42501'; end if;
  return jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) from public.profiles p where id = v_uid),
    'commitments', (select coalesce(jsonb_agg(to_jsonb(h)), '[]') from public.habits h where user_id = v_uid),
    'targets', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.targets t where user_id = v_uid),
    'proofs', (select coalesce(jsonb_agg(to_jsonb(p) - 'ai_raw'), '[]') from public.proofs p where user_id = v_uid),
    'points_ledger', (select coalesce(jsonb_agg(to_jsonb(s)), '[]') from public.score_events s where user_id = v_uid),
    'challenges', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.challenges c where user_id = v_uid),
    'appeals', (select coalesce(jsonb_agg(to_jsonb(a) - 'ai_raw'), '[]') from public.appeals a where user_id = v_uid),
    'coach_messages', (select coalesce(jsonb_agg(to_jsonb(m)), '[]') from public.coach_messages m where user_id = v_uid),
    'weekly_reports', (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from public.weekly_reports r where user_id = v_uid),
    'achievements', (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.achievements a where user_id = v_uid),
    'entitlement', (select to_jsonb(e) from public.entitlements e where user_id = v_uid)
  );
end $$;

-- Proofs whose photos may be deleted under the user's retention preference: settled, older than
-- 30 days, not under appeal or retry.
create or replace function public.evidence_due_for_deletion(p_limit integer default 200)
returns table (proof_id uuid, user_id uuid, paths text[])
language sql stable security definer set search_path = '' as $$
  select p.id, p.user_id,
         array(select pi.storage_path from public.proof_items pi where pi.proof_id = p.id
               union select p.storage_path)
    from public.proofs p join public.profiles pr on pr.id = p.user_id join public.targets t on t.id = p.target_id
   where pr.evidence_retention = '30d' and p.evidence_deleted_at is null and p.created_at < now() - interval '30 days'
     and t.status <> 'pending' and p.outcome not in ('processing', 'error')
     and not exists (select 1 from public.appeals a where a.proof_id = p.id and a.status = 'pending')
   order by p.created_at limit p_limit
$$;

-- "Delete all my evidence" (Settings). Skips photos the system still needs: a verification still
-- running or being retried, a pending appeal, or a rejection whose 48-hour appeal window is open.
create or replace function public.evidence_for_user_deletion(p_user uuid)
returns table (proof_id uuid, paths text[], kept boolean)
language sql stable security definer set search_path = '' as $$
  select p.id,
         array(select pi.storage_path from public.proof_items pi where pi.proof_id = p.id union select p.storage_path),
         (t.status = 'pending' or p.outcome in ('processing', 'error')
          or exists (select 1 from public.appeals a where a.proof_id = p.id and a.status = 'pending')
          or (p.outcome = 'rejected' and not exists (select 1 from public.appeals a where a.target_id = p.target_id)
              and coalesce(p.judged_at, p.created_at) > now() - make_interval(hours => public.cfg('appeal_window_hours'))))
    from public.proofs p join public.targets t on t.id = p.target_id
   where p.user_id = p_user and p.evidence_deleted_at is null
$$;

create or replace function public.mark_evidence_deleted(p_proofs uuid[])
returns integer language sql security definer set search_path = '' as $$
  with u as (update public.proofs set evidence_deleted_at = now() where id = any (p_proofs) and evidence_deleted_at is null returning 1)
  select count(*)::integer from u
$$;

-- ---------------------------------------------------------------------
-- 7. Privileges
-- ---------------------------------------------------------------------
revoke execute on function public.handle_new_user_language(), public.challenge_days(uuid), public.pause_challenge_habits(uuid),
  public.challenge_habits_primary(), public.start_challenge_plan(jsonb, text, text), public.get_challenge_detail(uuid),
  public.export_my_data(), public.evidence_due_for_deletion(integer), public.mark_evidence_deleted(uuid[]),
  public.evidence_for_user_deletion(uuid)
  from public, anon, authenticated;
grant execute on function public.challenge_days(uuid), public.start_challenge_plan(jsonb, text, text),
  public.get_challenge_detail(uuid), public.export_my_data(), public.get_challenges() to authenticated;
grant execute on function public.pause_challenge_habits(uuid), public.evidence_due_for_deletion(integer),
  public.mark_evidence_deleted(uuid[]), public.challenge_days(uuid), public.evidence_for_user_deletion(uuid) to service_role;
