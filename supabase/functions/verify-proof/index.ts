// POST { session_id, image_base64 } → stores the photo, asks the AI, applies the score.
// Response: { verified, critique, outcome, points_delta, streak, total_points, proof_id, ... }
import { decodeBase64 } from "../_shared/b64.ts";
import { adminClient, fail, hasPremium, json, requireUser, withCors } from "../_shared/http.ts";
import { checkCaptureSession, classifyWindow, looksLikeJpegBase64 } from "../_shared/rules.ts";
import { judgeAndApply } from "../_shared/verify.ts";

const MAX_BASE64_CHARS = 6_000_000; // ≈ 4.5 MB JPEG; the app sends ~0.3–0.8 MB

Deno.serve(withCors(async (req) => {
  const receivedAt = new Date(); // the moment that counts for the window
  if (req.method !== "POST") return fail(405, "method_not_allowed", "POST only.");
  const db = adminClient();
  const user = await requireUser(req, db);
  if (user instanceof Response) return user;

  const body = await req.json().catch(() => ({})) as { session_id?: string; image_base64?: string };
  const b64 = body.image_base64?.replace(/^data:image\/jpeg;base64,/, "");
  if (!body.session_id || !b64) return fail(400, "bad_request", "session_id and image_base64 are required.");
  if (b64.length > MAX_BASE64_CHARS) return fail(413, "too_large", "Photo is too large.");
  if (!looksLikeJpegBase64(b64)) return fail(415, "unsupported", "Proof must be a JPEG from the in-app camera.");
  if (!(await hasPremium(db, user.id))) return fail(402, "premium_required", "An active NoExcuse Premium subscription is required.");

  const { data: session } = await db
    .from("capture_sessions")
    .select("id, user_id, target_id, issued_at, expires_at, used_at, target:targets!inner(id, due_at, status)")
    .eq("id", body.session_id)
    .maybeSingle();
  if (!session || session.user_id !== user.id) return fail(404, "capture_not_found", "Capture session not found.");
  const check = checkCaptureSession(session, receivedAt);
  if (!check.ok) {
    return fail(check.code === "capture_used" ? 409 : 410, check.code,
      check.code === "capture_used" ? "This capture was already submitted." : "Capture timed out. Take the photo again.");
  }
  // deno-lint-ignore no-explicit-any
  const target = (session as any).target as { id: string; due_at: string; status: string };
  if (target.status !== "pending") return fail(409, "already_settled", "This target is already settled.");
  const state = classifyWindow(new Date(target.due_at), receivedAt);
  if (state === "early") return fail(425, "window_not_open", "The window hasn’t opened yet.");

  // Claim the session atomically (a second concurrent submit gets nothing back).
  const { data: claimed } = await db
    .from("capture_sessions").update({ used_at: receivedAt.toISOString() })
    .eq("id", session.id).is("used_at", null).select("id");
  if (!claimed?.length) return fail(409, "capture_used", "This capture was already submitted.");

  const proofId = crypto.randomUUID();
  const path = `${user.id}/${target.id}/${proofId}.jpg`;
  const up = await db.storage.from("proofs").upload(path, decodeBase64(b64), { contentType: "image/jpeg", upsert: false });
  if (up.error) return fail(500, "storage_error", "Could not store the photo. Try again.");

  const { error: insErr } = await db.from("proofs").insert({
    id: proofId, user_id: user.id, target_id: target.id, capture_session_id: session.id,
    storage_path: path, received_at: receivedAt.toISOString(),
  });
  if (insErr) return fail(500, "server_error", "Could not record the proof.");

  // Late: no AI call needed — it counts as a missed window.
  if (state === "closed") {
    const critique = "Received after the window closed (±15 min). Late proof doesn’t count.";
    const { data: a, error } = await db.rpc("apply_verdict", {
      p_proof_id: proofId, p_outcome: "expired", p_critique: critique, p_confidence: null, p_model: null, p_raw: null,
    });
    if (error) return fail(500, "server_error", "Could not apply the verdict.");
    return json(200, { proof_id: proofId, outcome: "expired", verified: false, critique, received_at: receivedAt, ...a });
  }

  try {
    const result = await judgeAndApply(db, proofId, b64);
    return json(200, { ...result, received_at: receivedAt });
  } catch (_e) {
    // Proof is stored as "processing"; cron-tick will retry it. No penalty.
    return json(202, { proof_id: proofId, outcome: "error", verified: false, points_delta: 0, received_at: receivedAt,
      critique: "Verification is delayed. Your proof is saved and will be checked automatically. No penalty." });
  }
}));
