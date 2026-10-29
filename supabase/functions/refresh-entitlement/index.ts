// POST (no body) → re-reads the caller's entitlement from RevenueCat and returns it.
// The app calls this right after a purchase or restore so the server agrees immediately.
import { adminClient, env, fail, json, requireUser, upsertEntitlement, withCors } from "../_shared/http.ts";
import { fetchEntitlement } from "../_shared/revenuecat.ts";

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return fail(405, "method_not_allowed", "POST only.");
  const db = adminClient();
  const user = await requireUser(req, db);
  if (user instanceof Response) return user;
  try {
    const ent = await fetchEntitlement(user.id, env("REVENUECAT_SECRET_KEY"));
    await upsertEntitlement(db, user.id, ent);
    return json(200, { premium: ent.isActive, expires_at: ent.expiresAt, period_type: ent.periodType, will_renew: ent.willRenew });
  } catch {
    return fail(502, "revenuecat_unavailable", "Couldn’t reach the subscription service. Try again.");
  }
}));
