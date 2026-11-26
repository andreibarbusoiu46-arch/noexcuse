// POST { action: "delete_commitment", habit_id } → permanently deletes one of the caller's commitments:
// its photos leave storage first, then the database erases it (see public.delete_commitment).
// POST { action: "delete_evidence" } → deletes the caller's evidence photos from storage. 200 only when every
// deletable photo is gone; otherwise 409 (safety limit, call again) or 500 (a step failed), with counts so far.
// Results, points and verdicts stay. Photos the system still needs are kept and counted:
// a verification still running, a pending appeal, or a rejection inside its appeal window.
import { type EvidenceRow, purgeEvidence } from "../_shared/evidencePurge.ts";
import { adminClient, fail, json, requireUser, withCors } from "../_shared/http.ts";

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return fail(405, "method_not_allowed", "POST only.");
  const db = adminClient();
  const user = await requireUser(req, db);
  if (user instanceof Response) return user;
  const body = await req.json().catch(() => ({})) as { action?: string; habit_id?: string };
  if (body.action === "delete_commitment") return deleteCommitment(db, user.id, body.habit_id);
  if (body.action !== "delete_evidence") return fail(400, "bad_request", "Unknown action.");

  // Every undeleted proof of the caller is read page by page (cursor on proof id), so photos that must be
  // kept never stop the run; see _shared/evidencePurge.ts. Success is reported only when nothing is left.
  const outcome = await purgeEvidence({
    page: async (after, limit) => {
      const { data, error } = await db.rpc("evidence_for_user_deletion_page", { p_user: user.id, p_after: after, p_limit: limit });
      return error ? { error: error.message } : { rows: (data ?? []) as EvidenceRow[] };
    },
    remove: async (paths) => (await db.storage.from("proofs").remove(paths)).error?.message ?? null,
    mark: async (ids) => {
      const { data, error } = await db.rpc("mark_evidence_deleted", { p_proofs: ids });
      return error ? { error: error.message } : { count: (data as number) ?? 0 };
    },
  }, { pathPrefix: `${user.id}/` });

  const { deleted, kept } = outcome;
  await db.rpc("audit", { p_user: user.id, p_action: "evidence_deleted",
    p_ref: null, p_data: { deleted, kept, status: outcome.status, ...(outcome.status === "incomplete" ? { reason: outcome.reason } : {}) } })
    .then(() => null, () => null);
  if (outcome.status === "complete") return json(200, { deleted, kept, complete: true });
  if (outcome.reason === "limit") {
    return json(409, { error: "delete_incomplete", complete: false, deleted, kept,
      message: `${deleted} photos were deleted, but more remain. Tap Delete again to continue.` });
  }
  console.error("privacy delete_evidence incomplete", outcome.reason, outcome.detail);
  return json(500, { error: "delete_incomplete", complete: false, deleted, kept,
    message: `Not every photo could be deleted (${deleted} were). Try again: photos already deleted stay deleted.` });
}));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFUSED: Record<string, [number, string]> = {
  not_found: [404, "Commitment not found."],
  window_open: [409, "A proof window is open or waiting to be settled. Try again after it closes."],
  busy: [409, "A verification or appeal is still running for this commitment. Try again when it finishes."],
  in_challenge: [409, "This commitment is part of an active challenge. Abandon the challenge first."],
};

async function deleteCommitment(db: ReturnType<typeof adminClient>, userId: string, habitId: unknown): Promise<Response> {
  if (typeof habitId !== "string" || !UUID.test(habitId)) return fail(400, "bad_request", "Missing commitment.");
  const { data: check, error } = await db.rpc("commitment_deletion_check", { p_user: userId, p_habit: habitId });
  if (error) return fail(500, "server_error", "Couldn’t delete the commitment. Try again.");
  const c = check as { error: string | null; paths?: string[] };
  if (c.error) {
    const [status, message] = REFUSED[c.error] ?? [409, "This commitment can’t be deleted right now."];
    return fail(status, c.error === "not_found" ? "not_found" : `delete_${c.error}`, message);
  }
  const paths = (c.paths ?? []).filter((p) => typeof p === "string" && p.startsWith(`${userId}/`));
  for (let i = 0; i < paths.length; i += 100) {
    const { error: e } = await db.storage.from("proofs").remove(paths.slice(i, i + 100));
    if (e) return fail(500, "storage_error", "Couldn’t delete every photo. The commitment wasn’t deleted — try again.");
  }
  const { data: mode, error: e2 } = await db.rpc("delete_commitment", { p_user: userId, p_habit: habitId });
  if (e2) {
    const code = /window_open|busy|in_challenge/.exec(e2.message)?.[0];
    if (code) return fail(409, `delete_${code}`, REFUSED[code][1]);
    return fail(500, "server_error", "Couldn’t delete the commitment. Try again.");
  }
  return json(200, { mode, photos_deleted: paths.length });
}
