-- Web subscriptions with Stripe (test mode first). The App Store keeps using StoreKit through RevenueCat
-- (public.entitlements); Stripe state lives in its own tables so neither source overwrites the other.
-- Premium = an active App Store entitlement OR a Stripe subscription that is trialing / active.

-- One Stripe customer per user. trial_used: the 3-day trial is offered once per account.
create table public.billing_customers (
  user_id             uuid primary key references public.profiles (id) on delete cascade,
  stripe_customer_id  text not null unique,
  trial_used          boolean not null default false,
  created_at          timestamptz not null default now()
);

create table public.stripe_subscriptions (
  subscription_id       text primary key,
  user_id               uuid not null references public.profiles (id) on delete cascade,
  stripe_customer_id    text not null,
  status                text not null,          -- trialing | active | past_due | unpaid | canceled | incomplete | incomplete_expired | paused
  price_id              text,
  trial_start           timestamptz,
  trial_end             timestamptz,
  current_period_start  timestamptz,
  current_period_end    timestamptz,
  cancel_at_period_end  boolean not null default false,
  cancel_at             timestamptz,
  canceled_at           timestamptz,
  ended_at              timestamptz,
  latest_invoice_status text,                   -- paid | open | uncollectible | … (failed payments show as open + past_due)
  stripe_updated        bigint not null default 0, -- Stripe event time of the snapshot; older snapshots never overwrite newer ones
  updated_at            timestamptz not null default now()
);
create index stripe_subscriptions_user_idx on public.stripe_subscriptions (user_id, updated_at desc);

-- Webhook de-duplication: an event id is processed once.
create table public.stripe_events (
  id           text primary key,
  type         text not null,
  received_at  timestamptz not null default now()
);

alter table public.billing_customers enable row level security;
alter table public.stripe_subscriptions enable row level security;
alter table public.stripe_events enable row level security;
revoke all on public.billing_customers, public.stripe_subscriptions, public.stripe_events from anon, authenticated;
-- Users may read their own subscription (status page); every write goes through the server.
grant select on public.stripe_subscriptions to authenticated;
create policy stripe_subscriptions_own on public.stripe_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

/** Premium from either store. Used by every server-side premium check. */
create or replace function public.has_premium(p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select e.is_active and (e.expires_at is null or e.expires_at > now())
                     from public.entitlements e where e.user_id = p_user), false)
      or exists (select 1 from public.stripe_subscriptions s
                  where s.user_id = p_user and s.status in ('trialing', 'active')
                    and (s.current_period_end is null or s.current_period_end > now() - interval '1 hour'))
$$;

/** What the app shows: the subscription that grants access (or the latest one), from either store. */
create or replace function public.get_entitlement()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); s public.stripe_subscriptions; e public.entitlements;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into s from public.stripe_subscriptions where user_id = v_uid
   order by (status in ('trialing', 'active')) desc, updated_at desc limit 1;
  select * into e from public.entitlements where user_id = v_uid;
  if s.subscription_id is not null and (s.status in ('trialing', 'active') or not coalesce(e.is_active, false)) then
    return jsonb_build_object(
      'source', 'stripe', 'is_active', public.has_premium(v_uid), 'status', s.status,
      'period_type', case when s.status = 'trialing' then 'trial' else 'normal' end,
      'expires_at', coalesce(case when s.status = 'trialing' then s.trial_end end, s.current_period_end),
      'will_renew', s.status in ('trialing', 'active') and not s.cancel_at_period_end,
      'trial_end', s.trial_end, 'current_period_start', s.current_period_start, 'current_period_end', s.current_period_end,
      'cancel_at_period_end', s.cancel_at_period_end, 'canceled_at', s.canceled_at,
      'payment_failed', s.status in ('past_due', 'unpaid') or s.latest_invoice_status = 'open' and s.status <> 'trialing');
  end if;
  if e.user_id is not null then
    return jsonb_build_object('source', coalesce(e.store, 'app_store'), 'is_active', public.has_premium(v_uid),
      'status', case when e.is_active then 'active' else 'inactive' end, 'period_type', e.period_type,
      'expires_at', e.expires_at, 'will_renew', e.will_renew);
  end if;
  return null;
end $$;

/** Writes a Stripe subscription snapshot (webhook / sync). Ignores snapshots older than the stored one. */
create or replace function public.stripe_upsert_subscription(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  select user_id into v_user from public.billing_customers where stripe_customer_id = p ->> 'customer';
  if v_user is null then v_user := nullif(p ->> 'user_id', '')::uuid; end if;
  if v_user is null or not exists (select 1 from public.profiles where id = v_user) then
    raise exception 'unknown customer %', p ->> 'customer' using errcode = 'P0002';
  end if;
  insert into public.stripe_subscriptions as t (subscription_id, user_id, stripe_customer_id, status, price_id, trial_start, trial_end,
      current_period_start, current_period_end, cancel_at_period_end, cancel_at, canceled_at, ended_at, latest_invoice_status, stripe_updated, updated_at)
  values (p ->> 'id', v_user, p ->> 'customer', p ->> 'status', p ->> 'price_id',
      to_timestamp((p ->> 'trial_start')::bigint), to_timestamp((p ->> 'trial_end')::bigint),
      to_timestamp((p ->> 'current_period_start')::bigint), to_timestamp((p ->> 'current_period_end')::bigint),
      coalesce((p ->> 'cancel_at_period_end')::boolean, false), to_timestamp((p ->> 'cancel_at')::bigint),
      to_timestamp((p ->> 'canceled_at')::bigint), to_timestamp((p ->> 'ended_at')::bigint),
      p ->> 'latest_invoice_status', coalesce((p ->> 'event_created')::bigint, 0), now())
  on conflict (subscription_id) do update set
      status = excluded.status, price_id = excluded.price_id, trial_start = excluded.trial_start, trial_end = excluded.trial_end,
      current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end,
      cancel_at_period_end = excluded.cancel_at_period_end, cancel_at = excluded.cancel_at, canceled_at = excluded.canceled_at,
      ended_at = excluded.ended_at, latest_invoice_status = coalesce(excluded.latest_invoice_status, t.latest_invoice_status),
      stripe_updated = greatest(t.stripe_updated, excluded.stripe_updated), updated_at = now()
    where excluded.stripe_updated >= t.stripe_updated;
  if p ->> 'trial_start' is not null then
    update public.billing_customers set trial_used = true where user_id = v_user and not trial_used;
  end if;
end $$;

/** Marks a webhook event as processed; false when it was already seen. */
create or replace function public.stripe_claim_event(p_id text, p_type text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  insert into public.stripe_events (id, type) values (p_id, p_type);
  return true;
exception when unique_violation then
  return false;
end $$;

/** Webhook signing secret, kept in the Vault by the setup step (or STRIPE_WEBHOOK_SECRET in the function env). */
create or replace function public.stripe_webhook_secret()
returns text language plpgsql stable security definer set search_path = '' as $$
begin
  return (select decrypted_secret from vault.decrypted_secrets where name = 'stripe_webhook_secret' limit 1);
end $$;
create or replace function public.stripe_store_webhook_secret(p_secret text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_secret !~ '^whsec_[A-Za-z0-9]+$' then raise exception 'invalid webhook secret' using errcode = '22023'; end if;
  delete from vault.secrets where name = 'stripe_webhook_secret';
  perform vault.create_secret(p_secret, 'stripe_webhook_secret', 'Stripe webhook signing secret (set by billing setup)');
end $$;

revoke execute on function public.get_entitlement(), public.stripe_upsert_subscription(jsonb), public.stripe_claim_event(text, text),
  public.stripe_webhook_secret(), public.stripe_store_webhook_secret(text) from public, anon, authenticated;
grant execute on function public.get_entitlement() to authenticated;
grant execute on function public.stripe_upsert_subscription(jsonb), public.stripe_claim_event(text, text),
  public.stripe_webhook_secret(), public.stripe_store_webhook_secret(text) to service_role;
