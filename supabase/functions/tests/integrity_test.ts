// AI verification integrity: photo consistency (fix 1), fair verdicts (fix 2), near-duplicate evidence (fix 3).
// No network: the AI provider, the database and storage are faked. Real photos (public domain / CC0) are in fixtures/.
import nodeAssert from "node:assert/strict";
import jpeg from "npm:jpeg-js@0.4.4";
const assert = (v: unknown, msg = "assertion failed") => nodeAssert.ok(v, msg);
const assertEquals = (a: unknown, b: unknown, msg?: string) => nodeAssert.deepStrictEqual(a, b, msg);

import { requirementsFor } from "../../../src/shared/activity.ts";
import { buildEngineRequest, type EngineInput, finalizeAnalysis, mentionsActivity, OUTCOME, POINTS } from "../_shared/engine.ts";
import { checkDuplicates, copiesWithin, hashEvidence, judgeDuplicates, type Match, shortlist, signatureText } from "../_shared/evidence.ts";
import type { LlmConfig } from "../_shared/llm.ts";
import { COPY_DETAIL_MIN, SIMILAR_MIN } from "../_shared/rules.ts";
import { cropMatch, decodeSignature, detailSimilarity, encodeSignature, type Rgba, signatureFromRgba } from "../_shared/similarity.ts";
import { judgeAndApply } from "../_shared/verify.ts";
import { encodeBase64 } from "../_shared/b64.ts";

// ======================================================================
// Fix 2 — fair verdict classification
// ======================================================================

const input = (over: Partial<EngineInput> = {}): EngineInput => ({
  commitment: { title: "Read 20 pages", description: null, proofHint: null },
  activity: "reading", level: "standard", localTargetTime: "07:00", localReceivedTime: "07:03", language: "en",
  images: [{ kind: "live", base64: "AAAA" }],
  ...over,
});
/** A model answer in the new contract. Defaults: a confident, clean VERIFIED of one reading photo. */
const model = (over: Record<string, unknown> = {}) => ({
  status: "VERIFIED", confidence: 0.95, summary: "s", consistency: "", explanation: "e", next_action: "",
  evidence: [{ image: 1, shows: "An open book at page 54, held in two hands.", relation: "shows_activity", concerns: "" }],
  requirements: [{ id: "book", satisfied: true, image: 1, note: "" }],
  consistency_check: { verdict: "single_photo", differences: [] }, reject_reason: "none",
  ...over,
});
const fin = (m: Record<string, unknown>, i: Partial<EngineInput> = {}) => {
  const inp = input(i);
  return finalizeAnalysis(m, inp, requirementsFor(inp.activity, inp.level));
};
const penalty = (status: keyof typeof POINTS) => POINTS[status];

Deno.test("fix 2: verdicts are four distinct outcomes; only REJECTED costs points, provider errors never do", () => {
  assertEquals(OUTCOME, { VERIFIED: "verified", NEEDS_MORE_EVIDENCE: "insufficient", REJECTED: "rejected", PROVIDER_ERROR: "error" });
  assertEquals(POINTS, { VERIFIED: 50, NEEDS_MORE_EVIDENCE: 0, REJECTED: -100, PROVIDER_ERROR: 0 });
});

Deno.test("fix 2: bookshelf submitted for 'Read 20 pages' is never a −100 (as seen live: REJECTED at confidence 1)", () => {
  // Correct labelling: related but incomplete.
  const a = fin(model({ status: "REJECTED", confidence: 1, reject_reason: "unrelated",
    evidence: [{ image: 1, shows: "A collection of books on a wooden shelf.", relation: "related_incomplete", concerns: "No open book." }],
    requirements: [{ id: "book", satisfied: false, image: 0, note: "Books are closed on a shelf." }] }));
  assertEquals([a.status, penalty(a.status)], ["NEEDS_MORE_EVIDENCE", 0]);
  assert(a.guards.includes("not_every_image_unrelated") && a.explanation.includes("no penalty") && a.next_action.length > 0);
  // Worst case: the model mislabels the bookshelf as unrelated. Its own description contradicts that → still no penalty.
  const b = fin(model({ status: "REJECTED", confidence: 1, reject_reason: "unrelated",
    evidence: [{ image: 1, shows: "A collection of books on a wooden shelf.", relation: "unrelated", concerns: "" }],
    requirements: [{ id: "book", satisfied: false, image: 0, note: "" }] }));
  assertEquals([b.status, b.guards], ["NEEDS_MORE_EVIDENCE", ["unrelated_label_contradicts_description"]]);
});

Deno.test("fix 2: empty glass submitted for 'Drink a glass of water' is never a −100 (as seen live)", () => {
  const water = { commitment: { title: "Drink a glass of water" }, activity: "general" as const };
  const a = fin(model({ status: "REJECTED", confidence: 1, reject_reason: "unrelated",
    evidence: [{ image: 1, shows: "An empty, ornate glass vessel with etched figures.", relation: "related_incomplete", concerns: "Nobody is drinking." }],
    requirements: [{ id: "activity", satisfied: false, image: 0, note: "" }] }), water);
  assertEquals([a.status, penalty(a.status)], ["NEEDS_MORE_EVIDENCE", 0]);
  const b = fin(model({ status: "REJECTED", confidence: 1, reject_reason: "unrelated",
    evidence: [{ image: 1, shows: "An empty, ornate glass vessel with etched figures.", relation: "unrelated", concerns: "" }],
    requirements: [{ id: "activity", satisfied: false, image: 0, note: "" }] }), water);
  assertEquals(b.status, "NEEDS_MORE_EVIDENCE");
  // Romanian descriptions are covered too.
  assert(mentionsActivity("Un pahar gol pe masă.", "general", "Beau un pahar de apă"));
});

Deno.test("fix 2: ambiguous evidence never costs points", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["model unsure (NEEDS_MORE_EVIDENCE)", { status: "NEEDS_MORE_EVIDENCE", confidence: 0.9, requirements: [{ id: "book", satisfied: false, image: 0, note: "" }],
      evidence: [{ image: 1, shows: "A blurry object on a table.", relation: "unreadable", concerns: "Blurry" }] }],
    ["dark/blank photo labelled unreadable, model says REJECTED", { status: "REJECTED", confidence: 1, reject_reason: "unrelated",
      evidence: [{ image: 1, shows: "An entirely black image.", relation: "unreadable", concerns: "" }], requirements: [] }],
    ["REJECTED without a reason", { status: "REJECTED", confidence: 1, reject_reason: "none",
      evidence: [{ image: 1, shows: "A red car.", relation: "unrelated", concerns: "" }], requirements: [] }],
    ["REJECTED below 0.8", { status: "REJECTED", confidence: 0.79, reject_reason: "unrelated",
      evidence: [{ image: 1, shows: "A red car.", relation: "unrelated", concerns: "" }], requirements: [] }],
    ["REJECTED although the photo shows the activity", { status: "REJECTED", confidence: 1, reject_reason: "fabricated" }],
    ["VERIFIED below the verify minimum", { confidence: 0.7 }],
    ["missing relation (malformed answer) fails safe", { status: "REJECTED", confidence: 1, reject_reason: "unrelated",
      evidence: [{ image: 1, shows: "A red car.", concerns: "" }], requirements: [] }],
    ["unknown status fails safe", { status: "MAYBE" }],
  ];
  for (const [name, m] of cases) {
    const a = fin(model(m));
    assertEquals([name, a.status, penalty(a.status)], [name, "NEEDS_MORE_EVIDENCE", 0]);
  }
});

Deno.test("fix 2: clearly unrelated evidence is still rejected (−100), including injection attempts", () => {
  const car = fin(model({ status: "REJECTED", confidence: 1, reject_reason: "unrelated",
    evidence: [{ image: 1, shows: "A red Ferrari in a showroom environment.", relation: "unrelated", concerns: "" }],
    requirements: [{ id: "book", satisfied: false, image: 0, note: "" }] }));
  assertEquals([car.status, penalty(car.status), car.reject_reason, car.guards], ["REJECTED", -100, "unrelated", []]);
  const textInjection = fin(model({ status: "REJECTED", confidence: 1, reject_reason: "fabricated",
    evidence: [{ image: 1, shows: "Text instructions addressed to the verifier.", relation: "unrelated", concerns: "" }], requirements: [] }));
  assertEquals(textInjection.status, "REJECTED");
  const otherActivity = fin(model({ status: "REJECTED", confidence: 1, reject_reason: "different_activity",
    evidence: [{ image: 1, shows: "A woman reading a book by the water.", relation: "unrelated", concerns: "" }], requirements: [] }),
    { commitment: { title: "Go to the gym" }, activity: "gym" });
  assertEquals(otherActivity.status, "REJECTED");
  // Half of a compound commitment shown → no penalty (as seen live: "Read 20 pages and run 5 km" + reading photo).
  const half = fin(model({ status: "REJECTED", confidence: 1, reject_reason: "unrelated",
    evidence: [{ image: 1, shows: "A person lying on the ground reading a book next to a bicycle.", relation: "unrelated", concerns: "" }], requirements: [] }),
    { commitment: { title: "Read 20 pages and run 5 km" }, activity: "running" });
  assertEquals(half.status, "NEEDS_MORE_EVIDENCE");
});

Deno.test("fix 2: a requirement can't be met by an image the model calls unrelated or unreadable", () => {
  const a = fin(model({ evidence: [{ image: 1, shows: "A cat.", relation: "unrelated", concerns: "" }] }));
  assertEquals([a.status, a.requirements[0].satisfied], ["NEEDS_MORE_EVIDENCE", false]);
  assert(a.guards.includes("requirement_book_on_unusable_image"));
});

// ---------- provider errors through the real pipeline (fake provider + fake database) ----------

type Call = { table?: string; op: string; args?: unknown };
function fakeDb(calls: Call[]) {
  const proof = {
    id: "p1", user_id: "u1", received_at: "2026-11-23T05:03:00Z", level: "standard",
    target: { id: "t1", due_at: "2026-11-23T05:00:00Z", habit: { id: "h1", title: "Read 20 pages", proof_hint: null, description: null, category: null, activity: null, longest_streak: 0, challenge: null } },
    profile: { timezone: "Europe/Bucharest", language: "en" },
  };
  const chain = (table: string) => {
    const q: Record<string, unknown> = {};
    const self = new Proxy(q, {
      get(_t, k: string) {
        if (k === "then") return undefined;
        if (k === "single" || k === "maybeSingle") return () => Promise.resolve({ data: table === "proofs" ? proof : null, error: null });
        return (...args: unknown[]) => {
          if (k === "insert" || k === "update") calls.push({ table, op: k, args: args[0] });
          return k === "insert" || k === "update" ? Object.assign(Promise.resolve({ data: null, error: null }), { eq: () => Promise.resolve({ error: null }), select: () => Promise.resolve({ data: [], error: null }) }) : self;
        };
      },
    });
    return self;
  };
  return {
    from: (t: string) => chain(t),
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ op: `rpc:${name}`, args });
      if (name === "apply_verdict") {
        const delta = args.p_outcome === "rejected" ? -100 : args.p_outcome === "verified" ? 50 : 0;
        return Promise.resolve({ data: { points_delta: delta, streak: 0, total_points: delta, target_status: "pending", already_settled: false }, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    },
  };
}
const cfg: LlmConfig = { provider: "gemini", model: "gemini-test", apiKey: "k" };
const noSleep = () => Promise.resolve();

async function runWithProvider(fetchImpl: typeof fetch, timeoutMs = 2000) {
  const calls: Call[] = [];
  // deno-lint-ignore no-explicit-any
  const r = await judgeAndApply(fakeDb(calls) as any, "p1", [{ kind: "live", base64: "AAAA" }], [],
    { config: cfg, fetchImpl, sleep: noSleep, timeoutMs, maxAttempts: 3 });
  const applied = calls.find((c) => c.op === "rpc:apply_verdict")!.args as Record<string, unknown>;
  return { r, applied, calls };
}

Deno.test("fix 2: Gemini timeout → PROVIDER_ERROR, outcome 'error', 0 points, no penalty text", async () => {
  const hang: typeof fetch = (_u, init) => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
  const { r, applied } = await runWithProvider(hang, 30);
  assertEquals([r.verdict, r.outcome, r.points_delta, applied.p_outcome, r.error_code], ["PROVIDER_ERROR", "error", 0, "error", "timeout"]);
  assert(r.critique.includes("nothing is deducted") && r.analysis === null);
  assertEquals(applied.p_raw, { error: "timeout" });
});

Deno.test("fix 2: provider errors (503 outage, 429 quota, blocked, malformed answer) → PROVIDER_ERROR, never a penalty", async () => {
  const respond = (status: number, body: unknown): typeof fetch => () => Promise.resolve(new Response(JSON.stringify(body), { status }));
  const ok = (text: string) => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } });
  const cases: [string, typeof fetch, string][] = [
    ["503 UNAVAILABLE", respond(503, { error: { code: 503, status: "UNAVAILABLE", message: "overloaded" } }), "server"],
    ["429 rate limit (retried, then given up)", respond(429, { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "rate" } }), "rate_limit"],
    ["blocked", respond(200, { promptFeedback: { blockReason: "SAFETY" }, candidates: [] }), "blocked"],
    ["answer missing the new required fields", respond(200, ok(JSON.stringify({ status: "REJECTED", confidence: 1, summary: "s", evidence: [], requirements: [], consistency: "", explanation: "e", next_action: "" }))), "invalid_output"],
    ["network failure", () => Promise.reject(new TypeError("connection reset")), "network"],
  ];
  for (const [name, f, code] of cases) {
    const { r, applied } = await runWithProvider(f);
    assertEquals([name, r.verdict, r.outcome, r.points_delta, applied.p_outcome, r.error_code], [name, "PROVIDER_ERROR", "error", 0, "error", code]);
  }
});

Deno.test("fix 2: a valid REJECTED answer for a bookshelf goes through the pipeline as 'insufficient' with 0 points", async () => {
  const answer = model({ status: "REJECTED", confidence: 1, reject_reason: "unrelated",
    evidence: [{ image: 1, shows: "A collection of books on a wooden shelf.", relation: "unrelated", concerns: "" }],
    requirements: [{ id: "book", satisfied: false, image: 0, note: "" }] });
  const body = { candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } };
  const { r, applied } = await runWithProvider(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })));
  assertEquals([r.verdict, r.outcome, r.points_delta, applied.p_outcome], ["NEEDS_MORE_EVIDENCE", "insufficient", 0, "insufficient"]);
  assertEquals((applied.p_raw as { guards: string[] }).guards, ["unrelated_label_contradicts_description"]);
});

// ======================================================================
// Fix 1 — consistency between live photos
// ======================================================================

const strictInput = (over: Partial<EngineInput> = {}): Partial<EngineInput> => ({
  level: "strict", images: [{ kind: "live", base64: "AAAA" }, { kind: "live", base64: "BBBB" }], ...over,
});
const strictModel = (over: Record<string, unknown> = {}) => model({
  evidence: [
    { image: 1, shows: "A woman reading a book on a sofa.", relation: "shows_activity", concerns: "" },
    { image: 2, shows: "Close-up of pages 180–181 held in two hands.", relation: "shows_activity", concerns: "" },
  ],
  requirements: [{ id: "book", satisfied: true, image: 1, note: "" }, { id: "progress", satisfied: true, image: 2, note: "" }],
  consistency_check: { verdict: "consistent", differences: [] },
  ...over,
});

Deno.test("fix 1: two consistent live photos verify", () => {
  const a = fin(strictModel(), strictInput());
  assertEquals([a.status, a.guards], ["VERIFIED", []]);
});

Deno.test("fix 1: inconsistent live photos never verify (the audit's false acceptance) — and never cost points", () => {
  // As seen live: different scene, different hands, different book — yet VERIFIED at confidence 1.
  const a = fin(strictModel({ consistency: "Both show reading.", consistency_check: { verdict: "inconsistent", differences: ["setting", "clothing_or_hands", "object"] } }), strictInput());
  assertEquals([a.status, penalty(a.status)], ["NEEDS_MORE_EVIDENCE", 0]);
  assert(a.guards.includes("live_photos_not_shown_consistent"));
  assert(a.explanation.includes("same session") && a.explanation.includes("no penalty") && a.next_action.includes("both photos"));
  // A model that says "consistent" but still lists a difference is not trusted either.
  assertEquals(fin(strictModel({ consistency_check: { verdict: "consistent", differences: ["lighting_or_time"] } }), strictInput()).status, "NEEDS_MORE_EVIDENCE");
  // Inconsistency is a reason to ask again, not to penalise: a REJECTED here becomes NEEDS_MORE_EVIDENCE.
  assertEquals(fin(strictModel({ status: "REJECTED", reject_reason: "fabricated", consistency_check: { verdict: "inconsistent", differences: ["setting"] } }), strictInput()).status, "NEEDS_MORE_EVIDENCE");
});

Deno.test("fix 1: when consistency can't be established it fails safe", () => {
  for (const cc of [{ verdict: "unclear", differences: [] }, { verdict: "single_photo", differences: [] }, undefined, { verdict: "yes" }]) {
    const a = fin(strictModel({ consistency_check: cc }), strictInput());
    assertEquals([JSON.stringify(cc), a.status], [JSON.stringify(cc), "NEEDS_MORE_EVIDENCE"]);
  }
});

Deno.test("fix 1: every live photo must belong to the commitment; at least one must show the activity", () => {
  const offTopic = fin(strictModel({ evidence: [
    { image: 1, shows: "A woman reading a book.", relation: "shows_activity", concerns: "" },
    { image: 2, shows: "A parked car.", relation: "unrelated", concerns: "" }],
    requirements: [{ id: "book", satisfied: true, image: 1, note: "" }, { id: "progress", satisfied: true, image: 1, note: "" }] }), strictInput());
  assertEquals(offTopic.status, "NEEDS_MORE_EVIDENCE");
  const noneShowsIt = fin(model({ evidence: [{ image: 1, shows: "A closed book on a desk.", relation: "related_incomplete", concerns: "" }] }));
  assertEquals([noneShowsIt.status, noneShowsIt.guards.includes("no_live_photo_shows_activity")], ["NEEDS_MORE_EVIDENCE", true]);
  // A single live photo (Standard) has nothing to be consistent with: unaffected.
  assertEquals(fin(model()).status, "VERIFIED");
});

Deno.test("fix 1: the prompt asks for non-biometric comparison only", () => {
  const req = buildEngineRequest(input(strictInput()), requirementsFor("reading", "strict"));
  assert(req.system.includes("Never compare faces and never try to identify anyone"));
  assert(req.system.includes("non-biometric"));
  const cc = (req.schema!.properties!.consistency_check.properties!.differences.items!.enum ?? []) as string[];
  assert(!cc.some((d) => /face|identity|person/.test(d)), "no biometric difference categories");
});

// ======================================================================
// Fix 3 — near-duplicate evidence (real photos, variants generated here)
// ======================================================================

const FIX = new URL("./fixtures/", import.meta.url);
const load = (n: string): Rgba => {
  const im = jpeg.decode(Deno.readFileSync(new URL(`${n}.jpg`, FIX)), { useTArray: true, formatAsRGBA: true });
  return { data: im.data, width: im.width, height: im.height };
};
const enc = (im: Rgba, q = 85): Uint8Array => jpeg.encode({ data: im.data, width: im.width, height: im.height }, q).data;
const dec = (b: Uint8Array): Rgba => { const im = jpeg.decode(b, { useTArray: true, formatAsRGBA: true }); return { data: im.data, width: im.width, height: im.height }; };
function sample(im: Rgba, x: number, y: number, c: number): number {
  const x0 = Math.max(0, Math.min(im.width - 1, Math.floor(x))), y0 = Math.max(0, Math.min(im.height - 1, Math.floor(y)));
  const x1 = Math.min(im.width - 1, x0 + 1), y1 = Math.min(im.height - 1, y0 + 1), fx = Math.max(0, Math.min(1, x - x0)), fy = Math.max(0, Math.min(1, y - y0));
  const p = (xx: number, yy: number) => im.data[(yy * im.width + xx) * 4 + c];
  return (p(x0, y0) * (1 - fx) + p(x1, y0) * fx) * (1 - fy) + (p(x0, y1) * (1 - fx) + p(x1, y1) * fx) * fy;
}
/** Generic warp: output pixel (x, y) takes the source at map(x, y), plus brightness gain and noise. */
function warp(im: Rgba, w: number, h: number, map: (x: number, y: number) => [number, number], gain = 1, noise = 0, seed = 1): Rgba {
  const out = new Uint8Array(w * h * 4);
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [sx, sy] = map(x, y);
    for (let c = 0; c < 3; c++) out[(y * w + x) * 4 + c] = Math.max(0, Math.min(255, Math.round(sample(im, sx, sy, c) * gain + (noise ? rnd() * noise * 3.4 : 0))));
    out[(y * w + x) * 4 + 3] = 255;
  }
  return { data: out, width: w, height: h };
}
const resize = (im: Rgba, f: number) => warp(im, Math.round(im.width * f), Math.round(im.height * f), (x, y) => [(x + 0.5) / f - 0.5, (y + 0.5) / f - 0.5]);
const crop = (im: Rgba, l: number, t: number, r: number, b: number) => {
  const x0 = im.width * l, y0 = im.height * t, w = Math.round(im.width * (1 - l - r)), h = Math.round(im.height * (1 - t - b));
  return warp(im, w, h, (x, y) => [x + x0, y + y0]);
};
/** A new handheld photo of the same static scene: sub-degree rotation, small shift, different light, sensor noise. */
const reshoot = (im: Rgba, deg: number, dx: number, dy: number, gain: number, seed: number) => {
  const a = (deg * Math.PI) / 180, cx = im.width / 2, cy = im.height / 2, m = 0.06;
  const w = im.width, h = im.height, sx = 1 - 2 * m;
  return warp(im, w, h, (x, y) => {
    const u = (x / w) * sx + m + dx, v = (y / h) * sx + m + dy;
    const px = u * w - cx, py = v * h - cy;
    return [cx + px * Math.cos(a) - py * Math.sin(a), cy + px * Math.sin(a) + py * Math.cos(a)];
  }, gain, 4, seed);
};

const sigOf = (im: Rgba) => signatureFromRgba(im.data, im.width, im.height);
/** Full two-stage decision, as checkDuplicates makes it. */
function isCopy(a: Rgba, b: Rgba): { copy: boolean; stage1: number; stage2: number | null } {
  const m = cropMatch(sigOf(a), sigOf(b));
  if (m.score < SIMILAR_MIN) return { copy: false, stage1: m.score, stage2: null };
  const d = detailSimilarity(a, b, m);
  return { copy: d >= COPY_DETAIL_MIN, stage1: m.score, stage2: d };
}

const photos = ["coffee", "chelsea", "rocket"];

Deno.test("fix 3: resized, re-compressed and slightly cropped copies are recognised", () => {
  for (const n of photos) {
    const orig = load(n);
    const variants: [string, Rgba][] = [
      ["re-compressed q40", dec(enc(orig, 40))],
      ["resized to 50 %", dec(enc(resize(orig, 0.5), 80))],
      ["cropped 3 % each side", dec(enc(crop(orig, 0.03, 0.03, 0.03, 0.03)))],
      ["cropped 8 % on one side", dec(enc(crop(orig, 0.08, 0, 0, 0)))],
      ["cropped 5 % + resized 70 % + q60", dec(enc(resize(crop(orig, 0.05, 0.04, 0.06, 0.05), 0.7), 60))],
    ];
    for (const [name, v] of variants) {
      const r = isCopy(dec(enc(orig)), v);
      assert(r.copy, `${n} ${name}: expected a copy (stage 1 ${r.stage1.toFixed(3)}, stage 2 ${r.stage2?.toFixed(3)})`);
    }
  }
});

Deno.test("fix 3: genuinely different photos are not copies — including a re-shot of the same scene seconds later", () => {
  for (const n of photos) {
    const orig = load(n);
    const shotA = dec(enc(reshoot(orig, 0, 0, 0, 1, 11)));
    for (const [name, b] of [
      ["re-shot: 0.8° tilt, 1 % shift, 5 % darker", reshoot(orig, 0.8, 0.01, 0.01, 0.95, 22)],
      ["re-shot: 1.5° tilt, 2 % shift, 15 % darker", reshoot(orig, 1.5, 0.02, -0.01, 0.85, 33)],
    ] as [string, Rgba][]) {
      const r = isCopy(shotA, dec(enc(b)));
      assert(!r.copy, `${n} ${name}: must not be called a copy (stage 1 ${r.stage1.toFixed(3)}, stage 2 ${r.stage2?.toFixed(3)})`);
    }
    for (const m of photos.filter((x) => x !== n)) {
      assert(!isCopy(orig, load(m)).copy, `${n} vs ${m}`);
      assertEquals(shortlist({ signature: sigOf(orig) }, [{ signature: encodeSignature(sigOf(load(m))) }]).length, 0, `${n} vs ${m} shortlisted`);
    }
  }
});

Deno.test("fix 3: signatures round-trip; blank images are never matched", () => {
  const s = sigOf(load("coffee"));
  const back = decodeSignature(encodeSignature(s))!;
  assertEquals([back.w, back.h, Array.from(back.px)], [s.w, s.h, Array.from(s.px)]);
  assert(encodeSignature(s).length < 4096);
  assertEquals(decodeSignature("garbage"), null);
  const black: Rgba = { data: new Uint8Array(64 * 48 * 4).fill(0).map((_v, i) => (i % 4 === 3 ? 255 : 0)), width: 64, height: 48 };
  assertEquals(cropMatch(sigOf(black), sigOf(black)).score, 0);
});

Deno.test("fix 3: policy — copies are refused across commitments and for the same target; look-alikes are only noted", () => {
  const live = [{ kind: "live" as const, sha256: "new" }];
  const at = "2026-11-20T07:00:00Z";
  const m = (o: Partial<Match>): Match => ({ input_index: 0, exact: false, distance: 64, kind: "live", created_at: at, ...o });
  const other = judgeDuplicates(live, [m({ copy: true, same_target: false })]);
  assert(!other.ok && other.reason === "reused" && other.message.includes("20 Nov"));
  const same = judgeDuplicates(live, [m({ copy: true, same_target: true })]);
  assert(!same.ok && same.reason === "reused_same_target");
  const sameExact = judgeDuplicates(live, [m({ exact: true, distance: 0, same_target: true })]);
  assert(!sameExact.ok && sameExact.reason === "reused_same_target");
  const lookalike = judgeDuplicates(live, [m({ similar: true })]);
  assert(lookalike.ok && lookalike.notes.length === 1 && lookalike.notes[0].includes("may be the same place"));
  // Screenshots of the same app look alike every day: a look-alike screenshot is allowed (only a near-identical one is refused).
  assert(judgeDuplicates([{ kind: "screenshot", sha256: "s" }], [m({ similar: true })]).ok);
  assert(!judgeDuplicates([{ kind: "screenshot", sha256: "s" }], [m({ distance: 3 })]).ok);
});

Deno.test("fix 3: a copy of one live photo used as the second live photo is refused", async () => {
  const orig = load("rocket");
  const a = enc(orig), b = enc(crop(orig, 0.04, 0.05, 0.02, 0.03), 70);
  const items = await hashEvidence([{ kind: "live", base64: encodeBase64(a) }, { kind: "live", base64: encodeBase64(b) }]);
  const pairs = copiesWithin(items, (i) => dec(items[i].bytes));
  assertEquals(pairs, [[0, 1]]);
  const r = judgeDuplicates(items, [], pairs);
  assert(!r.ok && r.reason === "copy_in_submission");
  // Two genuinely different shots of the same scene are fine.
  const c = enc(reshoot(orig, 0, 0, 0, 1, 5)), d = enc(reshoot(orig, 1.2, 0.015, 0.01, 0.9, 6));
  const items2 = await hashEvidence([{ kind: "live", base64: encodeBase64(c) }, { kind: "live", base64: encodeBase64(d) }]);
  assertEquals(copiesWithin(items2, (i) => dec(items2[i].bytes)), []);
});

Deno.test("fix 3: end to end — reuse after a failed verdict and across commitments is refused; isolation is by user id", async () => {
  const orig = load("chelsea");
  // The earlier proof: one capture of the scene (independent sensor noise and blur).
  const oldBytes = enc(reshoot(orig, 0, 0, 0, 1, 3), 72);
  const oldSig = signatureText(sigOf(dec(oldBytes)))!;
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const db = (sameTarget: boolean) => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "find_duplicate_evidence_v2") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: [{ proof_item_id: "i0", proof_id: "p0", kind: "live", storage_path: "u1/t0/p0.jpg", signature: oldSig, same_target: sameTarget, created_at: "2026-11-21T07:00:00Z" }], error: null });
    },
    storage: { from: () => ({ download: () => Promise.resolve({ data: new Blob([oldBytes as Uint8Array<ArrayBuffer>]), error: null }) }) },
  });
  // The same file again, cropped, shrunk and re-compressed.
  const resubmitted = enc(resize(crop(dec(oldBytes), 0.05, 0.03, 0.02, 0.04), 0.8), 65);
  const items = await hashEvidence([{ kind: "live", base64: encodeBase64(resubmitted) }]);
  // deno-lint-ignore no-explicit-any
  const sameT = await checkDuplicates(db(true) as any, "u1", "t1", items);
  assert(!sameT.ok && sameT.reason === "reused_same_target", JSON.stringify(sameT));
  // deno-lint-ignore no-explicit-any
  const otherT = await checkDuplicates(db(false) as any, "u1", "t2", items);
  assert(!otherT.ok && otherT.reason === "reused", JSON.stringify(otherT));
  // Both searches are scoped to the caller: the user id is passed straight through (the SQL filters on it).
  assert(calls.every((c) => c.args.p_user === "u1"));
  // A genuinely new capture of the same scene (its own noise, tilt and light) passes, with at most a note for the AI.
  const fresh = await hashEvidence([{ kind: "live", base64: encodeBase64(enc(reshoot(orig, 1, 0.02, 0.01, 0.9, 9))) }]);
  // deno-lint-ignore no-explicit-any
  const ok = await checkDuplicates(db(false) as any, "u1", "t2", fresh);
  assert(ok.ok, JSON.stringify(ok));
});
