// Web subscriptions (Stripe). Signed-in users:
//   POST { action: "plan" }      → price, trial eligibility, whether billing is configured, test/live mode
//   POST { action: "checkout" }  → Stripe Checkout URL (3-day trial once per account, then €9.99/month)
//   POST { action: "portal" }    → Stripe Customer Portal URL (payment method, invoices, cancel / resume)
//   POST { action: "sync" }      → re-reads the user's subscriptions from Stripe (right after Checkout returns)
// Internal (Vault cron secret):
//   POST { action: "setup" }     → creates/updates the product + price, portal settings and the webhook endpoint
// The App Store build never calls this: Apple requires In-App Purchase there (RevenueCat / StoreKit).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { adminClient, env, fail, json, requireUser, withCors } from "../_shared/http.ts";
import { isInternal } from "../_shared/internal.ts";
import { fetchSnapshot, isLiveKey, PRICE_LOOKUP_KEY, stripe, StripeError, stripeKey, TRIAL_DAYS, WEBHOOK_EVENTS } from "../_shared/stripe.ts";

const APP_URL = () => (Deno.env.get("APP_URL") ?? "https://noexcuse.vercel.app").replace(/\/$/, "");
type Price = { id: string; unit_amount: number; currency: string; recurring?: { interval: string }; product?: { name?: string } | string };

async function findPrice(key: string): Promise<Price | null> {
  const r = await stripe<{ data: Price[] }>(key, "GET", "/prices", { lookup_keys: [PRICE_LOOKUP_KEY], active: true, expand: ["data.product"] });
  return r.data[0] ?? null;
}

/** The portal configuration this app created (metadata.app = noexcuse), if any. */
async function ourPortalConfig(key: string): Promise<string | null> {
  const r = await stripe<{ data: { id: string; active: boolean; metadata?: Record<string, string> }[] }>(key, "GET", "/billing_portal/configurations", { limit: 50 });
  return r.data.find((c) => c.active && c.metadata?.app === "noexcuse")?.id ?? null;
}

async function trialEligible(db: SupabaseClient, userId: string): Promise<boolean> {
  const [{ data: c }, { data: e }, { count }] = await Promise.all([
    db.from("billing_customers").select("trial_used").eq("user_id", userId).maybeSingle(),
    db.from("entitlements").select("user_id").eq("user_id", userId).maybeSingle(),
    db.from("stripe_subscriptions").select("subscription_id", { count: "exact", head: true }).eq("user_id", userId),
  ]);
  return !c?.trial_used && !e && !count;
}

async function customerFor(db: SupabaseClient, key: string, userId: string): Promise<string> {
  const { data } = await db.from("billing_customers").select("stripe_customer_id").eq("user_id", userId).maybeSingle();
  if (data?.stripe_customer_id) return data.stripe_customer_id as string;
  // No e-mail is sent to Stripe from here; Checkout asks for it. The user id links the customer back.
  const cus = await stripe<{ id: string }>(key, "POST", "/customers", { metadata: { user_id: userId } }, { idempotencyKey: `cus-${userId}` });
  const { error } = await db.from("billing_customers").insert({ user_id: userId, stripe_customer_id: cus.id });
  if (error) {
    const { data: again } = await db.from("billing_customers").select("stripe_customer_id").eq("user_id", userId).maybeSingle();
    if (again?.stripe_customer_id) return again.stripe_customer_id as string;
    throw error;
  }
  return cus.id;
}

async function sync(db: SupabaseClient, key: string, userId: string) {
  const { data } = await db.from("billing_customers").select("stripe_customer_id").eq("user_id", userId).maybeSingle();
  if (!data) return;
  const list = await stripe<{ data: { id: string }[] }>(key, "GET", "/subscriptions", { customer: data.stripe_customer_id, status: "all", limit: 10 });
  const now = Math.floor(Date.now() / 1000);
  for (const s of list.data) {
    const snap = await fetchSnapshot(key, s.id, now);
    const { error } = await db.rpc("stripe_upsert_subscription", { p: snap });
    if (error) throw new Error(`upsert: ${error.message}`);
  }
}

async function setup(db: SupabaseClient, key: string) {
  const out: Record<string, unknown> = { mode: isLiveKey(key) ? "live" : "test" };
  // Product + price (€9.99 / month). Prices are immutable, so an existing one is kept.
  let price = await findPrice(key);
  if (!price) {
    const product = await stripe<{ id: string }>(key, "POST", "/products", {
      name: "NoExcuse Premium", description: "Unlimited commitments, Strict and Elite verification, challenges, AI coach and weekly reports.",
      metadata: { app: "noexcuse" },
    }, { idempotencyKey: "noexcuse-product-v1" });
    price = await stripe<Price>(key, "POST", "/prices", {
      product: product.id, currency: "eur", unit_amount: 999, recurring: { interval: "month" }, lookup_key: PRICE_LOOKUP_KEY,
      tax_behavior: "inclusive", metadata: { app: "noexcuse" },
    }, { idempotencyKey: "noexcuse-price-v1" });
    out.price_created = true;
  }
  out.price = { id: price.id, amount: price.unit_amount, currency: price.currency, interval: price.recurring?.interval };

  // Customer Portal: update card, see invoices, cancel at period end, resume.
  const mine = await ourPortalConfig(key);
  const portal = await stripe<{ id: string }>(key, "POST", mine ? `/billing_portal/configurations/${mine}` : "/billing_portal/configurations", {
    business_profile: { headline: "Manage your NoExcuse subscription" },
    features: {
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      customer_update: { enabled: true, allowed_updates: ["email", "address"] },
      subscription_cancel: { enabled: true, mode: "at_period_end", cancellation_reason: { enabled: true, options: ["too_expensive", "unused", "other"] } },
    },
    default_return_url: `${APP_URL()}/billing`,
    metadata: { app: "noexcuse" },
  });
  out.portal_configuration = portal.id;

  // Webhook endpoint → stripe-webhook. Its signing secret is only shown at creation, so it goes straight to the Vault.
  const hookUrl = `${env("SUPABASE_URL")}/functions/v1/stripe-webhook`;
  const hooks = await stripe<{ data: { id: string; url: string }[] }>(key, "GET", "/webhook_endpoints", { limit: 100 });
  const existing = hooks.data.filter((h) => h.url === hookUrl);
  const { data: stored } = await db.rpc("stripe_webhook_secret");
  if (existing.length && typeof stored === "string" && stored.startsWith("whsec_")) {
    await stripe(key, "POST", `/webhook_endpoints/${existing[0].id}`, { enabled_events: WEBHOOK_EVENTS });
    out.webhook = { id: existing[0].id, created: false };
  } else {
    for (const h of existing) await stripe(key, "DELETE", `/webhook_endpoints/${h.id}`);
    const hook = await stripe<{ id: string; secret: string }>(key, "POST", "/webhook_endpoints", {
      url: hookUrl, enabled_events: WEBHOOK_EVENTS, description: "NoExcuse subscriptions", metadata: { app: "noexcuse" },
    });
    const { error } = await db.rpc("stripe_store_webhook_secret", { p_secret: hook.secret });
    if (error) throw new Error(`vault: ${error.message}`);
    out.webhook = { id: hook.id, created: true };
  }
  return out;
}

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return fail(405, "method_not_allowed", "POST only.");
  const db = adminClient();
  const body = await req.json().catch(() => ({})) as { action?: string };
  const key = stripeKey();

  if (body.action === "setup") {
    if (!(await isInternal(req, db))) return fail(401, "unauthorized", "Internal only.");
    if (!key) return fail(503, "billing_not_configured", "STRIPE_SECRET_KEY is not set.");
    try { return json(200, await setup(db, key)); } catch (e) {
      return fail(502, "stripe_error", e instanceof StripeError ? `${e.status} ${e.code ?? ""} ${e.message}` : String(e));
    }
  }

  const user = await requireUser(req, db);
  if (user instanceof Response) return user;
  if (!key) return fail(503, "billing_not_configured", "Payments aren’t set up yet. Try again later.");

  try {
    if (body.action === "plan") {
      const price = await findPrice(key);
      if (!price) return fail(503, "billing_not_configured", "Payments aren’t set up yet. Try again later.");
      return json(200, {
        mode: isLiveKey(key) ? "live" : "test", amount: price.unit_amount, currency: price.currency, interval: price.recurring?.interval ?? "month",
        trial_days: (await trialEligible(db, user.id)) ? TRIAL_DAYS : null,
      });
    }

    if (body.action === "checkout") {
      const { data: premium } = await db.rpc("has_premium", { p_user: user.id });
      if (premium === true) return fail(409, "already_subscribed", "You already have Premium. Manage it from Subscription.");
      const price = await findPrice(key);
      if (!price) return fail(503, "billing_not_configured", "Payments aren’t set up yet. Try again later.");
      const customer = await customerFor(db, key, user.id);
      const trial = await trialEligible(db, user.id);
      const session = await stripe<{ url: string }>(key, "POST", "/checkout/sessions", {
        mode: "subscription", customer, client_reference_id: user.id,
        line_items: [{ price: price.id, quantity: 1 }],
        subscription_data: {
          metadata: { user_id: user.id },
          ...(trial ? { trial_period_days: TRIAL_DAYS, trial_settings: { end_behavior: { missing_payment_method: "cancel" } } } : {}),
        },
        payment_method_collection: "always",
        customer_update: { address: "auto" },
        metadata: { user_id: user.id },
        success_url: `${APP_URL()}/billing?checkout=success`,
        cancel_url: `${APP_URL()}/paywall?checkout=cancelled`,
      }, { idempotencyKey: `checkout-${user.id}-${Math.floor(Date.now() / 60_000)}` });
      return json(200, { url: session.url, trial_days: trial ? TRIAL_DAYS : null });
    }

    if (body.action === "portal") {
      const { data } = await db.from("billing_customers").select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
      if (!data) return fail(404, "no_subscription", "There’s no web subscription on this account yet.");
      const configuration = await ourPortalConfig(key);
      const portal = await stripe<{ url: string }>(key, "POST", "/billing_portal/sessions", {
        customer: data.stripe_customer_id, return_url: `${APP_URL()}/billing`, ...(configuration ? { configuration } : {}),
      });
      return json(200, { url: portal.url });
    }

    if (body.action === "sync") {
      await sync(db, key, user.id);
      return json(200, { ok: true });
    }
    return fail(400, "bad_request", "Unknown action.");
  } catch (e) {
    console.error("billing", body.action, e instanceof StripeError ? `${e.status} ${e.code}` : (e as Error).message);
    return fail(502, "billing_unavailable", "Payments are unavailable right now. Nothing was charged — try again in a moment.");
  }
}));
