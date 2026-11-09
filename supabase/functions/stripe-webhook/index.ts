// Stripe → NoExcuse. Verifies the signature over the raw body, processes each event id once, and
// re-reads the subscription from Stripe before saving (events can arrive late or out of order).
// Deploy with verify_jwt = false: Stripe authenticates with its signature, not a Supabase token.
import { adminClient, json } from "../_shared/http.ts";
import { fetchSnapshot, stripe, stripeKey, verifyStripeSignature } from "../_shared/stripe.ts";

type Obj = Record<string, unknown> & { id?: string; object?: string };
type Event = { id: string; type: string; created: number; livemode: boolean; data: { object: Obj } };

function subscriptionOf(o: Obj): string | null {
  if (o.object === "subscription") return o.id ?? null;
  if (typeof o.subscription === "string") return o.subscription;
  const parent = o.parent as { subscription_details?: { subscription?: string } } | undefined;
  return parent?.subscription_details?.subscription ?? null; // invoices on newer API versions
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const db = adminClient();
  const key = stripeKey();
  const raw = await req.text();
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? ((await db.rpc("stripe_webhook_secret")).data as string | null) ?? "";
  if (!key || !secret) return json(503, { error: "billing_not_configured" });
  if (!(await verifyStripeSignature(raw, req.headers.get("stripe-signature"), secret))) return json(400, { error: "bad_signature" });

  let event: Event;
  try { event = JSON.parse(raw) as Event; } catch { return json(400, { error: "bad_payload" }); }
  if (/^sk_live_|^rk_live_/.test(key) !== event.livemode) return json(200, { ignored: "mode_mismatch" });

  const { data: fresh } = await db.rpc("stripe_claim_event", { p_id: event.id, p_type: event.type });
  if (fresh === false) return json(200, { duplicate: true });

  try {
    const o = event.data.object;
    // Link the customer to the user as soon as Checkout completes (the customer was created with the user id).
    if (event.type === "checkout.session.completed" && typeof o.customer === "string" && typeof o.client_reference_id === "string") {
      await db.from("billing_customers").upsert({ user_id: o.client_reference_id, stripe_customer_id: o.customer }, { onConflict: "user_id", ignoreDuplicates: true });
    }
    const subId = subscriptionOf(o);
    if (subId) {
      const snap = await fetchSnapshot(key, subId, Math.floor(Date.now() / 1000));
      if (!snap.user_id && typeof o.client_reference_id === "string") snap.user_id = o.client_reference_id;
      if (!snap.user_id) {
        const cus = await stripe<{ metadata?: Record<string, string> }>(key, "GET", `/customers/${encodeURIComponent(snap.customer)}`);
        snap.user_id = cus.metadata?.user_id ?? null;
      }
      const { error } = await db.rpc("stripe_upsert_subscription", { p: snap });
      if (error) throw new Error(error.message);
    }
    return json(200, { received: true });
  } catch (e) {
    // Let Stripe retry: forget the event id so the retry is processed.
    await db.from("stripe_events").delete().eq("id", event.id);
    console.error("stripe-webhook", event.type, (e as Error).message);
    return json(500, { error: "processing_failed" });
  }
});
