// POST { proof_id, note? } → files the one appeal allowed for a rejected proof and runs the
// independent AI re-review. Premium. If the AI is unavailable the appeal stays pending and
// cron-tick retries it.
import { runAppealReview } from "../_shared/appeal.ts";
import { adminClient, fail, hasPremium, json, requireUser, withCors } from "../_shared/http.ts";

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return fail(405, "method_not_allowed", "POST only.");
  const db = adminClient();
  const user = await requireUser(req, db);
  if (user instanceof Response) return user;
  const body = await req.json().catch(() => ({})) as { proof_id?: string; note?: unknown };
  if (!body.proof_id) return fail(400, "bad_request", "proof_id is required.");
  const note = typeof body.note === "string" ? body.note.slice(0, 500) : null;
  if (!(await hasPremium(db, user.id))) return fail(402, "premium_required", "Appeals are part of NoExcuse Premium.");

  const { data: appealId, error } = await db.rpc("open_appeal", { p_user: user.id, p_proof: body.proof_id, p_note: note });
  if (error) {
    const m = error.message ?? "";
    if (m.includes("not found")) return fail(404, "not_found", "Proof not found.");
    if (m.includes("already been appealed")) return fail(409, "already_appealed", "This target has already been appealed. Each rejection gets one appeal.");
    if (m.includes("window has closed")) return fail(410, "appeal_window_closed", "Appeals must be filed within 48 hours of the verdict.");
    if (m.includes("only a rejected")) return fail(409, "not_appealable", "Only a rejected proof can be appealed.");
    return fail(500, "server_error", "Could not file the appeal.");
  }
  const r = await runAppealReview(db, appealId as string, false);
  return json(r.status === "pending" ? 202 : 200, {
    ...r,
    critique: r.status === "pending"
      ? "Your appeal is filed. The review is delayed — we’ll retry shortly and notify you of the decision."
      : r.status === "unavailable" ? "The review couldn’t run, so the original verdict stands." : r.critique,
  });
}));
