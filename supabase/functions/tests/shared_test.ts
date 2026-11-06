// deno test --allow-env supabase/functions/tests
import nodeAssert from "node:assert/strict";
const assert = (v: unknown, msg = "assertion failed") => nodeAssert.ok(v, msg);
const assertEquals = (a: unknown, b: unknown) => nodeAssert.deepStrictEqual(a, b);
function assertThrows(fn: () => unknown, Cls?: new (...a: never[]) => Error): Error {
  try { fn(); } catch (e) { if (Cls) nodeAssert.ok(e instanceof Cls, "wrong error type"); return e as Error; }
  throw new Error("expected throw");
}
async function assertRejects(fn: () => Promise<unknown>, Cls?: new (...a: never[]) => Error): Promise<Error> {
  try { await fn(); } catch (e) { if (Cls) nodeAssert.ok(e instanceof Cls, "wrong error type"); return e as Error; }
  throw new Error("expected rejection");
}
import { appealOverturns, checkCaptureSession, checkEvidence, classifyWindow, effectiveLevel, finalOutcome, formatLocalTime, isMilestone, looksLikeJpegBase64 } from "../_shared/rules.ts";
import { judgeDuplicates } from "../_shared/evidence.ts";
import { type Plan, validatePlan } from "../_shared/challengeai.ts";
import { dhashFromJpeg, dhashFromRgba, hammingHex, sha256Hex } from "../_shared/dhash.ts";
import jpeg from "npm:jpeg-js@0.4.4";
import { affectedUserIds, fetchEntitlement, parseSubscriber, safeEqual } from "../_shared/revenuecat.ts";
import { decodeBase64, encodeBase64 } from "../_shared/b64.ts";
import { ACHIEVEMENT_RO, copy, notifyOnce } from "../_shared/push.ts";

const due = new Date("2026-10-21T04:00:00Z"); // 07:00 Bucharest

Deno.test("window is ±15 min, inclusive at both edges", () => {
  assertEquals(classifyWindow(due, new Date("2026-10-21T03:44:59Z")), "early");
  assertEquals(classifyWindow(due, new Date("2026-10-21T03:45:00Z")), "open");
  assertEquals(classifyWindow(due, new Date("2026-10-21T04:15:00Z")), "open");
  assertEquals(classifyWindow(due, new Date("2026-10-21T04:15:00.001Z")), "closed");
});

Deno.test("capture session must be fresh and unused", () => {
  const issued = "2026-10-21T04:00:00Z", exp = "2026-10-21T04:03:00Z";
  assertEquals(checkCaptureSession({ issued_at: issued, expires_at: exp, used_at: null }, new Date("2026-10-21T04:02:59Z")), { ok: true });
  assertEquals(checkCaptureSession({ issued_at: issued, expires_at: exp, used_at: null }, new Date("2026-10-21T04:03:01Z")), { ok: false, code: "capture_expired" });
  assertEquals(checkCaptureSession({ issued_at: issued, expires_at: exp, used_at: issued }, new Date(issued)), { ok: false, code: "capture_used" });
  assertEquals(checkCaptureSession(null, new Date()), { ok: false, code: "capture_not_found" });
});

Deno.test("low confidence never scores", () => {
  assertEquals(finalOutcome("verified", 0.9), "verified");
  assertEquals(finalOutcome("verified", 0.59), "insufficient");
  assertEquals(finalOutcome("rejected", 0.95), "rejected");
  assertEquals(finalOutcome("rejected", 0.3), "insufficient");
  assertEquals(finalOutcome("insufficient", 1), "insufficient");
  assertEquals(finalOutcome("verified", Number.NaN), "insufficient");
});

Deno.test("milestones only at new bests", () => {
  assert(isMilestone(7, 6));
  assert(!isMilestone(7, 21));
  assert(!isMilestone(8, 7));
});

Deno.test("jpeg sniffing and base64 round trip", () => {
  const jpegHead = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const b64 = encodeBase64(jpegHead);
  assert(looksLikeJpegBase64(b64));
  assert(!looksLikeJpegBase64(encodeBase64(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))));
  assertEquals(decodeBase64(b64), jpegHead);
  const big = new Uint8Array(100_000).map((_, i) => (i * 7919) & 255);
  assertEquals(decodeBase64(encodeBase64(big)), big);
});

Deno.test("local time formatting with DST-aware zones and bad zone fallback", () => {
  assertEquals(formatLocalTime(due, "Europe/Bucharest"), "07:00");
  assertEquals(formatLocalTime(new Date("2026-10-26T04:00:00Z"), "Europe/Bucharest"), "06:00");
  assertEquals(formatLocalTime(due, "Not/AZone"), "04:00");
});

// ---------------- AI ----------------
const okPayload = (obj: unknown) => ({
  id: "resp_1", status: "completed", model: "m",
  output: [{ type: "reasoning", summary: [] }, { type: "message", content: [{ type: "output_text", text: JSON.stringify(obj) }] }],
});

// ---------------- RevenueCat ----------------
const now = new Date("2026-10-21T12:00:00Z");
const sub = (expires: string | null, extra: Record<string, unknown> = {}) => ({
  subscriber: {
    entitlements: { premium: { expires_date: expires, product_identifier: "nx_monthly", ...extra } },
    subscriptions: { nx_monthly: { period_type: "trial", store: "app_store", unsubscribe_detected_at: null, billing_issues_detected_at: null } },
  },
});

Deno.test("entitlement: active trial, expired, grace period, missing", () => {
  const a = parseSubscriber(sub("2026-10-24T12:00:00Z"), now);
  assertEquals([a.isActive, a.periodType, a.store, a.willRenew], [true, "trial", "app_store", true]);
  assertEquals(parseSubscriber(sub("2026-10-20T12:00:00Z"), now).isActive, false);
  assertEquals(parseSubscriber(sub("2026-10-20T12:00:00Z", { grace_period_expires_date: "2026-10-23T00:00:00Z" }), now).isActive, true);
  assertEquals(parseSubscriber({ subscriber: { entitlements: {} } }, now).isActive, false);
  assertEquals(parseSubscriber(null, now).isActive, false);
});

Deno.test("entitlement fetch uses secret key and fails closed on HTTP errors", async () => {
  let auth = "";
  const ok: typeof fetch = (_u, init) => { auth = (init?.headers as Record<string, string>).authorization; return Promise.resolve(new Response(JSON.stringify(sub("2099-01-01T00:00:00Z")))); };
  assert((await fetchEntitlement("u1", "sk_rc", ok)).isActive);
  assertEquals(auth, "Bearer sk_rc");
  await assertRejects(() => fetchEntitlement("u1", "sk_rc", () => Promise.resolve(new Response("", { status: 401 }))));
});

Deno.test("webhook helpers: constant-time compare and user extraction", () => {
  assert(safeEqual("Bearer abc", "Bearer abc"));
  assert(!safeEqual("Bearer abc", "Bearer abd"));
  assert(!safeEqual("", "Bearer abc"));
  const u1 = "aaaaaaaa-0000-0000-0000-000000000001", u2 = "bbbbbbbb-0000-0000-0000-000000000002";
  assertEquals(affectedUserIds({ app_user_id: u1, aliases: ["$RCAnonymousID:123", u1], transferred_to: [u2] }).sort(), [u1, u2]);
});

// ---------------- Phase 2: levels, evidence, duplicates, appeals ----------------
Deno.test("levels: required evidence per level", () => {
  assertEquals(checkEvidence("standard", ["live"]), { ok: true });
  assert(!checkEvidence("standard", ["live", "live"]).ok);
  assert(!checkEvidence("standard", ["live", "screenshot"]).ok);
  assertEquals(checkEvidence("strict", ["live", "live"]), { ok: true });
  assertEquals(checkEvidence("strict", ["live", "live", "screenshot"]), { ok: true });
  assert(!checkEvidence("strict", ["live"]).ok);
  assert(!checkEvidence("strict", ["live", "live", "screenshot", "screenshot"]).ok);
  assert(!checkEvidence("elite", ["live", "live"]).ok);
  assertEquals(checkEvidence("elite", ["live", "live", "screenshot"]), { ok: true });
  assert(!checkEvidence("elite", ["screenshot", "screenshot", "live"]).ok);
});

Deno.test("levels: Premium decides the effective level; thresholds rise with the level", () => {
  assertEquals(effectiveLevel("elite", false), "standard");
  assertEquals(effectiveLevel("elite", true), "elite");
  assertEquals(effectiveLevel("nonsense", true), "standard");
  assertEquals(finalOutcome("verified", 0.65, "standard"), "verified");
  assertEquals(finalOutcome("verified", 0.65, "strict"), "insufficient");
  assertEquals(finalOutcome("verified", 0.75, "elite"), "insufficient");
  assertEquals(finalOutcome("verified", 0.85, "elite"), "verified");
  assertEquals(finalOutcome("rejected", 0.75, "elite"), "insufficient");
});

Deno.test("appeals overturn only on a confident verified", () => {
  assert(appealOverturns("verified", 0.8));
  assert(!appealOverturns("verified", 0.7));
  assert(!appealOverturns("verified", 0.79, "elite"));
  assert(!appealOverturns("insufficient", 1));
  assert(!appealOverturns("rejected", 1));
});

Deno.test("duplicates: exact reuse and near-identical screenshots are refused; live look-alikes are flagged", () => {
  const items = [{ kind: "live" as const, sha256: "a" }, { kind: "screenshot" as const, sha256: "b" }];
  assert(!judgeDuplicates([{ kind: "live", sha256: "a" }, { kind: "live", sha256: "a" }], []).ok);
  assert(!judgeDuplicates(items, [{ input_index: 0, exact: true, distance: 0, kind: "live", created_at: "2026-11-02T07:00:00Z" }]).ok);
  assert(!judgeDuplicates(items, [{ input_index: 1, exact: false, distance: 3, kind: "screenshot", created_at: "2026-11-02T07:00:00Z" }]).ok);
  const flagged = judgeDuplicates(items, [{ input_index: 0, exact: false, distance: 2, kind: "live", created_at: "2026-11-02T07:00:00Z" }]);
  assert(flagged.ok && flagged.notes.length === 1 && flagged.notes[0].includes("2 Nov"));
  const fine = judgeDuplicates(items, [{ input_index: 0, exact: false, distance: 6, kind: "live", created_at: "2026-11-02T07:00:00Z" }]);
  assert(fine.ok && fine.notes.length === 0);
});

function scene(w: number, h: number, seed: number): Uint8Array {
  const d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const v = Math.round(128 + 100 * Math.sin((x * (seed + 1)) / 37 + (y * (seed + 2)) / 53) * Math.cos((x - y * seed) / 61));
    d[i] = v; d[i + 1] = (v * 3 + seed * 40) % 256; d[i + 2] = 255 - v; d[i + 3] = 255;
  }
  return d;
}

Deno.test("dHash: re-encoded and resized copies stay close; different scenes are far", async () => {
  const a = jpeg.encode({ data: scene(640, 480, 1), width: 640, height: 480 }, 90).data;
  const aLow = jpeg.encode({ data: scene(640, 480, 1), width: 640, height: 480 }, 40).data;
  const aSmall = jpeg.encode({ data: scene(320, 240, 1).map((v) => v), width: 320, height: 240 }, 80).data;
  const b = jpeg.encode({ data: scene(640, 480, 5), width: 640, height: 480 }, 90).data;
  const ha = dhashFromJpeg(a)!, haLow = dhashFromJpeg(aLow)!, hb = dhashFromJpeg(b)!;
  assertEquals(ha.length, 16);
  assert(hammingHex(ha, haLow) <= 4, `re-encoded distance ${hammingHex(ha, haLow)}`);
  assert(hammingHex(ha, hb) >= 16, `different scenes distance ${hammingHex(ha, hb)}`);
  assertEquals(dhashFromJpeg(new Uint8Array([1, 2, 3])), null);
  assertEquals(dhashFromRgba(new Uint8Array(9 * 8 * 4), 9, 8), "0000000000000000");
  assertEquals((await sha256Hex(new TextEncoder().encode("abc"))).slice(0, 8), "ba7816bf");
  assert(aSmall.length > 0);
});

// ---------------- Phase 3: coach ----------------
// ---------------- Phase 6: challenge generator ----------------
const goodPlan: Plan = { title: "Morning engine", description: "d", rules: "r", progression: "p", kind: "custom", difficulty: "intermediate",
  duration_days: 14, allowed_misses: 2, objectives: [{ title: "Run 3 km", time: "06:30", weekdays: [1, 3, 5, 5, 9], proof_hint: "watch", verification_level: "elite" }] };

Deno.test("generator: valid plan is cleaned; free accounts get standard verification", () => {
  const v = validatePlan(goodPlan, false);
  assert(v.ok);
  if (v.ok) { assertEquals(v.plan.objectives[0].weekdays, [1, 3, 5]); assertEquals(v.plan.objectives[0].verification_level, "standard"); }
  const p = validatePlan(goodPlan, true);
  assert(p.ok && p.plan.objectives[0].verification_level === "elite");
});

Deno.test("generator: rules mirror the database", () => {
  assert(!validatePlan({ ...goodPlan, kind: "daily" }, true).ok);
  assert(validatePlan({ ...goodPlan, kind: "daily", duration_days: 1, allowed_misses: 0 }, true).ok);
  assert(validatePlan({ ...goodPlan, kind: "weekly", duration_days: 7, allowed_misses: 3 }, true).ok);
  assert(!validatePlan({ ...goodPlan, kind: "elite", difficulty: "elite", allowed_misses: 1 }, true).ok);
  assert(!validatePlan({ ...goodPlan, allowed_misses: 5 }, true).ok);
  assert(!validatePlan({ ...goodPlan, objectives: [{ ...goodPlan.objectives[0], time: "7am" }] }, true).ok);
  assert(!validatePlan({ ...goodPlan, objectives: [] }, true).ok);
});

Deno.test("push copy exists in every language, with Romanian plurals", () => {
  const all = [copy.reminder("Run", 10, "06:45", "07:15"), copy.verified("Run", 1), copy.verified("Run", 21), copy.missed("Run", { en: "tomorrow 07:00", ro: "mâine la 07:00" }),
    copy.milestone(20), copy.achievement({ en: "Comeback", ro: ACHIEVEMENT_RO.comeback }), copy.appeal("Run", true, 150), copy.excused("Run")];
  for (const m of all) for (const l of ["en", "ro"] as const) assert(m[l].title.length > 0 && m[l].body.length > 0);
  assertEquals(copy.verified("Run", 1).ro.body, "Run — bifat. Serie: 1 zi.");
  assertEquals(copy.verified("Run", 21).ro.body, "Run — bifat. Serie: 21 de zile.");
  assert(copy.missed("Run", { en: "tomorrow 07:00", ro: "mâine la 07:00" }).ro.body.includes("mâine la 07:00"));
  assertEquals(Object.keys(ACHIEVEMENT_RO).length, 13);
});

Deno.test("notifyOnce sends the user's language", async () => {
  const sent: unknown[] = [];
  // Minimal stand-in for the three queries notifyOnce makes.
  const db = {
    from: (table: string) => ({
      upsert: () => ({ select: () => Promise.resolve({ data: [{ ref_id: "r" }], error: null }) }),
      select: () => ({
        eq: () => table === "push_tokens"
          ? Promise.resolve({ data: [{ token: "ExponentPushToken[x]" }] })
          : { maybeSingle: () => Promise.resolve({ data: { language: "ro" } }) },
      }),
      delete: () => ({ in: () => Promise.resolve({}) }),
    }),
  };
  const fake: typeof fetch = (_u, init) => { sent.push(JSON.parse(String(init?.body))); return Promise.resolve(new Response(JSON.stringify({ data: [{ status: "ok" }] }))); };
  // deno-lint-ignore no-explicit-any
  const ok = await notifyOnce(db as any, "u", "excused", "r", copy.excused("Alergare"), {}, fake);
  assert(ok);
  assertEquals((sent[0] as Array<{ title: string }>)[0].title, "Verificarea a eșuat la noi");
});
