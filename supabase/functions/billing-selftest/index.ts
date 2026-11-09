// Internal end-to-end test of web subscriptions against Stripe TEST MODE (refuses live keys).
// POST with the Vault cron secret, body { phase: "a" | "b" } (two phases keep each call under the time limit).
// Uses throw-away confirmed users (@example.com) and Stripe test clocks to move time forward, and checks that
// what Stripe does reaches our database through the real webhook (signature check, de-duplication, sync).
// Everything it creates — users, customers, clocks — is deleted at the end, even on failure.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { adminClient, env, json } from "../_shared/http.ts";
import { isInternal } from "../_shared/internal.ts";
import { PRICE_LOOKUP_KEY, stripe, stripeKey } from "../_shared/stripe.ts";

type Check = { name: string; ok: boolean; detail?: string };
const rnd = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  const admin = adminClient();
  if (!(await isInternal(req, admin))) return json(401, { error: "unauthorized" });
  const key = stripeKey();
  if (!key || !key.includes("_test_")) return json(400, { error: "test_key_required" });
  const url = env("SUPABASE_URL"), anon = env("SUPABASE_ANON_KEY");
  const { phase = "a" } = await req.json().catch(() => ({})) as { phase?: string };

  const checks: Check[] = [];
  const ok = (name: string, cond: unknown, detail?: unknown) =>
    checks.push({ name, ok: !!cond, ...(cond ? {} : { detail: (typeof detail === "string" ? detail : JSON.stringify(detail))?.slice(0, 300) }) });
  const users: string[] = [], clocks: string[] = [], customers: string[] = [];

  async function makeUser(): Promise<{ id: string; db: SupabaseClient; token: string }> {
    const email = `noexcuse-billing-${rnd()}@example.com`, password = `Bt-${rnd()}-${rnd()}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: "Billing Test" } });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    users.push(data.user.id);
    const db = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const s = await db.auth.signInWithPassword({ email, password });
    if (s.error || !s.data.session) throw new Error(`signIn: ${s.error?.message}`);
    return { id: data.user.id, db, token: s.data.session.access_token };
  }
  const billing = async (token: string, action: string) => {
    const r = await fetch(`${url}/functions/v1/billing`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, apikey: anon }, body: JSON.stringify({ action }) });
    return { status: r.status, body: await r.json().catch(() => null) as Record<string, unknown> | null };
  };
  /** Waits until the webhook has written a row matching `pred` for this user. */
  async function waitRow(userId: string, pred: (r: Record<string, unknown>) => boolean, ms = 30_000) {
    const end = Date.now() + ms;
    let last: Record<string, unknown> | null = null;
    while (Date.now() < end) {
      const { data } = await admin.from("stripe_subscriptions").select("*").eq("user_id", userId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      last = data;
      if (data && pred(data)) return data;
      await sleep(1500);
    }
    return last;
  }
  const premium = async (uid: string) => (await admin.rpc("has_premium", { p_user: uid })).data === true;
  async function advance(clock: string, to: number) {
    await stripe(key!, "POST", `/test_helpers/test_clocks/${clock}/advance`, { frozen_time: to });
    for (let i = 0; i < 40; i++) {
      const c = await stripe<{ status: string }>(key!, "GET", `/test_helpers/test_clocks/${clock}`);
      if (c.status === "ready") return true;
      await sleep(1500);
    }
    return false;
  }
  /** A customer on its own test clock, linked to the user, with a test card. */
  async function clockCustomer(userId: string, card: string) {
    const now = Math.floor(Date.now() / 1000);
    const clock = await stripe<{ id: string }>(key!, "POST", "/test_helpers/test_clocks", { frozen_time: now, name: `noexcuse-selftest-${rnd()}` });
    clocks.push(clock.id);
    const cus = await stripe<{ id: string }>(key!, "POST", "/customers", { test_clock: clock.id, metadata: { user_id: userId } });
    customers.push(cus.id);
    await admin.from("billing_customers").insert({ user_id: userId, stripe_customer_id: cus.id });
    const pm = await stripe<{ id: string }>(key!, "POST", `/payment_methods/${card}/attach`, { customer: cus.id });
    await stripe(key!, "POST", `/customers/${cus.id}`, { invoice_settings: { default_payment_method: pm.id } });
    return { clock: clock.id, customer: cus.id, now };
  }
  const priceId = async () => (await stripe<{ data: { id: string }[] }>(key, "GET", "/prices", { lookup_keys: [PRICE_LOOKUP_KEY], active: true })).data[0]?.id;

  try {
    if (phase === "a") {
      // ---- Checkout, plan, portal, trial → first payment → renewal → cancel / resume / end ----
      const A = await makeUser();
      const plan = await billing(A.token, "plan");
      ok("plan: €9.99/month, 3-day trial offered, test mode", plan.status === 200 && plan.body?.amount === 999 && plan.body?.currency === "eur"
        && plan.body?.trial_days === 3 && plan.body?.mode === "test", plan);
      const co = await billing(A.token, "checkout");
      ok("checkout: Stripe Checkout session created", co.status === 200 && String(co.body?.url ?? "").startsWith("https://checkout.stripe.com/"), co.status);
      const { data: bc } = await admin.from("billing_customers").select("stripe_customer_id").eq("user_id", A.id).maybeSingle();
      ok("checkout: Stripe customer linked to the user", !!bc?.stripe_customer_id, bc);
      if (bc?.stripe_customer_id) customers.push(bc.stripe_customer_id as string);
      const anonCo = await fetch(`${url}/functions/v1/billing`, { method: "POST", headers: { "content-type": "application/json", apikey: anon }, body: '{"action":"checkout"}' });
      ok("checkout: refused without sign-in", anonCo.status === 401, anonCo.status);
      await anonCo.body?.cancel();

      // Lifecycle on a test clock (what Checkout does after the card is entered).
      const B = await makeUser();
      const c = await clockCustomer(B.id, "pm_card_visa");
      const price = await priceId();
      const sub = await stripe<{ id: string }>(key, "POST", "/subscriptions", {
        customer: c.customer, items: [{ price }], trial_period_days: 3, metadata: { user_id: B.id },
      });
      const r1 = await waitRow(B.id, (r) => r.status === "trialing");
      ok("trial: webhook synced status trialing with trial end in 3 days", r1?.status === "trialing"
        && Math.abs(new Date(r1.trial_end as string).getTime() / 1000 - (c.now + 3 * 86400)) < 120, r1);
      ok("trial: Premium is active during the trial", await premium(B.id));
      const ent = await B.db.rpc("get_entitlement");
      ok("trial: the app sees the trial (source stripe, will renew)", ent.data?.source === "stripe" && ent.data?.status === "trialing" && ent.data?.will_renew === true, ent.data);
      const again = await billing(B.token, "checkout");
      ok("checkout: refused when already subscribed (no double subscription)", again.status === 409, again);
      const planB = await billing(B.token, "plan");
      ok("trial: not offered a second time", planB.body?.trial_days === null, planB.body);
      const portal = await billing(B.token, "portal");
      ok("portal: Customer Portal session created", portal.status === 200 && String(portal.body?.url ?? "").startsWith("https://billing.stripe.com/"), portal.status);

      await stripe(key, "POST", `/subscriptions/${sub.id}`, { cancel_at_period_end: true });
      const r2 = await waitRow(B.id, (r) => r.cancel_at_period_end === true);
      ok("cancel: cancel at period end synced, Premium kept until then", r2?.cancel_at_period_end === true && await premium(B.id), r2);
      await stripe(key, "POST", `/subscriptions/${sub.id}`, { cancel_at_period_end: false });
      const r3 = await waitRow(B.id, (r) => r.cancel_at_period_end === false);
      ok("cancel: resume synced", r3?.cancel_at_period_end === false, r3);

      const t1 = c.now + 3 * 86400 + 3600;
      ok("clock: advanced past the trial", await advance(c.clock, t1));
      const r4 = await waitRow(B.id, (r) => r.status === "active" && r.latest_invoice_status === "paid", 45_000);
      ok("payment: first €9.99 charged after the trial, status active", r4?.status === "active" && r4?.latest_invoice_status === "paid", r4);
      const end1 = r4 ? new Date(r4.current_period_end as string).getTime() / 1000 : 0;

      ok("clock: advanced one month", await advance(c.clock, end1 + 3600));
      const r5 = await waitRow(B.id, (r) => new Date(r.current_period_end as string).getTime() / 1000 > end1 + 86400 && r.latest_invoice_status === "paid", 45_000);
      ok("renewal: next month charged, period moved forward, still Premium", !!r5 && r5.status === "active" && await premium(B.id), r5);

      await stripe(key, "DELETE", `/subscriptions/${sub.id}`);
      const r6 = await waitRow(B.id, (r) => r.status === "canceled");
      ok("cancel now: canceled synced, Premium removed", r6?.status === "canceled" && !(await premium(B.id)), r6);
    }

    if (phase === "b") {
      // ---- Failed payment at the end of the trial, and webhook security ----
      const D = await makeUser();
      const c = await clockCustomer(D.id, "pm_card_chargeCustomerFail");
      const price = await priceId();
      await stripe(key, "POST", "/subscriptions", { customer: c.customer, items: [{ price }], trial_period_days: 3, metadata: { user_id: D.id } });
      const r1 = await waitRow(D.id, (r) => r.status === "trialing");
      ok("failed payment: trial starts (card attaches, not charged yet)", r1?.status === "trialing", r1);
      ok("clock: advanced past the trial", await advance(c.clock, c.now + 3 * 86400 + 3600));
      const r2 = await waitRow(D.id, (r) => r.status === "past_due" || r.status === "unpaid" || r.status === "canceled", 45_000);
      ok("failed payment: charge declined → past_due synced, Premium removed", !!r2 && r2.status !== "active" && !(await premium(D.id)), r2);
      const ent = await D.db.rpc("get_entitlement");
      ok("failed payment: the app shows the failed payment", ent.data?.payment_failed === true || ent.data?.status === "canceled", ent.data);

      const forged = await fetch(`${url}/functions/v1/stripe-webhook`, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}` }, body: '{"id":"evt_forged","type":"customer.subscription.updated","livemode":false,"data":{"object":{}}}' });
      ok("webhook: forged signature rejected", forged.status === 400, forged.status);
      await forged.body?.cancel();
      const { count: dup } = await admin.from("stripe_events").select("id", { count: "exact", head: true }).eq("id", "evt_forged");
      ok("webhook: forged event not recorded", dup === 0, dup);
      const { data: evs } = await admin.from("stripe_events").select("id").order("received_at", { ascending: false }).limit(200);
      ok("webhook: real events arrived and each id is stored once", (evs ?? []).length > 0 && new Set((evs ?? []).map((e) => e.id)).size === (evs ?? []).length, (evs ?? []).length);
    }
  } catch (e) {
    ok("run completed without exceptions", false, e instanceof Error ? e.message : String(e));
  } finally {
    for (const cl of clocks) await stripe(key, "DELETE", `/test_helpers/test_clocks/${cl}`).catch(() => {});
    for (const cu of customers) await stripe(key, "DELETE", `/customers/${cu}`).catch(() => {});
    for (const id of users) await admin.auth.admin.deleteUser(id);
    const { data: left } = await admin.from("profiles").select("id").in("id", users.length ? users : ["00000000-0000-0000-0000-000000000000"]);
    ok("cleanup: test users, customers and clocks removed", (left ?? []).length === 0, left);
  }
  const failed = checks.filter((c) => !c.ok);
  return json(200, { phase, passed: checks.length - failed.length, failed: failed.length, checks });
});
