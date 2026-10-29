import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { fetchEntitlement } from "./revenuecat.ts";

// Browsers (the web build) call these functions cross-origin, so every response carries CORS headers.
// Auth is by bearer token, never cookies, so a wildcard origin is safe here.
export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-max-age": "86400",
};

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS_HEADERS } });
}

/** Answers CORS preflight and makes sure every response (even an unexpected one) has CORS headers. */
export function withCors(handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    let res: Response;
    try {
      res = await handler(req);
    } catch (_e) {
      return json(500, { error: "server_error", message: "Something went wrong. Try again." });
    }
    for (const [k, v] of Object.entries(CORS_HEADERS)) if (!res.headers.has(k)) res.headers.set(k, v);
    return res;
  };
}
export const fail = (status: number, code: string, message: string) => json(status, { error: code, message });

export function env(name: string, fallback?: string): string {
  const v = Deno.env.get(name) ?? fallback;
  if (v === undefined) throw new Error(`missing env ${name}`);
  return v;
}

/** Service-role client: bypasses RLS. Only ever used inside functions. */
export function adminClient(): SupabaseClient {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
}

/** Resolves the caller from their Supabase JWT. */
export async function requireUser(req: Request, db: SupabaseClient): Promise<{ id: string } | Response> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return fail(401, "unauthorized", "Sign in required.");
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return fail(401, "unauthorized", "Session expired. Sign in again.");
  return { id: data.user.id };
}

/**
 * Server-side entitlement check. Uses the webhook-maintained row; if it says "no",
 * asks RevenueCat directly once (covers the seconds right after a purchase).
 */
export async function hasPremium(db: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await db.rpc("has_premium", { p_user: userId });
  if (data === true) return true;
  const secret = Deno.env.get("REVENUECAT_SECRET_KEY");
  if (!secret) return false;
  try {
    const ent = await fetchEntitlement(userId, secret);
    await upsertEntitlement(db, userId, ent);
    return ent.isActive;
  } catch {
    return false;
  }
}

export async function upsertEntitlement(
  db: SupabaseClient,
  userId: string,
  e: { isActive: boolean; expiresAt: string | null; periodType: string | null; productId: string | null; store: string | null; willRenew: boolean | null },
) {
  await db.from("entitlements").upsert({
    user_id: userId,
    entitlement: "premium",
    is_active: e.isActive,
    expires_at: e.expiresAt,
    period_type: e.periodType,
    product_id: e.productId,
    store: e.store,
    will_renew: e.willRenew,
    updated_at: new Date().toISOString(),
  });
}
