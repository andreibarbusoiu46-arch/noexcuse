-- Stripe subscriptions: premium from either store, ordering, de-duplication, privacy.
\set QUIET on
\pset tuples_only on

create or replace function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(p::text, ''), false); execute 'set role authenticated'; end $$;
create or replace function pg_temp.as_service() returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', '', false); execute 'set role service_role'; end $$;
create or replace function pg_temp.as_admin() returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', '', false); execute 'reset role'; end $$;
create or replace function pg_temp.expect_error(sql text, needle text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if position(needle in sqlerrm) = 0 then raise exception 'expected error containing "%", got "%"', needle, sqlerrm; end if;
    return;
  end;
  raise exception 'expected error containing "%" but statement succeeded: %', needle, sql;
end $$;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FAIL: %', msg; end if; raise notice 'ok - %', msg; end $$;
create or replace function pg_temp.snap(p_status text, p_created bigint, p_trial boolean default false, p_cancel boolean default false) returns jsonb language sql as $$
  select jsonb_build_object('id', 'sub_s1', 'customer', 'cus_s1', 'status', p_status, 'price_id', 'price_x',
    'trial_start', case when p_trial then extract(epoch from now())::bigint end,
    'trial_end', case when p_trial then extract(epoch from now() + interval '3 days')::bigint end,
    'current_period_start', extract(epoch from now())::bigint,
    'current_period_end', extract(epoch from now() + interval '30 days')::bigint,
    'cancel_at_period_end', p_cancel, 'event_created', p_created)
$$;

select pg_temp.as_admin();
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('a9500000-0000-0000-0000-000000000001', 'stripe1@test', '{"display_name":"Pay One"}', now()),
  ('a9500000-0000-0000-0000-000000000002', 'stripe2@test', '{"display_name":"Pay Two"}', now());

select pg_temp.ok(not public.has_premium('a9500000-0000-0000-0000-000000000001'), 'no subscription → no premium');

-- Clients can't touch billing tables.
select pg_temp.as_user('a9500000-0000-0000-0000-000000000001');
select pg_temp.expect_error($q$insert into public.billing_customers (user_id, stripe_customer_id) values ('a9500000-0000-0000-0000-000000000001', 'cus_fake')$q$, 'permission denied');
select pg_temp.expect_error($q$insert into public.stripe_subscriptions (subscription_id, user_id, stripe_customer_id, status) values ('sub_fake', 'a9500000-0000-0000-0000-000000000001', 'cus_fake', 'active')$q$, 'permission denied');
select pg_temp.expect_error($q$select public.stripe_upsert_subscription('{}'::jsonb)$q$, 'permission denied');
select pg_temp.ok(public.get_entitlement() is null, 'no subscription → no entitlement shown');

select pg_temp.as_service();
insert into public.billing_customers (user_id, stripe_customer_id) values ('a9500000-0000-0000-0000-000000000001', 'cus_s1');
select public.stripe_upsert_subscription(pg_temp.snap('trialing', 100, true));
select pg_temp.as_admin();
select pg_temp.ok(public.has_premium('a9500000-0000-0000-0000-000000000001'), 'trialing → premium');
select pg_temp.ok((select trial_used from public.billing_customers where user_id = 'a9500000-0000-0000-0000-000000000001'), 'trial is marked as used');

select pg_temp.as_user('a9500000-0000-0000-0000-000000000001');
select pg_temp.ok((public.get_entitlement() ->> 'status') = 'trialing' and (public.get_entitlement() ->> 'period_type') = 'trial'
  and (public.get_entitlement() ->> 'will_renew')::boolean, 'user sees their trial');
select pg_temp.ok((select count(*) from public.stripe_subscriptions) = 1, 'user reads own subscription');
select pg_temp.as_user('a9500000-0000-0000-0000-000000000002');
select pg_temp.ok((select count(*) from public.stripe_subscriptions) = 0, 'another user cannot read it');

-- Out-of-order events: an older snapshot never overwrites a newer one.
select pg_temp.as_service();
select public.stripe_upsert_subscription(pg_temp.snap('active', 300, true, true));
select public.stripe_upsert_subscription(pg_temp.snap('trialing', 200, true));
select pg_temp.as_admin();
select pg_temp.ok((select status = 'active' and cancel_at_period_end from public.stripe_subscriptions where subscription_id = 'sub_s1'), 'older snapshot ignored');
select pg_temp.as_user('a9500000-0000-0000-0000-000000000001');
select pg_temp.ok(not (public.get_entitlement() ->> 'will_renew')::boolean and (public.get_entitlement() ->> 'is_active')::boolean,
  'cancelled at period end: still premium, will not renew');

select pg_temp.as_service();
select public.stripe_upsert_subscription(pg_temp.snap('past_due', 400));
select pg_temp.as_admin();
select pg_temp.ok(not public.has_premium('a9500000-0000-0000-0000-000000000001'), 'failed payment (past_due) → no premium');
select pg_temp.as_user('a9500000-0000-0000-0000-000000000001');
select pg_temp.ok((public.get_entitlement() ->> 'payment_failed')::boolean, 'failed payment is shown');

select pg_temp.as_service();
select public.stripe_upsert_subscription(pg_temp.snap('active', 500));
select public.stripe_upsert_subscription(pg_temp.snap('canceled', 600));
select pg_temp.as_admin();
select pg_temp.ok(not public.has_premium('a9500000-0000-0000-0000-000000000001'), 'canceled → no premium');

-- Unknown customer is refused.
select pg_temp.as_service();
select pg_temp.expect_error($q$select public.stripe_upsert_subscription('{"id":"sub_x","customer":"cus_unknown","status":"active"}'::jsonb)$q$, 'unknown customer');

-- Webhook de-duplication.
select pg_temp.ok(public.stripe_claim_event('evt_1', 'customer.subscription.updated'), 'first delivery is processed');
select pg_temp.ok(not public.stripe_claim_event('evt_1', 'customer.subscription.updated'), 'duplicate delivery is skipped');

-- The App Store entitlement still counts on its own.
select pg_temp.as_admin();
insert into public.entitlements (user_id, entitlement, is_active, expires_at, store) values
  ('a9500000-0000-0000-0000-000000000002', 'premium', true, now() + interval '5 days', 'app_store');
select pg_temp.ok(public.has_premium('a9500000-0000-0000-0000-000000000002'), 'App Store subscription → premium');
select pg_temp.as_user('a9500000-0000-0000-0000-000000000002');
select pg_temp.ok((public.get_entitlement() ->> 'source') = 'app_store', 'App Store entitlement shown');
select pg_temp.as_admin();
