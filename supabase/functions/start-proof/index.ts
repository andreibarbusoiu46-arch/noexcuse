// POST { target_id } → issues a short-lived capture session when the in-app camera opens.
// Proof can only be submitted against a fresh session (≤ 3 min), inside the target's window.
import { adminClient, fail, hasPremium, json, requireUser, withCors } from "../_shared/http.ts";
import { CAPTURE_MAX_AGE_SECONDS, classifyWindow, windowBounds } from "../_shared/rules.ts";

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return fail(405, "method_not_allowed", "POST only.");
  const db = adminClient();
  const user = await requireUser(req, db);
  if (user instanceof Response) return user;

  const body = await req.json().catch(() => ({})) as { target_id?: string };
  if (!body.target_id) return fail(400, "bad_request", "target_id is required.");
  if (!(await hasPremium(db, user.id))) return fail(402, "premium_required", "An active NoExcuse Premium subscription is required.");

  const { data: target } = await db.from("targets").select("id, user_id, due_at, status").eq("id", body.target_id).maybeSingle();
  if (!target || target.user_id !== user.id) return fail(404, "not_found", "Target not found.");
  if (target.status !== "pending") return fail(409, "already_settled", "This target is already settled.");

  const now = new Date();
  const due = new Date(target.due_at);
  const state = classifyWindow(due, now);
  const { opensAt, closesAt } = windowBounds(due);
  if (state === "early") return fail(425, "window_not_open", `The window opens at ${opensAt.toISOString()}.`);
  if (state === "closed") return fail(410, "window_closed", "The window has closed.");

  const expiresAt = new Date(Math.min(now.getTime() + CAPTURE_MAX_AGE_SECONDS * 1000, closesAt.getTime() + 60_000));
  const { data: session, error } = await db
    .from("capture_sessions")
    .insert({ user_id: user.id, target_id: target.id, issued_at: now.toISOString(), expires_at: expiresAt.toISOString() })
    .select("id, expires_at")
    .single();
  if (error) return fail(500, "server_error", "Could not start capture.");

  return json(200, { session_id: session.id, expires_at: session.expires_at, window_opens_at: opensAt, window_closes_at: closesAt, server_time: now });
}));
