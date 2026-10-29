// Product rules shared by every server function. Pure — unit tested in rules_test.ts.

export const WINDOW_MINUTES = 15;
/** A proof must be submitted within this many seconds of the camera session being issued. */
export const CAPTURE_MAX_AGE_SECONDS = 180;
/** Below this AI confidence a verified/rejected call becomes "insufficient" (retake, no score). */
export const MIN_CONFIDENCE = 0.6;
export const MAX_VERIFY_ATTEMPTS = 5;
export const STREAK_MILESTONES = [7, 14, 21, 30, 50, 75, 100, 150, 200, 365];

export type WindowState = "early" | "open" | "closed";

export function windowBounds(dueAt: Date) {
  const ms = WINDOW_MINUTES * 60_000;
  return { opensAt: new Date(dueAt.getTime() - ms), closesAt: new Date(dueAt.getTime() + ms) };
}

/** Inclusive on both edges, matching the SQL check in apply_verdict. */
export function classifyWindow(dueAt: Date, at: Date): WindowState {
  const { opensAt, closesAt } = windowBounds(dueAt);
  if (at.getTime() < opensAt.getTime()) return "early";
  if (at.getTime() > closesAt.getTime()) return "closed";
  return "open";
}

export type CaptureCheck =
  | { ok: true }
  | { ok: false; code: "capture_used" | "capture_expired" | "capture_not_found" };

export function checkCaptureSession(
  session: { issued_at: string; expires_at: string; used_at: string | null } | null,
  at: Date,
): CaptureCheck {
  if (!session) return { ok: false, code: "capture_not_found" };
  if (session.used_at) return { ok: false, code: "capture_used" };
  const issued = new Date(session.issued_at).getTime();
  const expires = new Date(session.expires_at).getTime();
  if (at.getTime() > expires || at.getTime() - issued > CAPTURE_MAX_AGE_SECONDS * 1000) {
    return { ok: false, code: "capture_expired" };
  }
  return { ok: true };
}

export type AiVerdict = "verified" | "rejected" | "insufficient";
export type FinalOutcome = "verified" | "rejected" | "insufficient";

/** Low-confidence calls never cost or earn points: the user is asked to retake instead. */
export function finalOutcome(verdict: AiVerdict, confidence: number): FinalOutcome {
  const c = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0;
  if (verdict === "insufficient") return "insufficient";
  if (c < MIN_CONFIDENCE) return "insufficient";
  return verdict;
}

export function isMilestone(streak: number, longest: number): boolean {
  return STREAK_MILESTONES.includes(streak) && streak >= longest;
}

/** JPEG magic number check on base64 input (no decoding of the whole payload). */
export function looksLikeJpegBase64(b64: string): boolean {
  return b64.startsWith("/9j/");
}

export function formatLocalTime(at: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })
      .format(at);
  }
}
