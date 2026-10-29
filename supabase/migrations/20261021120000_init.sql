-- =====================================================================
-- NoExcuse — core schema
-- Rules enforced here (never in the client):
--   * Proof window = target time ±15 minutes, judged on server time.
--   * Verified proof: +50, streak +1.  Rejected / expired / missed: −100, streak → 0.
--   * Exactly one score event per scheduled target (unique constraint) → no duplicate
--     rewards or penalties, even under retries or concurrent calls.
--   * Insufficient evidence and verification errors never score; the target stays open.
--   * Clients can read their own data and edit only habit settings / profile basics.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
create type public.target_status as enum ('pending', 'verified', 'rejected', 'missed', 'excused');
create type public.proof_outcome as enum ('processing', 'verified', 'rejected', 'insufficient', 'expired', 'error');
create type public.score_reason  as enum ('verified', 'rejected', 'expired', 'missed');

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.is_valid_timezone(tz text)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = tz);
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

-- ---------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null default 'Athlete' check (char_length(display_name) between 1 and 40),
  avatar_url    text check (avatar_url is null or char_length(avatar_url) <= 500),
  timezone      text not null default 'UTC',
  total_points  integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create or replace function public.profiles_validate()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.is_valid_timezone(new.timezone) then
    raise exception 'invalid timezone: %', new.timezone using errcode = '22023';
  end if;
  return new;
end $$;
create trigger profiles_validate before insert or update of timezone on public.profiles
  for each row execute function public.profiles_validate();
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- New auth user → profile row (display name / timezone from sign-up metadata when valid).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text := left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'Athlete'), 40);
  v_tz   text := coalesce(new.raw_user_meta_data ->> 'timezone', 'UTC');
begin
  if not public.is_valid_timezone(v_tz) then v_tz := 'UTC'; end if;
  insert into public.profiles (id, display_name, timezone) values (new.id, v_name, v_tz)
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Habits (settings are user-editable; streak columns are server-owned)
-- ---------------------------------------------------------------------
create table public.habits (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles (id) on delete cascade,
  title             text not null check (char_length(trim(title)) between 1 and 80),
  proof_hint        text check (proof_hint is null or char_length(proof_hint) <= 280),
  target_time       time not null,
  weekdays          smallint[] not null
                    check (cardinality(weekdays) between 1 and 7 and weekdays <@ array[1,2,3,4,5,6,7]::smallint[]),
  is_active         boolean not null default true,
  reminder_minutes  smallint not null default 10 check (reminder_minutes between 0 and 120),
  current_streak    integer not null default 0 check (current_streak >= 0),
  longest_streak    integer not null default 0 check (longest_streak >= 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index habits_user_idx on public.habits (user_id);
create trigger habits_touch before update on public.habits
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Targets: one scheduled occurrence of a habit on a local calendar day
-- ---------------------------------------------------------------------
create table public.targets (
  id          uuid primary key default gen_random_uuid(),
  habit_id    uuid not null references public.habits (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  local_date  date not null,
  due_at      timestamptz not null,
  status      public.target_status not null default 'pending',
  settled_at  timestamptz,
  created_at  timestamptz not null default now(),
  unique (habit_id, local_date)
);
create index targets_user_due_idx on public.targets (user_id, due_at);
create index targets_pending_due_idx on public.targets (due_at) where status = 'pending';

-- ---------------------------------------------------------------------
-- Capture sessions: issued when the in-app camera opens inside the window.
-- A proof must be submitted against a fresh, unused session.
-- ---------------------------------------------------------------------
create table public.capture_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  target_id   uuid not null references public.targets (id) on delete cascade,
  issued_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
create index capture_sessions_user_idx on public.capture_sessions (user_id, issued_at desc);
create index capture_sessions_target_idx on public.capture_sessions (target_id);

-- ---------------------------------------------------------------------
-- Proofs (one row per submitted photo)
-- ---------------------------------------------------------------------
create table public.proofs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id) on delete cascade,
  target_id           uuid not null references public.targets (id) on delete cascade,
  capture_session_id  uuid not null unique references public.capture_sessions (id) on delete cascade,
  storage_path        text not null,
  received_at         timestamptz not null default now(),   -- server receipt time = the time that counts
  outcome             public.proof_outcome not null default 'processing',
  critique            text,
  confidence          numeric(4,3) check (confidence is null or confidence between 0 and 1),
  model               text,
  ai_raw              jsonb,
  attempts            smallint not null default 0,
  judged_at           timestamptz,
  created_at          timestamptz not null default now()
);
create index proofs_target_idx on public.proofs (target_id);
create index proofs_user_idx on public.proofs (user_id);
create index proofs_retry_idx on public.proofs (created_at) where outcome in ('processing', 'error');

-- ---------------------------------------------------------------------
-- Score events: the auditable ledger. UNIQUE(target_id) = idempotency.
-- ---------------------------------------------------------------------
create table public.score_events (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  habit_id      uuid not null references public.habits (id) on delete cascade,
  target_id     uuid not null unique references public.targets (id) on delete cascade,
  proof_id      uuid references public.proofs (id) on delete set null,
  delta         integer not null check (delta in (50, -100)),
  reason        public.score_reason not null,
  streak_after  integer not null check (streak_after >= 0),
  created_at    timestamptz not null default now(),
  check ((reason = 'verified') = (delta = 50))
);
create index score_events_user_created_idx on public.score_events (user_id, created_at desc);
create index score_events_created_idx on public.score_events (created_at);
create index score_events_habit_idx on public.score_events (habit_id);
create index score_events_proof_idx on public.score_events (proof_id);
create index targets_habit_idx on public.targets (habit_id);

-- ---------------------------------------------------------------------
-- Subscription entitlement (written only by the RevenueCat webhook / server)
-- ---------------------------------------------------------------------
create table public.entitlements (
  user_id       uuid primary key references public.profiles (id) on delete cascade,
  entitlement   text not null default 'premium',
  is_active     boolean not null default false,
  period_type   text,                      -- normal | trial | intro
  product_id    text,
  store         text,
  expires_at    timestamptz,
  will_renew    boolean,
  updated_at    timestamptz not null default now()
);

create table public.revenuecat_events (
  id           text primary key,
  type         text not null,
  app_user_id  text,
  received_at  timestamptz not null default now(),
  payload      jsonb not null
);

create or replace function public.has_premium(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select e.is_active and (e.expires_at is null or e.expires_at > now())
    from public.entitlements e where e.user_id = p_user
  ), false);
$$;

-- ---------------------------------------------------------------------
-- Push tokens + notification de-duplication log
-- ---------------------------------------------------------------------
create table public.push_tokens (
  token       text primary key check (char_length(token) <= 200),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  platform    text not null check (platform in ('ios', 'android')),
  updated_at  timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id);

create table public.notification_log (
  user_id   uuid not null references public.profiles (id) on delete cascade,
  kind      text not null,
  ref_id    uuid not null,
  sent_at   timestamptz not null default now(),
  primary key (user_id, kind, ref_id)
);

-- =====================================================================
-- Target generation
-- =====================================================================
create or replace function public.ensure_targets_for_habit(p_habit_id uuid, p_from date, p_to date)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  h      record;
  d      date;
  v_due  timestamptz;
  n      integer := 0;
  c      integer;
begin
  select hb.id, hb.user_id, hb.target_time, hb.weekdays, hb.is_active, p.timezone
    into h
    from public.habits hb join public.profiles p on p.id = hb.user_id
   where hb.id = p_habit_id;
  if not found or not h.is_active then return 0; end if;

  for d in select generate_series(p_from, p_to, interval '1 day')::date loop
    if extract(isodow from d)::smallint = any (h.weekdays) then
      v_due := (d + h.target_time) at time zone h.timezone;   -- local wall time → instant
      if v_due + interval '15 minutes' > now() then           -- never create an already-closed window
        insert into public.targets (habit_id, user_id, local_date, due_at)
        values (h.id, h.user_id, d, v_due)
        on conflict (habit_id, local_date) do nothing;
        get diagnostics c = row_count; n := n + c;
      end if;
    end if;
  end loop;
  return n;
end $$;

-- Today + tomorrow (in each user's own timezone) for every active habit. Run by cron.
create or replace function public.ensure_targets_all()
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0; v_today date;
begin
  for r in select hb.id, p.timezone from public.habits hb join public.profiles p on p.id = hb.user_id
            where hb.is_active loop
    v_today := (now() at time zone r.timezone)::date;
    n := n + public.ensure_targets_for_habit(r.id, v_today, v_today + 1);
  end loop;
  return n;
end $$;

-- Schedule edits only affect windows that have not opened yet.
create or replace function public.habits_reschedule()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_today date;
begin
  if tg_op = 'UPDATE' then
    delete from public.targets
     where habit_id = new.id and status = 'pending'
       and due_at - interval '15 minutes' > now();
  end if;
  select (now() at time zone p.timezone)::date into v_today from public.profiles p where p.id = new.user_id;
  perform public.ensure_targets_for_habit(new.id, v_today, v_today + 1);
  return null;
end $$;
create trigger habits_schedule_ins after insert on public.habits
  for each row execute function public.habits_reschedule();
create trigger habits_schedule_upd after update of target_time, weekdays, is_active on public.habits
  for each row execute function public.habits_reschedule();

-- =====================================================================
-- Scoring — the only code paths that change points or streaks
-- =====================================================================
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

  -- Already settled (retry, duplicate submit, race): record the verdict, change nothing else.
  if t.status <> 'pending' then
    return jsonb_build_object('outcome', p_outcome, 'points_delta', 0, 'streak', h.current_streak,
                              'total_points', v_total, 'target_status', t.status, 'already_settled', true);
  end if;

  if p_outcome = 'verified' then
    if pr.received_at not between t.due_at - interval '15 minutes' and t.due_at + interval '15 minutes' then
      raise exception 'proof received outside the window' using errcode = '22023';
    end if;
    v_delta := 50;   v_reason := 'verified'; v_status := 'verified'; v_streak := h.current_streak + 1;
  elsif p_outcome = 'rejected' then
    v_delta := -100; v_reason := 'rejected'; v_status := 'rejected'; v_streak := 0;
  elsif p_outcome = 'expired' then
    v_delta := -100; v_reason := 'expired';  v_status := 'missed';   v_streak := 0;
  else
    -- insufficient / error: no score; the user may retake inside the window.
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

-- Windows that closed without a verified/rejected proof → missed (−100, streak 0).
-- Targets with an in-window proof still being verified (processing/error) are held back;
-- our outage is never the user's penalty.
create or replace function public.settle_due_targets(p_now timestamptz default now())
returns table (target_id uuid, user_id uuid, habit_id uuid, habit_title text, next_due_at timestamptz)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare t record; c integer; v_next timestamptz;
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
    values (t.user_id, t.habit_id, t.id, -100, 'missed', 0)
    on conflict (target_id) do nothing;
    get diagnostics c = row_count;
    continue when c = 0;

    update public.targets set status = 'missed', settled_at = p_now where id = t.id;
    update public.habits set current_streak = 0 where id = t.habit_id;
    update public.profiles set total_points = total_points - 100 where id = t.user_id;

    select min(n.due_at) into v_next from public.targets n
     where n.habit_id = t.habit_id and n.status = 'pending' and n.due_at > p_now;

    target_id := t.id; user_id := t.user_id; habit_id := t.habit_id; habit_title := t.title; next_due_at := v_next;
    return next;
  end loop;
end $$;

-- Verification kept failing on our side: close the target with no score.
create or replace function public.excuse_target(p_target_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare c integer;
begin
  update public.targets set status = 'excused', settled_at = now()
   where id = p_target_id and status = 'pending';
  get diagnostics c = row_count;
  return c = 1;
end $$;

-- =====================================================================
-- Read models
-- =====================================================================

-- Daily Arena (UTC day). Ranked by points, ties → longer current streak.
create or replace function public.get_arena(p_day date default null, p_limit integer default 50)
returns table (rank integer, user_id uuid, display_name text, avatar_url text,
               points integer, streak integer, rank_change integer, is_me boolean)
language sql stable security definer set search_path = '' as $$
  with params as (
    select coalesce(p_day, (now() at time zone 'UTC')::date) as d,
           least(greatest(coalesce(p_limit, 50), 1), 100)     as lim
  ),
  streaks as (
    select hb.user_id, max(hb.current_streak) as streak from public.habits hb group by hb.user_id
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
  select r.rnk, r.user_id, p.display_name, p.avatar_url, r.points, r.streak,
         (y.rnk - r.rnk) as rank_change, r.user_id = auth.uid()
    from ranked r
    join public.profiles p on p.id = r.user_id
    left join ranked_y y on y.user_id = r.user_id, params pr
   where r.rnk <= pr.lim or r.user_id = auth.uid()
   order by r.rnk;
$$;

-- Profile statistics for the signed-in user (runs with the caller's RLS).
create or replace function public.get_my_stats()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'total_points',     (select total_points from public.profiles where id = auth.uid()),
    'current_streak',   coalesce((select max(current_streak) from public.habits where user_id = auth.uid() and is_active), 0),
    'longest_streak',   coalesce((select max(longest_streak) from public.habits where user_id = auth.uid()), 0),
    'habits_completed', (select count(*) from public.targets where user_id = auth.uid() and status = 'verified'),
    'settled_targets',  (select count(*) from public.targets where user_id = auth.uid() and status in ('verified','rejected','missed')),
    'success_rate',     (select case when count(*) = 0 then null
                                     else round(100.0 * count(*) filter (where status = 'verified') / count(*)) end
                           from public.targets where user_id = auth.uid() and status in ('verified','rejected','missed')),
    'premium',          coalesce((select is_active and (expires_at is null or expires_at > now())
                                    from public.entitlements where user_id = auth.uid()), false)
  );
$$;

-- =====================================================================
-- Row level security + privileges
-- =====================================================================
alter table public.profiles          enable row level security;
alter table public.habits            enable row level security;
alter table public.targets           enable row level security;
alter table public.capture_sessions  enable row level security;
alter table public.proofs            enable row level security;
alter table public.score_events      enable row level security;
alter table public.entitlements      enable row level security;
alter table public.revenuecat_events enable row level security;
alter table public.push_tokens       enable row level security;
alter table public.notification_log  enable row level security;

-- Start from nothing for client roles, then grant precisely.
revoke all on all tables in schema public from anon, authenticated;

grant select on public.profiles, public.habits, public.targets, public.proofs,
                public.score_events, public.entitlements to authenticated;
grant update (display_name, avatar_url, timezone) on public.profiles to authenticated;
grant insert (user_id, title, proof_hint, target_time, weekdays, is_active, reminder_minutes) on public.habits to authenticated;
grant update (title, proof_hint, target_time, weekdays, is_active, reminder_minutes) on public.habits to authenticated;
grant select, insert, update, delete on public.push_tokens to authenticated;

create policy profiles_own_select on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy profiles_own_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy habits_own_select on public.habits for select to authenticated using (user_id = (select auth.uid()));
create policy habits_own_insert on public.habits for insert to authenticated with check (user_id = (select auth.uid()));
create policy habits_own_update on public.habits for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- No delete policy: habits are deactivated, never deleted, so the score ledger stays intact.

create policy targets_own_select      on public.targets      for select to authenticated using (user_id = (select auth.uid()));
create policy proofs_own_select       on public.proofs       for select to authenticated using (user_id = (select auth.uid()));
create policy score_events_own_select on public.score_events for select to authenticated using (user_id = (select auth.uid()));
create policy entitlements_own_select on public.entitlements for select to authenticated using (user_id = (select auth.uid()));

create policy push_tokens_own on public.push_tokens for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Server-only functions.
revoke execute on function public.apply_verdict(uuid, text, text, numeric, text, jsonb),
                           public.settle_due_targets(timestamptz),
                           public.excuse_target(uuid),
                           public.ensure_targets_for_habit(uuid, date, date),
                           public.ensure_targets_all(),
                           public.has_premium(uuid),
                           public.handle_new_user(),
                           public.habits_reschedule()
  from public, anon, authenticated;
grant execute on function public.apply_verdict(uuid, text, text, numeric, text, jsonb),
                          public.settle_due_targets(timestamptz),
                          public.excuse_target(uuid),
                          public.ensure_targets_for_habit(uuid, date, date),
                          public.ensure_targets_all(),
                          public.has_premium(uuid)
  to service_role;

-- Client-callable read models.
revoke execute on function public.get_arena(date, integer), public.get_my_stats() from public, anon;
grant  execute on function public.get_arena(date, integer), public.get_my_stats() to authenticated;
