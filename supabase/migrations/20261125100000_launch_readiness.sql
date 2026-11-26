-- =====================================================================
-- Launch readiness (local branch launch/readiness-95). NOT applied to production.
--   1. get_entitlement: a Premium granted without a store (manual/test grant, or a RevenueCat
--      promotional grant) is reported as 'manual' instead of 'app_store'.
-- =====================================================================

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
    return jsonb_build_object(
      'source', case when e.store is null or lower(e.store) = 'promotional' then 'manual' else lower(e.store) end,
      'is_active', public.has_premium(v_uid),
      'status', case when e.is_active then 'active' else 'inactive' end, 'period_type', e.period_type,
      'expires_at', e.expires_at, 'will_renew', e.will_renew);
  end if;
  return null;
end $$;
revoke execute on function public.get_entitlement() from public, anon;
grant execute on function public.get_entitlement() to authenticated;

-- =====================================================================
-- 2. Data export (GDPR Art. 15 / 20): everything held about the caller.
--    Adds what the Phase 6 export left out: proof photo records, Discipline Score history, partners,
--    nudges and invites, billing and trial records, AI usage, the account activity log, push devices,
--    reminders sent and camera sessions. Photos themselves stay in private storage (not embedded);
--    evidence signatures are counted, not exported (they are derived miniatures of the photos).
--    Raw AI responses stay out, as before. Push tokens are shortened: a full token can send pushes.
-- =====================================================================
create or replace function public.export_my_data()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '42501'; end if;
  return jsonb_build_object(
    'format', 'noexcuse-export-v2',
    'exported_at', now(),
    'account', (select jsonb_build_object('id', u.id, 'email', u.email, 'created_at', to_jsonb(u) -> 'created_at',
                  'email_confirmed_at', to_jsonb(u) -> 'email_confirmed_at', 'last_sign_in_at', to_jsonb(u) -> 'last_sign_in_at')
                  from auth.users u where u.id = v_uid),
    'profile', (select to_jsonb(p) from public.profiles p where id = v_uid),
    'commitments', (select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at), '[]') from public.habits h where user_id = v_uid),
    'targets', (select coalesce(jsonb_agg(to_jsonb(t) order by t.due_at), '[]') from public.targets t where user_id = v_uid),
    'proofs', (select coalesce(jsonb_agg(to_jsonb(p) - 'ai_raw' order by p.created_at), '[]') from public.proofs p where user_id = v_uid),
    'proof_photos', (select coalesce(jsonb_agg(to_jsonb(pi) order by pi.created_at), '[]') from public.proof_items pi where user_id = v_uid),
    'evidence_signatures_count', (select count(*) from public.evidence_signatures es where es.user_id = v_uid),
    'points_ledger', (select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at), '[]') from public.score_events s where user_id = v_uid),
    'discipline_scores', (select coalesce(jsonb_agg(to_jsonb(d) order by d.day), '[]') from public.discipline_scores d where user_id = v_uid),
    'challenges', (select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at), '[]') from public.challenges c where user_id = v_uid),
    'appeals', (select coalesce(jsonb_agg(to_jsonb(a) - 'ai_raw' order by a.created_at), '[]') from public.appeals a where user_id = v_uid),
    'coach_messages', (select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at), '[]') from public.coach_messages m where user_id = v_uid),
    'weekly_reports', (select coalesce(jsonb_agg(to_jsonb(r) order by r.week_start), '[]') from public.weekly_reports r where user_id = v_uid),
    'achievements', (select coalesce(jsonb_agg(to_jsonb(a) order by a.unlocked_at), '[]') from public.achievements a where user_id = v_uid),
    'partners', (select coalesce(jsonb_agg(jsonb_build_object('partner_id', case when ps.user_a = v_uid then ps.user_b else ps.user_a end,
                    'partner_name', (select p.display_name from public.profiles p where p.id = case when ps.user_a = v_uid then ps.user_b else ps.user_a end),
                    'since', ps.created_at) order by ps.created_at), '[]')
                   from public.partnerships ps where v_uid in (ps.user_a, ps.user_b)),
    'partner_invites', (select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at), '[]') from public.partner_invites i where inviter = v_uid),
    'nudges', (select coalesce(jsonb_agg(jsonb_build_object('direction', case when n.from_user = v_uid then 'sent' else 'received' end,
                  'day', n.local_day, 'created_at', n.created_at) order by n.created_at), '[]')
                 from public.partner_nudges n where v_uid in (n.from_user, n.to_user)),
    'entitlement', (select to_jsonb(e) from public.entitlements e where user_id = v_uid),
    'billing', jsonb_build_object(
      'customer', (select jsonb_build_object('trial_used', b.trial_used, 'created_at', b.created_at) from public.billing_customers b where user_id = v_uid),
      'subscriptions', (select coalesce(jsonb_agg(to_jsonb(s) - 'stripe_customer_id' order by s.updated_at), '[]') from public.stripe_subscriptions s where user_id = v_uid)),
    'ai_usage', (select coalesce(jsonb_agg(jsonb_build_object('feature', a.feature, 'status', a.status, 'model', a.model,
                   'total_tokens', a.total_tokens, 'created_at', a.created_at) order by a.created_at), '[]') from public.ai_usage a where user_id = v_uid),
    'activity_log', (select coalesce(jsonb_agg(jsonb_build_object('action', l.action, 'ref_id', l.ref_id, 'data', l.data, 'at', l.at) order by l.at), '[]')
                       from public.audit_log l where user_id = v_uid),
    'push_devices', (select coalesce(jsonb_agg(jsonb_build_object('platform', t.platform, 'token_prefix', left(t.token, 12) || '…', 'updated_at', t.updated_at)), '[]')
                       from public.push_tokens t where user_id = v_uid),
    'reminders_sent', (select coalesce(jsonb_agg(to_jsonb(n) - 'user_id' order by n.sent_at), '[]') from public.notification_log n where user_id = v_uid),
    'camera_sessions', (select coalesce(jsonb_agg(to_jsonb(c) - 'user_id' order by c.issued_at), '[]') from public.capture_sessions c where user_id = v_uid)
  );
end $$;
revoke execute on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

-- =====================================================================
-- 3. "Delete all my evidence": deterministic paging.
--    evidence_for_user_deletion returned every row in no order, and the function re-read it until a page had
--    nothing deletable, so photos past the first 1,000 were never reached when that page held only photos
--    that must be kept. This version pages with a cursor on proof id (strictly increasing, unaffected by
--    deletions) and caps the page size under the API's 1,000-row limit. Same "kept" rules as before.
--    A new name, so the function deployed today (which calls the old one) keeps working until it's replaced.
-- =====================================================================
create or replace function public.evidence_for_user_deletion_page(p_user uuid, p_after uuid default null, p_limit integer default 500)
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
     and (p_after is null or p.id > p_after)
   order by p.id
   limit least(greatest(coalesce(p_limit, 500), 1), 1000)
$$;
revoke all on function public.evidence_for_user_deletion_page(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.evidence_for_user_deletion_page(uuid, uuid, integer) to service_role;
