// POST (no body) → permanently deletes the caller's account (App Store guideline 5.1.1(v)).
// Removes proof photos from storage, then the auth user; every table cascades from profiles.
import { adminClient, fail, json, requireUser, withCors } from "../_shared/http.ts";

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return fail(405, "method_not_allowed", "POST only.");
  const db = adminClient();
  const user = await requireUser(req, db);
  if (user instanceof Response) return user;

  // Delete stored photos page by page (paths are "<user>/<target>/<proof>.jpg").
  const { data: proofs } = await db.from("proofs").select("storage_path").eq("user_id", user.id);
  const paths = (proofs ?? []).map((p) => p.storage_path as string);
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await db.storage.from("proofs").remove(paths.slice(i, i + 100));
    if (error) return fail(500, "storage_error", "Couldn’t delete stored photos. Try again.");
  }

  const { error } = await db.auth.admin.deleteUser(user.id);
  if (error) return fail(500, "server_error", "Couldn’t delete the account. Try again.");
  return json(200, { deleted: true });
}));
