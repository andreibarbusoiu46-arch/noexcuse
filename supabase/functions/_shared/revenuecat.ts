// RevenueCat: the server's source of truth for the `premium` entitlement.
// Never trust a client flag — always ask RevenueCat (secret key) or use webhook-maintained rows.

export const ENTITLEMENT_ID = "premium";

export interface EntitlementState {
  isActive: boolean;
  expiresAt: string | null;
  periodType: string | null; // normal | trial | intro
  productId: string | null;
  store: string | null;
  willRenew: boolean | null;
}

type Sub = {
  subscriber?: {
    entitlements?: Record<string, { expires_date?: string | null; grace_period_expires_date?: string | null; product_identifier?: string }>;
    subscriptions?: Record<string, { period_type?: string; store?: string; unsubscribe_detected_at?: string | null; billing_issues_detected_at?: string | null }>;
  };
};

export function parseSubscriber(json: unknown, now: Date = new Date(), entitlementId = ENTITLEMENT_ID): EntitlementState {
  const s = (json as Sub)?.subscriber;
  const ent = s?.entitlements?.[entitlementId];
  if (!ent) return { isActive: false, expiresAt: null, periodType: null, productId: null, store: null, willRenew: null };
  const expiry = ent.grace_period_expires_date ?? ent.expires_date ?? null;
  const isActive = expiry === null ? true : new Date(expiry).getTime() > now.getTime();
  const sub = ent.product_identifier ? s?.subscriptions?.[ent.product_identifier] : undefined;
  return {
    isActive,
    expiresAt: expiry,
    periodType: sub?.period_type ?? null,
    productId: ent.product_identifier ?? null,
    store: sub?.store ?? null,
    willRenew: sub ? !sub.unsubscribe_detected_at && !sub.billing_issues_detected_at : null,
  };
}

export async function fetchEntitlement(appUserId: string, secretKey: string, fetchImpl: typeof fetch = fetch): Promise<EntitlementState> {
  const res = await fetchImpl(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`, {
    headers: { authorization: `Bearer ${secretKey}`, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`revenuecat http ${res.status}`);
  return parseSubscriber(await res.json());
}

/** Constant-time comparison for the webhook Authorization header. */
export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** App user IDs we care about are Supabase user UUIDs (the app calls Purchases.logIn(userId)). */
export function affectedUserIds(event: { app_user_id?: string; original_app_user_id?: string; aliases?: string[]; transferred_from?: string[]; transferred_to?: string[] }): string[] {
  const all = [event.app_user_id, event.original_app_user_id, ...(event.aliases ?? []), ...(event.transferred_from ?? []), ...(event.transferred_to ?? [])];
  return [...new Set(all.filter((x): x is string => typeof x === "string" && UUID.test(x)))];
}
