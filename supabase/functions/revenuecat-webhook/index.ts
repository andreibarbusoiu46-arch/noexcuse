// RevenueCat → server entitlement sync. Configure the webhook's Authorization header
// in the RevenueCat dashboard to exactly the REVENUECAT_WEBHOOK_AUTH secret.
// Every event re-reads the subscriber from RevenueCat, so ordering/duplicates don't matter.
import { adminClient, env, fail, json, upsertEntitlement } from "../_shared/http.ts";
import { affectedUserIds, fetchEntitlement, safeEqual } from "../_shared/revenuecat.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return fail(405, "method_not_allowed", "POST only.");
  if (!safeEqual(req.headers.get("authorization") ?? "", env("REVENUECAT_WEBHOOK_AUTH"))) {
    return fail(401, "unauthorized", "Bad webhook authorization.");
  }
  const payload = await req.json().catch(() => null) as { event?: { id?: string; type?: string; app_user_id?: string } & Record<string, unknown> } | null;
  const event = payload?.event;
  if (!event?.id || !event.type) return fail(400, "bad_request", "Missing event.");

  const db = adminClient();
  const { data: fresh } = await db.from("revenuecat_events")
    .upsert({ id: event.id, type: event.type, app_user_id: event.app_user_id ?? null, payload }, { onConflict: "id", ignoreDuplicates: true })
    .select("id");
  if (!fresh?.length) return json(200, { ok: true, duplicate: true });

  const users = affectedUserIds(event as Parameters<typeof affectedUserIds>[0]);
  const secret = env("REVENUECAT_SECRET_KEY");
  for (const uid of users) {
    const { data: profile } = await db.from("profiles").select("id").eq("id", uid).maybeSingle();
    if (!profile) continue; // anonymous RevenueCat IDs or deleted users
    await upsertEntitlement(db, uid, await fetchEntitlement(uid, secret));
  }
  return json(200, { ok: true, users: users.length });
});
