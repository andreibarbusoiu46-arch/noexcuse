-- =====================================================================
-- Phase 2 — stronger verification
--   * Verification level per commitment: standard | strict | elite (Premium for strict/elite).
--   * Several pieces of evidence per proof: live photos + (strict/elite) screenshots.
--   * Duplicate detection: exact SHA-256 and perceptual dHash, per user.
--   * "Needs more evidence": what the AI asks for is stored and shown.
--   * Appeals: one AI re-review per rejected target; an overturn is a new,
--     compensating ledger row (the ledger stays append-only).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Verification level
-- ---------------------------------------------------------------------
alter table public.habits add column verification_level text not null default 'standard'
  check (verification_level in ('standard', 'strict', 'elite'));

-- Strict and Elite are Premium. Checked for signed-in callers; server code may set anything.
create or replace function public.habits_level_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.verification_level <> 'standard'
     and (tg_op = 'INSERT' or new.verification_level is distinct from old.verification_level)
     and auth.uid() is not null
     and not public.has_premium(new.user_id) then
    raise exception 'premium_required: Strict and Elite verification are part of Premium' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger habits_level_guard before insert or update of verification_level on public.habits
  for each row execute function public.habits_level_guard();

grant insert (verification_level), update (verification_level) on public.habits to authenticated;

-- ---------------------------------------------------------------------
-- 2. Evidence items
-- ---------------------------------------------------------------------
alter table public.proofs
  add column level text not null default 'standard' check (level in ('standard', 'strict', 'elite')),
  add column requested_evidence text check (requested_evidence is null or char_length(requested_evidence) <= 300);

create table public.proof_items (
  id            uuid primary key default gen_random_uuid(),
  proof_id      uuid not null references public.proofs (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  kind          text not null check (kind in ('live', 'screenshot')),
  position      smallint not null check (position between 0 and 5),
  storage_path  text not null,
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  dhash         text check (dhash is null or dhash ~ '^[0-9a-f]{16}$'),
  created_at    timestamptz not null default now(),
  unique (proof_id, position)
);
create index proof_items_user_sha_idx on public.proof_items (user_id, sha256);
create index proof_items_user_kind_idx on public.proof_items (user_id, kind, created_at desc);
alter table public.proof_items enable row level security;
create policy proof_items_own_select on public.proof_items for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.proof_items from anon, authenticated;
grant select on public.proof_items to authenticated;

-- Hamming distance between two 64-bit perceptual hashes (16 hex chars).
create or replace function public.hash_distance(a text, b text)
returns integer language sql immutable set search_path = '' as $$
  select length(replace((('x' || a)::bit(64) # ('x' || b)::bit(64))::text, '0', ''))
$$;

-- Earlier evidence from the same user that matches the new evidence.
--   exact = same bytes (SHA-256); otherwise distance = smallest dHash distance (≤ p_max_distance).
-- Only evidence attached to other targets counts (a retake for the same target is fine).
create or replace function public.find_duplicate_evidence(
  p_user uuid, p_target uuid, p_sha256 text[], p_dhash text[], p_max_distance integer default 6
) returns table (input_index integer, exact boolean, distance integer, kind text, proof_id uuid, target_id uuid, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with inp as (
    select i::integer as idx, s as sha, d as dh
      from unnest(p_sha256, p_dhash) with ordinality as u(s, d, i)
  )
  select inp.idx - 1, (pi.sha256 = inp.sha) as exact,
         case when pi.sha256 = inp.sha then 0 else public.hash_distance(pi.dhash, inp.dh) end,
         pi.kind, pi.proof_id, p.target_id, pi.created_at
    from inp
    join public.proof_items pi on pi.user_id = p_user
    join public.proofs p on p.id = pi.proof_id
   where p.target_id <> p_target
     and (pi.sha256 = inp.sha
          or (inp.dh is not null and pi.dhash is not null and public.hash_distance(pi.dhash, inp.dh) <= p_max_distance))
   order by 1, 2 desc, 3
$$;

-- ---------------------------------------------------------------------
-- 3. Streaks recomputed from settled history (used when a verdict is overturned)
-- Excused targets neither break nor extend a streak.
-- ---------------------------------------------------------------------
create or replace function public.recompute_streak(p_habit uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  for r in select status from public.targets
            where habit_id = p_habit and status in ('verified', 'rejected', 'missed')
            order by due_at desc loop
    exit when r.status <> 'verified';
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 4. Appeals (AI re-review only)
-- ---------------------------------------------------------------------
alter type public.score_reason add value if not exists 'appeal_reversal';
insert into public.app_config (key, value, description) values
  ('appeal_window_hours', 48, 'How long after a rejection an appeal can be filed.'),
  ('appeal_max_attempts', 5, 'How many times the re-review is retried if the AI is unavailable.')
on conflict (key) do nothing;

create table public.appeals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  target_id    uuid not null unique references public.targets (id) on delete cascade,
  proof_id     uuid not null unique references public.proofs (id) on delete cascade,
  note         text check (note is null or char_length(note) <= 500),
  status       text not null default 'pending' check (status in ('pending', 'upheld', 'overturned', 'unavailable')),
  critique     text,
  confidence   numeric(4,3) check (confidence is null or confidence between 0 and 1),
  model        text,
  ai_raw       jsonb,
  attempts     smallint not null default 0,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz
);
create index appeals_user_idx on public.appeals (user_id, created_at desc);
create index appeals_pending_idx on public.appeals (created_at) where status = 'pending';
alter table public.appeals enable row level security;
create policy appeals_own_select on public.appeals for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.appeals from anon, authenticated;
grant select on public.appeals to authenticated;

alter table public.score_events add column appeal_id uuid unique references public.appeals (id) on delete cascade;
alter table public.score_events drop constraint score_events_sign;
alter table public.score_events add constraint score_events_sign check (
  delta <> 0 and ((reason::text in ('verified', 'challenge_bonus', 'appeal_reversal')) = (delta > 0)));
alter table public.score_events drop constraint score_events_source;
alter table public.score_events add constraint score_events_source check (
  (target_id is not null and challenge_id is null and appeal_id is null and reason::text not in ('challenge_bonus', 'appeal_reversal'))
  or (target_id is null and challenge_id is not null and appeal_id is null and reason::text = 'challenge_bonus')
  or (target_id is null and challenge_id is null and appeal_id is not null and reason::text = 'appeal_reversal'));

-- Opens an appeal. Called by the appeal-proof function after it has checked the caller and Premium.
create or replace function public.open_appeal(p_user uuid, p_proof uuid, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare pr public.proofs; t public.targets; v_id uuid;
begin
  select * into pr from public.proofs where id = p_proof;
  if not found or pr.user_id <> p_user then raise exception 'proof not found' using errcode = 'P0002'; end if;
  select * into t from public.targets where id = pr.target_id for update;
  if pr.outcome <> 'rejected' or t.status <> 'rejected' then
    raise exception 'only a rejected proof can be appealed' using errcode = '22023';
  end if;
  if exists (select 1 from public.appeals where target_id = t.id) then
    raise exception 'this target has already been appealed' using errcode = '23505';
  end if;
  if pr.judged_at < now() - make_interval(hours => public.cfg('appeal_window_hours')) then
    raise exception 'the appeal window has closed' using errcode = '22023';
  end if;
  insert into public.appeals (user_id, target_id, proof_id, note)
  values (p_user, t.id, pr.id, nullif(trim(left(p_note, 500)), ''))
  returning id into v_id;
  perform public.audit(p_user, 'appeal_opened', v_id, jsonb_build_object('target_id', t.id, 'proof_id', pr.id));
  return v_id;
end $$;

-- Records the re-review. An overturn turns the target into "verified", restores what the
-- rejection took and pays the verified points — as ONE new ledger row (+150 with the defaults).
create or replace function public.resolve_appeal(
  p_appeal uuid, p_overturn boolean, p_critique text, p_confidence numeric, p_model text, p_raw jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.appeals; t public.targets; v_delta integer; v_streak integer; v_total integer; ch record; p jsonb;
begin
  select * into a from public.appeals where id = p_appeal for update;
  if not found then raise exception 'appeal not found' using errcode = 'P0002'; end if;
  if a.status <> 'pending' then
    return jsonb_build_object('status', a.status, 'points_delta', 0, 'already_decided', true);
  end if;
  update public.appeals set status = case when p_overturn then 'overturned' else 'upheld' end,
         critique = left(p_critique, 600), confidence = p_confidence, model = p_model, ai_raw = p_raw,
         attempts = attempts + 1, decided_at = now()
   where id = a.id;

  if not p_overturn then
    perform public.audit(a.user_id, 'appeal_upheld', a.id, '{}'::jsonb);
    return jsonb_build_object('status', 'upheld', 'points_delta', 0, 'already_decided', false);
  end if;

  select * into t from public.targets where id = a.target_id for update;
  v_delta := public.cfg('points_verified') - public.cfg('points_failed');
  update public.targets set status = 'verified' where id = t.id;
  v_streak := public.recompute_streak(t.habit_id);
  update public.habits set current_streak = v_streak, longest_streak = greatest(longest_streak, v_streak) where id = t.habit_id;
  insert into public.score_events (user_id, habit_id, appeal_id, delta, reason, streak_after)
  values (a.user_id, t.habit_id, a.id, v_delta, 'appeal_reversal', v_streak);
  update public.profiles set total_points = total_points + v_delta where id = a.user_id returning total_points into v_total;

  -- A challenge that failed only because of this rejection becomes active again.
  for ch in select * from public.challenges
             where habit_id = t.habit_id and status = 'failed'
               and t.local_date between start_date and end_date for update loop
    p := public.challenge_progress(ch.id);
    if (p ->> 'lost')::integer <= ch.allowed_misses then
      update public.challenges set status = 'active', finished_at = null where id = ch.id;
      perform public.audit(a.user_id, 'challenge_revived', ch.id, jsonb_build_object('appeal_id', a.id));
    end if;
  end loop;

  perform public.audit(a.user_id, 'appeal_overturned', a.id, jsonb_build_object('delta', v_delta, 'streak', v_streak));
  return jsonb_build_object('status', 'overturned', 'points_delta', v_delta, 'streak', v_streak,
                            'total_points', v_total, 'already_decided', false);
end $$;

-- The re-review could not run (AI unavailable). After the configured attempts the appeal is
-- closed as "unavailable": the original verdict stands, and the user is told exactly that.
create or replace function public.fail_appeal(p_appeal uuid, p_raw jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare a public.appeals;
begin
  update public.appeals set attempts = attempts + 1, ai_raw = p_raw
   where id = p_appeal and status = 'pending' returning * into a;
  if not found then return null; end if;
  if a.attempts >= public.cfg('appeal_max_attempts') or a.created_at < now() - interval '24 hours' then
    update public.appeals set status = 'unavailable', decided_at = now() where id = a.id;
    perform public.audit(a.user_id, 'appeal_unavailable', a.id, '{}'::jsonb);
    return 'unavailable';
  end if;
  return 'pending';
end $$;

-- ---------------------------------------------------------------------
-- 5. Privileges
-- ---------------------------------------------------------------------
revoke execute on function public.habits_level_guard(), public.hash_distance(text, text),
  public.find_duplicate_evidence(uuid, uuid, text[], text[], integer), public.recompute_streak(uuid),
  public.open_appeal(uuid, uuid, text), public.resolve_appeal(uuid, boolean, text, numeric, text, jsonb),
  public.fail_appeal(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.hash_distance(text, text),
  public.find_duplicate_evidence(uuid, uuid, text[], text[], integer), public.recompute_streak(uuid),
  public.open_appeal(uuid, uuid, text), public.resolve_appeal(uuid, boolean, text, numeric, text, jsonb),
  public.fail_appeal(uuid, jsonb)
  to service_role;
