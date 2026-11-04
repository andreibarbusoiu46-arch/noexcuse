-- =====================================================================
-- Phase 4 — accountability partners
--   * Invite by code (Premium to create, anyone can accept), max partners per user.
--   * Partners see each other's name, Discipline Score, streak, weekly rate and today's
--     commitments with their state — never photos, notes or AI critiques.
--   * Nudges (one per partner per day) and "partner missed" alerts are pushed by cron-tick.
-- =====================================================================

insert into public.app_config (key, value, description) values
  ('max_partners', 5, 'Maximum accountability partners per user.'),
  ('partner_invite_days', 7, 'How long a partner invite code stays valid.'),
  ('max_open_invites', 3, 'Open (unused, unexpired) invite codes per user.')
on conflict (key) do nothing;

create table public.partner_invites (
  code        text primary key check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  inviter     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_by     uuid references public.profiles (id) on delete set null,
  used_at     timestamptz
);
create index partner_invites_inviter_idx on public.partner_invites (inviter, created_at desc);

create table public.partnerships (
  id          uuid primary key default gen_random_uuid(),
  user_a      uuid not null references public.profiles (id) on delete cascade,
  user_b      uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  check (user_a < user_b),
  unique (user_a, user_b)
);
create index partnerships_b_idx on public.partnerships (user_b);

create table public.partner_nudges (
  id           uuid primary key default gen_random_uuid(),
  from_user    uuid not null references public.profiles (id) on delete cascade,
  to_user      uuid not null references public.profiles (id) on delete cascade,
  local_day    date not null,            -- sender's local day, for the once-a-day limit
  created_at   timestamptz not null default now(),
  notified_at  timestamptz,
  unique (from_user, to_user, local_day)
);
create index partner_nudges_pending_idx on public.partner_nudges (created_at) where notified_at is null;

alter table public.partner_invites enable row level security;
alter table public.partnerships    enable row level security;
alter table public.partner_nudges  enable row level security;
revoke all on public.partner_invites, public.partnerships, public.partner_nudges from anon, authenticated;
-- Clients go through the functions below only.

create or replace function public.are_partners(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.partnerships where user_a = least(p_a, p_b) and user_b = greatest(p_a, p_b))
$$;

create or replace function public.partner_ids(p_user uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select case when user_a = p_user then user_b else user_a end from public.partnerships where p_user in (user_a, user_b)
$$;

create or replace function public.create_partner_invite()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_code text; v_exp timestamptz; i integer;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if not public.has_premium(v_uid) then
    raise exception 'premium_required: inviting partners is part of Premium' using errcode = '42501';
  end if;
  if (select count(*) from public.partner_ids(v_uid)) >= public.cfg('max_partners') then
    raise exception 'partner limit reached' using errcode = '22023';
  end if;
  if (select count(*) from public.partner_invites where inviter = v_uid and used_at is null and expires_at > now()) >= public.cfg('max_open_invites') then
    raise exception 'too many open invites' using errcode = '22023';
  end if;
  v_exp := now() + make_interval(days => public.cfg('partner_invite_days'));
  loop
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(alphabet, 1 + (get_byte(uuid_send(gen_random_uuid()), 0) % 32), 1);
    end loop;
    begin
      insert into public.partner_invites (code, inviter, expires_at) values (v_code, v_uid, v_exp);
      exit;
    exception when unique_violation then -- try another code
    end;
  end loop;
  perform public.audit(v_uid, 'partner_invite_created', null, jsonb_build_object('expires_at', v_exp));
  return jsonb_build_object('code', v_code, 'expires_at', v_exp);
end $$;

create or replace function public.accept_partner_invite(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); inv public.partner_invites; v_name text;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '42501'; end if;
  select * into inv from public.partner_invites where code = upper(trim(p_code)) for update;
  if not found or inv.used_at is not null or inv.expires_at <= now() then
    raise exception 'invite code is invalid or expired' using errcode = 'P0002';
  end if;
  if inv.inviter = v_uid then raise exception 'you can''t accept your own invite' using errcode = '22023'; end if;
  if public.are_partners(inv.inviter, v_uid) then raise exception 'you are already partners' using errcode = '23505'; end if;
  if (select count(*) from public.partner_ids(v_uid)) >= public.cfg('max_partners')
     or (select count(*) from public.partner_ids(inv.inviter)) >= public.cfg('max_partners') then
    raise exception 'partner limit reached' using errcode = '22023';
  end if;
  update public.partner_invites set used_by = v_uid, used_at = now() where code = inv.code;
  insert into public.partnerships (user_a, user_b) values (least(inv.inviter, v_uid), greatest(inv.inviter, v_uid));
  perform public.audit(v_uid, 'partner_added', inv.inviter, '{}'::jsonb);
  perform public.audit(inv.inviter, 'partner_added', v_uid, '{}'::jsonb);
  select display_name into v_name from public.profiles where id = inv.inviter;
  return jsonb_build_object('partner_id', inv.inviter, 'display_name', v_name);
end $$;

create or replace function public.remove_partner(p_partner uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); c integer;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '42501'; end if;
  delete from public.partnerships where user_a = least(v_uid, p_partner) and user_b = greatest(v_uid, p_partner);
  get diagnostics c = row_count;
  if c > 0 then perform public.audit(v_uid, 'partner_removed', p_partner, '{}'::jsonb); end if;
  return c > 0;
end $$;

create or replace function public.revoke_partner_invite(p_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare c integer;
begin
  delete from public.partner_invites where code = upper(trim(p_code)) and inviter = auth.uid() and used_at is null;
  get diagnostics c = row_count;
  return c > 0;
end $$;

-- What a partner may see about someone. Titles and states only.
create or replace function public.partner_card(p_user uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'display_name', p.display_name, 'total_points', p.total_points,
    'score', (select jsonb_build_object('score', d.score, 'provisional', d.provisional) from public.discipline_scores d where d.user_id = p.id order by d.day desc limit 1),
    'streak', (select coalesce(max(current_streak), 0) from public.habits where user_id = p.id and archived_at is null),
    'week', (select jsonb_build_object('settled', count(*) filter (where status in ('verified', 'missed', 'rejected')),
                                       'verified', count(*) filter (where status = 'verified'))
               from public.targets where user_id = p.id and local_date between (now() at time zone p.timezone)::date - 6 and (now() at time zone p.timezone)::date),
    'today', coalesce((select jsonb_agg(jsonb_build_object('title', h.title, 'due_at', t.due_at,
                         'state', case when t.status = 'verified' then 'verified'
                                       when t.status in ('missed', 'rejected') then 'failed'
                                       when t.status = 'excused' then 'excused'
                                       when now() between t.due_at - interval '15 minutes' and t.due_at + interval '15 minutes' then 'in_progress'
                                       else 'pending' end) order by t.due_at)
                         from public.targets t join public.habits h on h.id = t.habit_id
                        where t.user_id = p.id and t.local_date = (now() at time zone p.timezone)::date), '[]'::jsonb)
  ) from public.profiles p where p.id = p_user
$$;

create or replace function public.get_partners()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_tz text;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '42501'; end if;
  select timezone into v_tz from public.profiles where id = v_uid;
  return jsonb_build_object(
    'partners', coalesce((select jsonb_agg(public.partner_card(pid) || jsonb_build_object(
                             'since', (select created_at from public.partnerships where user_a = least(v_uid, pid) and user_b = greatest(v_uid, pid)),
                             'nudged_today', exists (select 1 from public.partner_nudges n where n.from_user = v_uid and n.to_user = pid
                                                      and n.local_day = (now() at time zone v_tz)::date))
                                     order by pid)
                            from public.partner_ids(v_uid) pid), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'expires_at', expires_at) order by created_at desc)
                           from public.partner_invites where inviter = v_uid and used_at is null and expires_at > now()), '[]'::jsonb),
    'max_partners', public.cfg('max_partners'),
    'can_invite', public.has_premium(v_uid)
  );
end $$;

create or replace function public.nudge_partner(p_partner uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_day date; c integer;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if not public.are_partners(v_uid, p_partner) then raise exception 'not your partner' using errcode = '42501'; end if;
  select (now() at time zone timezone)::date into v_day from public.profiles where id = v_uid;
  insert into public.partner_nudges (from_user, to_user, local_day) values (v_uid, p_partner, v_day) on conflict do nothing;
  get diagnostics c = row_count;
  return c > 0;
end $$;

-- For cron-tick: nudges not yet pushed (claimed atomically).
create or replace function public.claim_partner_nudges(p_limit integer default 50)
returns table (nudge_id uuid, from_user uuid, from_name text, to_user uuid)
language sql security definer set search_path = '' as $$
  with c as (
    update public.partner_nudges n set notified_at = now()
     where n.id in (select id from public.partner_nudges where notified_at is null order by created_at limit p_limit for update skip locked)
    returning n.id, n.from_user, n.to_user
  )
  select c.id, c.from_user, p.display_name, c.to_user from c join public.profiles p on p.id = c.from_user
$$;

revoke execute on function public.are_partners(uuid, uuid), public.partner_ids(uuid), public.partner_card(uuid),
  public.claim_partner_nudges(integer), public.create_partner_invite(), public.accept_partner_invite(text),
  public.remove_partner(uuid), public.revoke_partner_invite(text), public.get_partners(), public.nudge_partner(uuid)
  from public, anon, authenticated;
grant execute on function public.create_partner_invite(), public.accept_partner_invite(text), public.remove_partner(uuid),
  public.revoke_partner_invite(text), public.get_partners(), public.nudge_partner(uuid) to authenticated;
grant execute on function public.are_partners(uuid, uuid), public.partner_ids(uuid), public.partner_card(uuid),
  public.claim_partner_nudges(integer) to service_role;
