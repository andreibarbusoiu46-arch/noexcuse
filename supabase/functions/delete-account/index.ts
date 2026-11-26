// POST (no body) → permanently deletes the caller's account (App Store guideline 5.1.1(v)).
// Cancels web subscriptions, removes every stored photo, then the auth user; every table cascades from profiles.
import { adminClient, fail, json, requireUser, withCors } from "../_shared/http.ts";
import { type PathRow, purgeAccountStorage } from "../_shared/accountPurge.ts";
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
        // Every page of the customer's subscriptions, not just the first 20.
        let startingAfter: string | undefined;
        for (let page = 0; page < 50; page++) {
          const subs: { data: { id: string; status: string }[]; has_more: boolean } = await stripe(key, "GET", "/subscriptions",
            { customer: billing.stripe_customer_id, status: "all", limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
          for (const s of subs.data) if (!["canceled", "incomplete_expired"].includes(s.status)) await stripe(key, "DELETE", `/subscriptions/${s.id}`);
          if (!subs.has_more || subs.data.length === 0) break;
          startingAfter = subs.data[subs.data.length - 1].id;
          if (page === 49) throw new Error("too many subscriptions");
        }
      } catch {
        return fail(502, "billing_unavailable", "Your subscription couldn’t be cancelled right now, so the account wasn’t deleted. Try again in a moment.");
      }
    }
  }

  // Every stored file goes before the account: proof photos (proofs + proof_items, cursor-paged by id) and the
  // profile photo folder. If any listing or removal fails, the account is NOT deleted (see _shared/accountPurge.ts);
  // asking again is safe and finishes the job.
  const purge = await purgeAccountStorage({
    paths: async (table, after, limit) => {
      let q = db.from(table).select("id, storage_path").eq("user_id", user.id).order("id").limit(limit);
      if (after) q = q.gt("id", after);
      const { data, error } = await q;
      return error ? { error: error.message } : { rows: (data ?? []) as PathRow[] };
    },
    avatars: async (offset, limit) => {
      const { data, error } = await db.storage.from("avatars").list(user.id, { limit, offset, sortBy: { column: "name", order: "asc" } });
      return error ? { error: error.message } : { names: (data ?? []).map((f) => f.name) };
    },
    remove: async (bucket, paths) => (await db.storage.from(bucket).remove(paths)).error?.message ?? null,
  }, { userId: user.id });
  if (purge.status === "failed") {
    console.error("delete-account storage", purge.step, purge.detail, "removed", purge.removed);
    const listing = purge.step.startsWith("list") || purge.step === "limit" || purge.step === "cursor";
    return fail(500, listing ? "server_error" : "storage_error", listing
      ? "Couldn’t list your photos, so the account wasn’t deleted. Try again."
      : "Couldn’t delete every stored photo, so the account wasn’t deleted. Try again — photos already removed stay removed.");
  }

  const { error } = await db.auth.admin.deleteUser(user.id);
  if (error) return fail(500, "server_error", "Couldn’t delete the account. Try again.");
  return json(200, { deleted: true });
}));
