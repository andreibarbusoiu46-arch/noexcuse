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
import { checkCaptureSession, classifyWindow, finalOutcome, formatLocalTime, isMilestone, looksLikeJpegBase64 } from "../_shared/rules.ts";
import { AiError, buildRequest, judgeProof, parseResponse, VERDICT_SCHEMA } from "../_shared/ai.ts";
import { affectedUserIds, fetchEntitlement, parseSubscriber, safeEqual } from "../_shared/revenuecat.ts";
import { decodeBase64, encodeBase64 } from "../_shared/b64.ts";

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

Deno.test("request uses strict JSON schema, image as data URL, no key in body", () => {
  const body = buildRequest("gpt-x", { habitTitle: "Run", proofHint: null, localTargetTime: "07:00", localReceivedTime: "06:58", imageBase64: "/9j/AAA" }, "low");
  const s = JSON.stringify(body);
  assert(s.includes('"strict":true'));
  assert(s.includes("data:image/jpeg;base64,/9j/AAA"));
  assertEquals((body as { reasoning?: unknown }).reasoning, { effort: "low" });
  assertEquals(VERDICT_SCHEMA.additionalProperties, false);
  assert(!s.toLowerCase().includes("sk-"));
});

Deno.test("parses a verdict and clamps confidence", () => {
  const j = parseResponse(okPayload({ verdict: "verified", confidence: 1.7, observed: ["track", "watch 5.02 km"], critique: "Track and watch visible." }));
  assertEquals(j.verdict, "verified");
  assertEquals(j.confidence, 1);
  assertEquals(j.observed.length, 2);
});

Deno.test("refusals are non-retryable; malformed output is retryable", () => {
  const refusal = { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] };
  const e1 = assertThrows(() => parseResponse(refusal), AiError);
  assertEquals((e1 as AiError).retryable, false);
  const e2 = assertThrows(() => parseResponse(okPayload({ verdict: "maybe", confidence: 1, observed: [], critique: "x" })), AiError);
  assertEquals((e2 as AiError).retryable, true);
  assertThrows(() => parseResponse({ status: "incomplete", output: [] }), AiError);
  assertThrows(() => parseResponse(okPayload({ verdict: "verified", confidence: 1, observed: [], critique: "  " })), AiError);
});

Deno.test("judgeProof: HTTP 500 and timeouts surface as retryable AiError", async () => {
  const fail500 = () => Promise.resolve(new Response("{}", { status: 500 }));
  const err = await assertRejects(() => judgeProof({ habitTitle: "Run", proofHint: null, localTargetTime: "07:00", localReceivedTime: "07:01", imageBase64: "/9j/" }, { apiKey: "k", model: "m", fetchImpl: fail500 as typeof fetch }), AiError);
  assertEquals((err as AiError).retryable, true);
  const hang: typeof fetch = (_u, init) => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
  const err2 = await assertRejects(() => judgeProof({ habitTitle: "Run", proofHint: null, localTargetTime: "07:00", localReceivedTime: "07:01", imageBase64: "/9j/" }, { apiKey: "k", model: "m", timeoutMs: 20, fetchImpl: hang }), AiError);
  assertEquals((err2 as AiError).retryable, true);
});

Deno.test("judgeProof: sends bearer key in header only and returns redacted raw", async () => {
  let seen: RequestInit | undefined;
  const fake: typeof fetch = (_u, init) => { seen = init; return Promise.resolve(new Response(JSON.stringify(okPayload({ verdict: "rejected", confidence: 0.9, observed: ["desk"], critique: "Desk only." })), { status: 200 })); };
  const r = await judgeProof({ habitTitle: "Run", proofHint: "track + watch", localTargetTime: "07:00", localReceivedTime: "07:01", imageBase64: "/9j/" }, { apiKey: "secret-key", model: "m", fetchImpl: fake });
  assertEquals((seen?.headers as Record<string, string>).authorization, "Bearer secret-key");
  assert(!String(seen?.body).includes("secret-key"));
  assertEquals(r.judgement.verdict, "rejected");
  assert(!JSON.stringify(r.raw).includes("input_image"));
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
