// POST (no body) → permanently deletes the caller's account (App Store guideline 5.1.1(v)).
// Removes proof photos from storage, then the auth user; every table cascades from profiles.
import { adminClient, fail, json, requireUser, withCors } from "../_shared/http.ts";
import { stripe, stripeKey } from "../_shared/stripe.ts";

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return fail(405, "method_not_allowed", "POST only.");
  const db = adminClient();
  const user = await requireUser(req, db);
  if (user instanceof Response) return user;

  // A web subscription must stop before the account goes, or Stripe would keep charging a deleted user.
  const { data: billing } = await db.from("billing_customers").select("stripe_customer_id").eq("user_id", user.id).maybeSingle();
  if (billing) {
    const { count } = await db.from("stripe_subscriptions").select("subscription_id", { count: "exact", head: true })
      .eq("user_id", user.id).not("status", "in", "(canceled,incomplete_expired)");
    const key = stripeKey();
    if (count && !key) return fail(503, "billing_unavailable", "Your subscription couldn’t be cancelled right now, so the account wasn’t deleted. Try again later.");
    if (key) {
      try {
        const subs = await stripe<{ data: { id: string; status: string }[] }>(key, "GET", "/subscriptions", { customer: billing.stripe_customer_id, status: "all", limit: 20 });
        for (const s of subs.data) if (!["canceled", "incomplete_expired"].includes(s.status)) await stripe(key, "DELETE", `/subscriptions/${s.id}`);
      } catch {
        return fail(502, "billing_unavailable", "Your subscription couldn’t be cancelled right now, so the account wasn’t deleted. Try again in a moment.");
      }
    }
  }

  // Profile photo (avatars/<user>/…).
  const { data: avatars } = await db.storage.from("avatars").list(user.id);
  if (avatars?.length) await db.storage.from("avatars").remove(avatars.map((f) => `${user.id}/${f.name}`));

  // Delete stored photos page by page (paths are "<user>/<target>/<proof>.jpg").
  // Multi-photo proofs keep their extra photos in proof_items.
  const [{ data: proofs }, { data: items }] = await Promise.all([
    db.from("proofs").select("storage_path").eq("user_id", user.id),
    db.from("proof_items").select("storage_path").eq("user_id", user.id),
  ]);
  const paths = [...new Set([...(proofs ?? []), ...(items ?? [])].map((p) => p.storage_path as string))];
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await db.storage.from("proofs").remove(paths.slice(i, i + 100));
    if (error) return fail(500, "storage_error", "Couldn’t delete stored photos. Try again.");
  }

  const { error } = await db.auth.admin.deleteUser(user.id);
  if (error) return fail(500, "server_error", "Couldn’t delete the account. Try again.");
  return json(200, { deleted: true });
}));
