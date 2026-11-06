// POST { session_id, images: [{ kind: "live" | "screenshot", base64 }] }  (legacy: image_base64)
// → checks the evidence against the commitment's level, refuses reused evidence, stores it,
//   asks the AI, applies the score.
// Response: { verified, critique, outcome, points_delta, streak, total_points, proof_id, requested_evidence, ... }
import type { EngineImage as EvidenceImage } from "../_shared/engine.ts";
import { checkDuplicates, hashEvidence } from "../_shared/evidence.ts";
import { adminClient, fail, hasPremium, json, requireUser, withCors } from "../_shared/http.ts";
import { checkCaptureSession, checkEvidence, classifyWindow, effectiveLevel, looksLikeJpegBase64 } from "../_shared/rules.ts";
import { judgeAndApply } from "../_shared/verify.ts";

const MAX_IMAGE_CHARS = 6_000_000; // ≈ 4.5 MB JPEG each; the app sends ~0.3–0.8 MB
const MAX_TOTAL_CHARS = 12_000_000;
const MAX_IMAGES = 4;

function parseImages(body: { images?: unknown; image_base64?: unknown }): EvidenceImage[] | string {
  const raw = Array.isArray(body.images) ? body.images
    : typeof body.image_base64 === "string" ? [{ kind: "live", base64: body.image_base64 }] : null;
  if (!raw || raw.length === 0) return "images are required.";
  if (raw.length > MAX_IMAGES) return `At most ${MAX_IMAGES} images.`;
  const out: EvidenceImage[] = [];
  for (const r of raw as Array<{ kind?: unknown; base64?: unknown }>) {
    if ((r.kind !== "live" && r.kind !== "screenshot") || typeof r.base64 !== "string") return "Each image needs a kind (live or screenshot) and base64 data.";
    out.push({ kind: r.kind, base64: r.base64.replace(/^data:image\/jpeg;base64,/, "") });
  }
  // Live photos first, in the order taken; screenshots after.
  return [...out.filter((i) => i.kind === "live"), ...out.filter((i) => i.kind === "screenshot")];
}

Deno.serve(withCors(async (req) => {
  const receivedAt = new Date(); // the moment that counts for the window
  if (req.method !== "POST") return fail(405, "method_not_allowed", "POST only.");
  const db = adminClient();
  const user = await requireUser(req, db);
  if (user instanceof Response) return user;

  const body = await req.json().catch(() => ({})) as { session_id?: string; images?: unknown; image_base64?: unknown };
  if (!body.session_id) return fail(400, "bad_request", "session_id is required.");
  const images = parseImages(body);
  if (typeof images === "string") return fail(400, "bad_request", images);
  if (images.some((i) => i.base64.length > MAX_IMAGE_CHARS) || images.reduce((n, i) => n + i.base64.length, 0) > MAX_TOTAL_CHARS) {
    return fail(413, "too_large", "Evidence is too large.");
  }
  if (images.some((i) => !looksLikeJpegBase64(i.base64))) return fail(415, "unsupported", "Evidence must be JPEG images.");
  // Free accounts are judged at Standard; Strict/Elite need an active Premium entitlement.
  const premium = await hasPremium(db, user.id);

  const { data: session } = await db
    .from("capture_sessions")
    .select("id, user_id, target_id, issued_at, expires_at, used_at, target:targets!inner(id, due_at, status, habit:habits!inner(verification_level))")
    .eq("id", body.session_id)
    .maybeSingle();
  if (!session || session.user_id !== user.id) return fail(404, "capture_not_found", "Capture session not found.");
  const check = checkCaptureSession(session, receivedAt);
  if (!check.ok) {
    return fail(check.code === "capture_used" ? 409 : 410, check.code,
      check.code === "capture_used" ? "This capture was already submitted." : "Capture timed out. Take the photo again.");
  }
  // deno-lint-ignore no-explicit-any
  const target = (session as any).target as { id: string; due_at: string; status: string; habit: { verification_level: string } };
  if (target.status !== "pending") return fail(409, "already_settled", "This target is already settled.");
  const state = classifyWindow(new Date(target.due_at), receivedAt);
  if (state === "early") return fail(425, "window_not_open", "The window hasn’t opened yet.");

  // Cost control: attempts per target and AI analyses per user per day (checked before any work).
  const { data: limit } = await db.rpc("ai_limits_check", { p_user: user.id, p_target: target.id });
  if (limit === "target_attempts") return fail(429, "target_attempts", "You’ve used every submission for this target.");
  if (limit === "daily_limit") return fail(429, "verify_daily_limit", "You’ve reached the limit of AI analyses for the last 24 hours. Try again later.");

  const level = effectiveLevel(target.habit.verification_level, premium);
  const ev = checkEvidence(level, images.map((i) => i.kind));
  if (!ev.ok) return fail(422, "evidence_incomplete", ev.message);

  // Fingerprint everything and refuse evidence that was already used — before the session is spent,
  // so the user can still capture something new.
  const hashed = await hashEvidence(images);
  // A file that only starts like a JPEG but can't be decoded is refused before anything is stored.
  if (hashed.some((h) => h.dhash === null)) return fail(415, "unsupported", "Evidence must be valid JPEG images.");
  const dup = await checkDuplicates(db, user.id, target.id, hashed);
  if (!dup.ok) return fail(409, "duplicate_evidence", dup.message);

  // Claim the session atomically (a second concurrent submit gets nothing back).
  const { data: claimed } = await db
    .from("capture_sessions").update({ used_at: receivedAt.toISOString() })
    .eq("id", session.id).is("used_at", null).select("id");
  if (!claimed?.length) return fail(409, "capture_used", "This capture was already submitted.");

  const proofId = crypto.randomUUID();
  const paths = hashed.map((_h, i) => `${user.id}/${target.id}/${proofId}${i === 0 ? "" : `-${i}`}.jpg`);
  for (let i = 0; i < hashed.length; i++) {
    const up = await db.storage.from("proofs").upload(paths[i], hashed[i].bytes, { contentType: "image/jpeg", upsert: false });
    if (up.error) return fail(500, "storage_error", "Could not store the evidence. Try again.");
  }

  const { error: insErr } = await db.from("proofs").insert({
    id: proofId, user_id: user.id, target_id: target.id, capture_session_id: session.id,
    storage_path: paths[0], received_at: receivedAt.toISOString(), level,
  });
  if (insErr) return fail(500, "server_error", "Could not record the proof.");
  const { error: itemsErr } = await db.from("proof_items").insert(hashed.map((h, i) => ({
    proof_id: proofId, user_id: user.id, kind: h.kind, position: i, storage_path: paths[i], sha256: h.sha256, dhash: h.dhash,
  })));
  if (itemsErr) return fail(500, "server_error", "Could not record the evidence.");

  const { data: prof } = await db.from("profiles").select("language").eq("id", user.id).maybeSingle();
  const ro = prof?.language === "ro";

  // Late: no AI call needed — it counts as a missed window.
  if (state === "closed") {
    const critique = ro
      ? "Primită după ce fereastra s-a închis (±15 min). Dovada întârziată nu contează."
      : "Received after the window closed (±15 min). Late proof doesn’t count.";
    const { data: a, error } = await db.rpc("apply_verdict", {
      p_proof_id: proofId, p_outcome: "expired", p_critique: critique, p_confidence: null, p_model: null, p_raw: null,
    });
    if (error) return fail(500, "server_error", "Could not apply the verdict.");
    return json(200, { proof_id: proofId, outcome: "expired", verified: false, critique, received_at: receivedAt, level, requested_evidence: null, analysis: null, ...a });
  }

  try {
    const result = await judgeAndApply(db, proofId, images, dup.notes);
    return json(200, { ...result, received_at: receivedAt });
  } catch (_e) {
    // Proof is stored as "processing"; cron-tick will retry it. No penalty.
    return json(202, { proof_id: proofId, outcome: "error", verified: false, points_delta: 0, received_at: receivedAt, level, requested_evidence: null, analysis: null,
      critique: ro
        ? "Verificarea întârzie. Dovada ta e salvată și nu se scade nimic. Reîncercăm curând; dacă tot nu poate fi verificată, obiectivul e scuzat."
        : "Verification is delayed. Your proof is saved and nothing is deducted. We’ll retry shortly; if it still can’t be checked, this target is excused." });
  }
}));
