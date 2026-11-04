// POST { action: "delete_evidence" } → deletes the caller's evidence photos from storage.
// Results, points and verdicts stay. Photos the system still needs are kept and counted:
// a verification still running, a pending appeal, or a rejection inside its appeal window.
import { adminClient, fail, json, requireUser, withCors } from "../_shared/http.ts";

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return fail(405, "method_not_allowed", "POST only.");
  const db = adminClient();
  const user = await requireUser(req, db);
  if (user instanceof Response) return user;
  const body = await req.json().catch(() => ({})) as { action?: string };
  if (body.action !== "delete_evidence") return fail(400, "bad_request", "Unknown action.");

  const { data, error } = await db.rpc("evidence_for_user_deletion", { p_user: user.id });
  if (error) return fail(500, "server_error", "Couldn’t read your evidence. Try again.");
  const rows = (data ?? []) as Array<{ proof_id: string; paths: string[]; kept: boolean }>;
  const go = rows.filter((r) => !r.kept);
  let deleted = 0;
  for (let i = 0; i < go.length; i += 100) {
    const batch = go.slice(i, i + 100);
    const { error: e } = await db.storage.from("proofs").remove(batch.flatMap((r) => r.paths));
    if (e) return fail(500, "storage_error", "Couldn’t delete every photo. Try again.");
    const { data: n } = await db.rpc("mark_evidence_deleted", { p_proofs: batch.map((r) => r.proof_id) });
    deleted += (n as number) ?? 0;
  }
  await db.rpc("audit", { p_user: user.id, p_action: "evidence_deleted", p_ref: null, p_data: { deleted, kept: rows.length - go.length } })
    .then(() => null, () => null);
  return json(200, { deleted, kept: rows.length - go.length });
}));
