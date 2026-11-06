-- AI verification v2 (Gemini): activity-aware requirements, structured analysis per proof,
-- usage/cost accounting, per-user limits, an internal usage overview, tighter storage rules.

-- ---------------------------------------------------------------------
-- 1. Commitments: the kind of activity (null = detected from the title)
-- ---------------------------------------------------------------------
alter table public.habits add column activity text
  check (activity is null or activity in ('gym', 'running', 'reading', 'studying', 'eating', 'wake_up', 'general'));
grant insert (activity), update (activity) on public.habits to authenticated;

-- ---------------------------------------------------------------------
-- 2. Proofs: the validated analysis shown to the user
-- ---------------------------------------------------------------------
-- { status, confidence, summary, evidence[], requirements[], missing[], consistency, explanation,
--   next_action, activity, level, model_status, provider, model }
alter table public.proofs add column analysis jsonb;

-- ---------------------------------------------------------------------
-- 3. Usage accounting: one row per AI call, never any prompt, image or answer
-- ---------------------------------------------------------------------
create table public.ai_usage (
  id               bigint generated always as identity primary key,
  user_id          uuid references public.profiles (id) on delete set null,
  feature          text not null check (feature in ('verify', 'appeal', 'coach', 'generate', 'selftest')),
  provider         text,
  model            text,
  status           text not null,          -- ok | config | auth | quota | rate_limit | bad_request | blocked | timeout | network | server | invalid_output | error
  http_status      integer,
  input_tokens     integer,
  output_tokens    integer,
  thinking_tokens  integer,
  total_tokens     integer,
  latency_ms       integer,
  attempts         smallint not null default 1,
  ref_id           uuid,
  created_at       timestamptz not null default now()
);
create index ai_usage_created_idx on public.ai_usage (created_at desc);
create index ai_usage_user_idx on public.ai_usage (user_id, feature, created_at desc);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

-- Published prices (USD per 1M tokens). Costs are estimates; null when the model has no price row.
create table public.ai_pricing (
  model              text primary key,
  input_per_m        numeric(10,4) not null,
  output_per_m       numeric(10,4) not null,
  source             text not null,
  updated_at         timestamptz not null default now()
);
alter table public.ai_pricing enable row level security;
revoke all on public.ai_pricing from anon, authenticated;
insert into public.ai_pricing (model, input_per_m, output_per_m, source) values
  ('gemini-3.1-flash-lite', 0.25, 1.50, 'ai.google.dev/gemini-api/docs/pricing, paid tier, Nov 2026'),
  ('gemini-3.5-flash', 1.50, 9.00, 'ai.google.dev/gemini-api/docs/pricing, paid tier, Nov 2026')
on conflict (model) do nothing;

-- Limits (per user, rolling 24 h) and attempts per target.
insert into public.app_config (key, value, description) values
  ('ai_verify_daily_limit', 40, 'AI evidence analyses per user per 24 hours.'),
  ('proof_attempts_per_target', 6, 'Evidence submissions allowed for one target (first try + resubmissions).')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 4. Who may see the internal overview
-- ---------------------------------------------------------------------
create table public.admins (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()))
$$;

/** Usage overview for admins: counts, tokens, errors and estimated cost, per day and per model. */
create or replace function public.get_ai_usage_overview(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_since timestamptz := now() - make_interval(days => greatest(1, least(p_days, 365)));
begin
  if not public.is_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'since', v_since,
    'totals', (select jsonb_build_object(
        'calls', count(*),
        'ok', count(*) filter (where u.status = 'ok'),
        'errors', count(*) filter (where u.status <> 'ok'),
        'input_tokens', coalesce(sum(u.input_tokens), 0),
        'output_tokens', coalesce(sum(u.output_tokens), 0),
        'thinking_tokens', coalesce(sum(u.thinking_tokens), 0),
        'total_tokens', coalesce(sum(u.total_tokens), 0),
        'est_cost_usd', round(coalesce(sum((coalesce(u.input_tokens, 0) * p.input_per_m
                          + (coalesce(u.output_tokens, 0) + coalesce(u.thinking_tokens, 0)) * p.output_per_m) / 1e6), 0), 4),
        'unpriced_calls', count(*) filter (where p.model is null and u.total_tokens is not null),
        'avg_latency_ms', round(avg(u.latency_ms) filter (where u.status = 'ok')))
      from public.ai_usage u left join public.ai_pricing p on p.model = u.model where u.created_at >= v_since),
    'by_feature', coalesce((select jsonb_agg(x order by x ->> 'feature') from (
        select jsonb_build_object('feature', feature, 'calls', count(*), 'errors', count(*) filter (where status <> 'ok'),
                                  'total_tokens', coalesce(sum(total_tokens), 0)) as x
          from public.ai_usage where created_at >= v_since group by feature) f), '[]'::jsonb),
    'by_model', coalesce((select jsonb_agg(x order by x ->> 'model') from (
        select jsonb_build_object('model', coalesce(u.model, '—'), 'provider', u.provider, 'calls', count(*),
                                  'total_tokens', coalesce(sum(u.total_tokens), 0),
                                  'est_cost_usd', case when max(p.model) is null then null else round(sum((coalesce(u.input_tokens, 0) * p.input_per_m
                                       + (coalesce(u.output_tokens, 0) + coalesce(u.thinking_tokens, 0)) * p.output_per_m) / 1e6), 4) end) as x
          from public.ai_usage u left join public.ai_pricing p on p.model = u.model
         where u.created_at >= v_since group by u.model, u.provider) m), '[]'::jsonb),
    'errors', coalesce((select jsonb_agg(x order by (x ->> 'count')::int desc) from (
        select jsonb_build_object('status', status, 'count', count(*), 'last_at', max(created_at)) as x
          from public.ai_usage where created_at >= v_since and status <> 'ok' group by status) e), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(x order by x ->> 'day') from (
        select jsonb_build_object('day', created_at::date, 'calls', count(*), 'errors', count(*) filter (where status <> 'ok'),
                                  'total_tokens', coalesce(sum(total_tokens), 0)) as x
          from public.ai_usage where created_at >= v_since group by created_at::date) d), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------
-- 5. Limits, checked by verify-proof before any AI call
-- ---------------------------------------------------------------------
create or replace function public.ai_limits_check(p_user uuid, p_target uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when (select count(*) from public.proofs where target_id = p_target) >= public.cfg('proof_attempts_per_target') then 'target_attempts'
    when (select count(*) from public.ai_usage where user_id = p_user and feature = 'verify'
           and created_at > now() - interval '24 hours') >= public.cfg('ai_verify_daily_limit') then 'daily_limit'
    else null end
$$;

revoke execute on function public.is_admin(), public.get_ai_usage_overview(integer), public.ai_limits_check(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.is_admin(), public.get_ai_usage_overview(integer) to authenticated;
grant execute on function public.ai_limits_check(uuid, uuid) to service_role;
