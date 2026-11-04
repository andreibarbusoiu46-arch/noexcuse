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

// ---------------- verification levels ----------------
export type Level = "standard" | "strict" | "elite";
export type EvidenceKind = "live" | "screenshot";

/**
 * What each level asks for. Live photos come only from the in-app camera inside the window;
 * screenshots come from the gallery and are treated as lower-trust, supporting evidence.
 */
export const LEVELS: Record<Level, { live: number; screenshotsRequired: number; screenshotsMax: number; minConfidence: number; label: string }> = {
  standard: { live: 1, screenshotsRequired: 0, screenshotsMax: 0, minConfidence: MIN_CONFIDENCE, label: "Standard" },
  strict: { live: 2, screenshotsRequired: 0, screenshotsMax: 1, minConfidence: 0.7, label: "Strict" },
  elite: { live: 2, screenshotsRequired: 1, screenshotsMax: 2, minConfidence: 0.8, label: "Elite" },
};

export const isLevel = (v: unknown): v is Level => v === "standard" || v === "strict" || v === "elite";

/** Strict and Elite are Premium; without it every proof is judged at Standard. */
export function effectiveLevel(level: unknown, premium: boolean): Level {
  return premium && isLevel(level) ? level : "standard";
}

export function checkEvidence(level: Level, kinds: EvidenceKind[]): { ok: true } | { ok: false; message: string } {
  const r = LEVELS[level];
  const live = kinds.filter((k) => k === "live").length;
  const shots = kinds.filter((k) => k === "screenshot").length;
  if (live !== r.live) {
    return { ok: false, message: `${r.label} verification needs ${r.live} live photo${r.live === 1 ? "" : "s"} (got ${live}).` };
  }
  if (shots < r.screenshotsRequired) {
    return { ok: false, message: `${r.label} verification needs a screenshot from your tracking app or timer.` };
  }
  if (shots > r.screenshotsMax) {
    return { ok: false, message: r.screenshotsMax === 0
      ? `${r.label} verification takes live photos only.`
      : `${r.label} verification takes at most ${r.screenshotsMax} screenshot${r.screenshotsMax === 1 ? "" : "s"}.` };
  }
  return { ok: true };
}

/** Low-confidence calls never cost or earn points: the user is asked for more evidence instead. */
export function finalOutcome(verdict: AiVerdict, confidence: number, level: Level = "standard"): FinalOutcome {
  const c = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0;
  if (verdict === "insufficient") return "insufficient";
  if (c < LEVELS[level].minConfidence) return "insufficient";
  return verdict;
}

/** An appeal overturns a rejection only on a confident "verified" from the second review. */
export const APPEAL_MIN_CONFIDENCE = 0.75;
export function appealOverturns(verdict: AiVerdict, confidence: number, level: Level = "standard"): boolean {
  const c = Number.isFinite(confidence) ? confidence : 0;
  return verdict === "verified" && c >= Math.max(APPEAL_MIN_CONFIDENCE, LEVELS[level].minConfidence);
}

// ---------------- duplicate evidence ----------------
/** Same bytes as earlier evidence → refused. Screenshots this close to an earlier one → refused. */
export const SCREENSHOT_DUP_DISTANCE = 4;
/** Live photos this close to an earlier proof are flagged to the AI (same place every day is normal). */
export const LIVE_FLAG_DISTANCE = 3;

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
