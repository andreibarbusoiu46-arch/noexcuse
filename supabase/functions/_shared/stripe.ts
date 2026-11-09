// Stripe over its REST API (no SDK): form-encoded requests, webhook signature checks, subscription snapshots.
// Secrets only come from the function environment (STRIPE_SECRET_KEY) or the Vault (webhook secret).
import { safeEqual } from "./revenuecat.ts";

export const PRICE_LOOKUP_KEY = "noexcuse_premium_monthly";
export const TRIAL_DAYS = 3;
export const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "customer.subscription.trial_will_end",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
];

export class StripeError extends Error {
  constructor(public status: number, public code: string | null, message: string) { super(message); }
}

/** Flattens { a: { b: [x] } } into a=…&a[b][0]=x, the encoding Stripe expects. */
export function formEncode(obj: Record<string, unknown>, prefix = ""): string {
  const out: string[] = [];
  const add = (k: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((x, i) => add(`${k}[${i}]`, x));
    else if (typeof v === "object") for (const [kk, vv] of Object.entries(v as Record<string, unknown>)) add(`${k}[${kk}]`, vv);
    else out.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  };
  for (const [k, v] of Object.entries(obj)) add(prefix ? `${prefix}[${k}]` : k, v);
  return out.join("&");
}

/**
 * The Stripe key, or null when payments must stay off. Live keys (real money) are refused unless the owner
 * has explicitly approved going live by setting STRIPE_LIVE_APPROVED=true; until then only test keys work.
 */
export function stripeKey(env: (n: string) => string | undefined = (n) => Deno.env.get(n)): string | null {
  const k = env("STRIPE_SECRET_KEY")?.trim();
  if (!k || !/^(sk|rk)_(test|live)_/.test(k)) return null;
  if (/^(sk|rk)_live_/.test(k) && env("STRIPE_LIVE_APPROVED") !== "true") return null;
  return k;
}
export const liveKeyBlocked = (env: (n: string) => string | undefined = (n) => Deno.env.get(n)) =>
  /^(sk|rk)_live_/.test(env("STRIPE_SECRET_KEY")?.trim() ?? "") && env("STRIPE_LIVE_APPROVED") !== "true";
export const isLiveKey = (k: string) => /^(sk|rk)_live_/.test(k);

export async function stripe<T = Record<string, unknown>>(
  key: string, method: "GET" | "POST" | "DELETE", path: string, params?: Record<string, unknown>,
  opts: { idempotencyKey?: string; fetchImpl?: typeof fetch } = {},
): Promise<T> {
  const qs = params && method !== "POST" ? `?${formEncode(params)}` : "";
  const headers: Record<string, string> = { authorization: `Bearer ${key}` };
  if (method === "POST") headers["content-type"] = "application/x-www-form-urlencoded";
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  const r = await (opts.fetchImpl ?? fetch)(`https://api.stripe.com/v1${path}${qs}`, {
    method, headers, body: method === "POST" && params ? formEncode(params) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const body = await r.json().catch(() => null) as { error?: { code?: string; message?: string; type?: string } } | null;
  if (!r.ok) throw new StripeError(r.status, body?.error?.code ?? body?.error?.type ?? null, body?.error?.message ?? `stripe http ${r.status}`);
  return body as T;
}

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Verifies a Stripe-Signature header (t=…,v1=…) over the raw body with HMAC-SHA256.
 * Rejects stale timestamps (default 5 minutes) to stop replays.
 */
export async function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("=") as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || !sigs.length || Math.abs(nowSec - t) > toleranceSec) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${rawBody}`)));
  return sigs.some((s) => safeEqual(s, expected));
}

type Sub = {
  id: string; customer: string; status: string; trial_start?: number | null; trial_end?: number | null;
  current_period_start?: number; current_period_end?: number; cancel_at_period_end?: boolean; cancel_at?: number | null;
  canceled_at?: number | null; ended_at?: number | null; metadata?: Record<string, string>;
  items?: { data?: { price?: { id?: string }; current_period_start?: number; current_period_end?: number }[] };
  latest_invoice?: string | { status?: string } | null;
};

/** The fields we store. Newer API versions moved the billing period onto the subscription item. */
export function snapshot(sub: Sub, eventCreated: number) {
  const item = sub.items?.data?.[0];
  return {
    id: sub.id, customer: sub.customer, status: sub.status, price_id: item?.price?.id ?? null,
    trial_start: sub.trial_start ?? null, trial_end: sub.trial_end ?? null,
    current_period_start: sub.current_period_start ?? item?.current_period_start ?? null,
    current_period_end: sub.current_period_end ?? item?.current_period_end ?? null,
    cancel_at_period_end: !!sub.cancel_at_period_end, cancel_at: sub.cancel_at ?? null,
    canceled_at: sub.canceled_at ?? null, ended_at: sub.ended_at ?? null,
    latest_invoice_status: typeof sub.latest_invoice === "object" && sub.latest_invoice ? sub.latest_invoice.status ?? null : null,
    user_id: sub.metadata?.user_id ?? null,
    event_created: eventCreated,
  };
}

/** Fetches the subscription fresh from Stripe (events can arrive out of order) and returns the snapshot. */
export async function fetchSnapshot(key: string, subscriptionId: string, eventCreated: number) {
  const sub = await stripe<Sub>(key, "GET", `/subscriptions/${encodeURIComponent(subscriptionId)}`, { expand: ["latest_invoice"] });
  return snapshot(sub, eventCreated);
}
