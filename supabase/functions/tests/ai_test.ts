// Unit tests for the AI layer. These use a fake fetch — they test our request building, error
// handling and validation. Real Gemini calls are exercised by the ai-selftest function.
import nodeAssert from "node:assert/strict";
const assert = (v: unknown, msg = "assertion failed") => nodeAssert.ok(v, msg);
const assertEquals = (a: unknown, b: unknown) => nodeAssert.deepStrictEqual(a, b);
async function assertRejects(fn: () => Promise<unknown>, Cls?: new (...a: never[]) => Error): Promise<Error> {
  try { await fn(); } catch (e) { if (Cls) nodeAssert.ok(e instanceof Cls, "wrong error type"); return e as Error; }
  throw new Error("expected rejection");
}
import { activityOf, detectActivity, requirementsFor } from "../../../src/shared/activity.ts";
import { ANALYSIS_SCHEMA, buildEngineRequest, analyzeEvidence, type EngineInput, finalizeAnalysis } from "../_shared/engine.ts";
import { buildGeminiBody, classifyGeminiError, LlmError, llmCall, type LlmConfig, llmConfig, parseGeminiResponse, validateSchema } from "../_shared/llm.ts";

const cfg: LlmConfig = { provider: "gemini", model: "gemini-test", apiKey: "secret-key" };
const noSleep = () => Promise.resolve();
const gem = (text: string, extra: Record<string, unknown> = {}) => ({
  candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 300, thoughtsTokenCount: 50, totalTokenCount: 1550 },
  ...extra,
});
const respond = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));

// ---------- configuration ----------

Deno.test("config: Gemini is chosen when its key is set; missing keys are a config error", () => {
  const env = (m: Record<string, string>) => (k: string) => m[k];
  assertEquals(llmConfig("verify", env({ GEMINI_API_KEY: "g", OPENAI_API_KEY: "o" })).provider, "gemini");
  assertEquals(llmConfig("verify", env({ GEMINI_API_KEY: "g" })).model, "gemini-3.1-flash-lite");
  assertEquals(llmConfig("verify", env({ GEMINI_API_KEY: "g", GEMINI_MODEL: "m1", GEMINI_MODEL_VERIFY: "m2" })).model, "m2");
  assertEquals(llmConfig("coach", env({ GEMINI_API_KEY: "g", GEMINI_MODEL: "m1", GEMINI_MODEL_VERIFY: "m2" })).model, "m1");
  assertEquals(llmConfig("verify", env({ OPENAI_API_KEY: "o" })).provider, "openai");
  let err: unknown;
  try { llmConfig("verify", env({})); } catch (e) { err = e; }
  assert(err instanceof LlmError && err.code === "config" && !err.retryable);
  try { llmConfig("verify", env({ AI_PROVIDER: "gemini", OPENAI_API_KEY: "o" })); } catch (e) { err = e; }
  assert(err instanceof LlmError && err.code === "config");
});

// ---------- request ----------

Deno.test("Gemini request: system instruction, inline images, JSON schema; key only in the header", async () => {
  let url = "", init: RequestInit | undefined;
  const fake: typeof fetch = (u, i) => { url = String(u); init = i; return respond(200, gem(JSON.stringify({ ok: true }))); };
  await llmCall({ feature: "selftest", system: "SYS", parts: [{ text: "hello" }, { image: { mimeType: "image/jpeg", base64: "AAAA" } }],
    schema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } } }, { config: cfg, fetchImpl: fake });
  assert(url.endsWith("/models/gemini-test:generateContent") && !url.includes("secret-key"));
  assertEquals((init?.headers as Record<string, string>)["x-goog-api-key"], "secret-key");
  const body = JSON.parse(String(init?.body));
  assertEquals(body.systemInstruction.parts[0].text, "SYS");
  assertEquals(body.contents[0].parts[1].inlineData, { mimeType: "image/jpeg", data: "AAAA" });
  assertEquals(body.generationConfig.responseMimeType, "application/json");
  assertEquals(body.generationConfig.responseJsonSchema.additionalProperties, false);
  assert(!String(init?.body).includes("secret-key"));
});

Deno.test("Gemini request: falls back to the legacy responseSchema dialect when JSON schema is unknown", async () => {
  const bodies: Record<string, unknown>[] = [];
  const fake: typeof fetch = (_u, i) => {
    const b = JSON.parse(String(i?.body)); bodies.push(b);
    return bodies.length === 1 ? respond(400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "Invalid JSON payload received. Unknown name \"responseJsonSchema\"" } })
      : respond(200, gem(JSON.stringify({ ok: true })));
  };
  const r = await llmCall({ feature: "selftest", system: "s", parts: [{ text: "x" }], schema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } } }, { config: cfg, fetchImpl: fake, sleep: noSleep });
  assertEquals(r.json, { ok: true });
  assertEquals((bodies[1].generationConfig as Record<string, unknown>).responseSchema, { type: "OBJECT", properties: { ok: { type: "BOOLEAN" } }, required: ["ok"], propertyOrdering: ["ok"] });
});

// ---------- errors, retries, timeouts ----------

Deno.test("errors: daily quota is not retried; per-minute rate limits are, honouring retryDelay", () => {
  const daily = classifyGeminiError(429, { error: { status: "RESOURCE_EXHAUSTED", message: "You exceeded your current quota", details: [
    { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] } });
  assertEquals([daily.code, daily.retryable], ["quota", false]);
  const minute = classifyGeminiError(429, { error: { status: "RESOURCE_EXHAUSTED", message: "You exceeded your current quota", details: [
    { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] },
    { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "2s" }] } });
  assertEquals([minute.code, minute.retryable, minute.retryAfterMs], ["rate_limit", true, 2000]);
  assertEquals(classifyGeminiError(400, { error: { message: "API key not valid. Please pass a valid API key." } }).code, "auth");
  assertEquals(classifyGeminiError(403, {}).code, "auth");
  assertEquals(classifyGeminiError(404, { error: { message: "models/x is not found" } }).code, "bad_request");
  assertEquals(classifyGeminiError(503, {}).retryable, true);
});

Deno.test("retries: 503 then success; quota fails fast; attempts are counted", async () => {
  let n = 0;
  const flaky: typeof fetch = () => (++n < 3 ? respond(503, { error: { status: "UNAVAILABLE" } }) : respond(200, gem("hi")));
  const r = await llmCall({ feature: "coach", system: "s", parts: [{ text: "x" }] }, { config: cfg, fetchImpl: flaky, sleep: noSleep });
  assertEquals([r.text, r.attempts, r.usage.total], ["hi", 3, 1550]);
  let calls = 0;
  const quota: typeof fetch = () => { calls++; return respond(429, { error: { message: "billing", details: [{ "@type": "x.QuotaFailure", violations: [{ quotaId: "PerDay" }] }] } }); };
  const e = await assertRejects(() => llmCall({ feature: "coach", system: "s", parts: [{ text: "x" }] }, { config: cfg, fetchImpl: quota, sleep: noSleep }), LlmError);
  assertEquals([(e as LlmError).code, calls], ["quota", 1]);
});

Deno.test("timeouts and network failures become retryable errors", async () => {
  const hang: typeof fetch = (_u, i) => new Promise((_r, rej) => i?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
  const e = await assertRejects(() => llmCall({ feature: "coach", system: "s", parts: [{ text: "x" }] }, { config: cfg, fetchImpl: hang, timeoutMs: 10, maxAttempts: 2, sleep: noSleep }), LlmError);
  assertEquals([(e as LlmError).code, (e as LlmError).attempts], ["timeout", 2]);
  const down: typeof fetch = () => Promise.reject(new TypeError("connection refused"));
  const e2 = await assertRejects(() => llmCall({ feature: "coach", system: "s", parts: [{ text: "x" }] }, { config: cfg, fetchImpl: down, maxAttempts: 1 }), LlmError);
  assertEquals((e2 as LlmError).code, "network");
});

Deno.test("invalid answers are rejected: blocked, truncated, not JSON, wrong schema", async () => {
  assertEquals(await codeOf(gem("x", { promptFeedback: { blockReason: "SAFETY" }, candidates: [] })), "blocked");
  assertEquals(await codeOf({ candidates: [{ content: { parts: [{ text: "{\"ok\":" }] }, finishReason: "MAX_TOKENS" }] }), "invalid_output");
  assertEquals(await codeOf(gem("not json")), "invalid_output");
  assertEquals(await codeOf(gem(JSON.stringify({ ok: "yes" }))), "invalid_output");
  assertEquals(await codeOf(gem(JSON.stringify({ ok: true, extra: 1 }))), "invalid_output");
  // Thought parts are never treated as the answer.
  assertEquals(parseGeminiResponse({ candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text: "{}" }] }, finishReason: "STOP" }] }), "{}");
});

async function codeOf(body: unknown): Promise<string> {
  try {
    await llmCall({ feature: "selftest", system: "s", parts: [{ text: "x" }], schema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } } },
      { config: cfg, fetchImpl: () => respond(200, body), maxAttempts: 1 });
    return "none";
  } catch (e) {
    return e instanceof LlmError ? e.code : "other";
  }
}

Deno.test("schema validator: types, enums, ranges, required and unknown keys", () => {
  assertEquals(validateSchema(ANALYSIS_SCHEMA, {}), "$.status is missing");
  const ok = { status: "VERIFIED", confidence: 0.9, summary: "s", evidence: [], requirements: [], consistency: "c", explanation: "e", next_action: "" };
  assertEquals(validateSchema(ANALYSIS_SCHEMA, ok), null);
  assert(validateSchema(ANALYSIS_SCHEMA, { ...ok, status: "MAYBE" })?.includes("not one of"));
  assert(validateSchema(ANALYSIS_SCHEMA, { ...ok, confidence: 1.4 })?.includes("above"));
  assert(validateSchema(ANALYSIS_SCHEMA, { ...ok, evidence: [{ image: 1.5, shows: "", relevant: true, concerns: "" }] })?.includes("integer"));
});

// ---------- activities and requirements ----------

Deno.test("activity detection in English and Romanian, with category fallback and explicit override", () => {
  assertEquals(detectActivity("Morning run — 5 km"), "running");
  assertEquals(detectActivity("Alergare 5 km"), "running");
  assertEquals(detectActivity("Gym — legs"), "gym");
  assertEquals(detectActivity("Antrenament la sală"), "gym");
  assertEquals(detectActivity("Read 20 pages"), "reading");
  assertEquals(detectActivity("Citesc 20 de pagini"), "reading");
  assertEquals(detectActivity("Învăț pentru examen"), "studying");
  assertEquals(detectActivity("Healthy lunch"), "eating");
  assertEquals(detectActivity("Up at 05:00"), "wake_up");
  assertEquals(detectActivity("Trezire la 6"), "wake_up");
  assertEquals(detectActivity("Breadth of focus"), "general"); // "read" inside a word does not count
  assertEquals(detectActivity("Something", "fitness"), "gym");
  assertEquals(activityOf({ activity: "reading", title: "Gym" }), "reading");
});

Deno.test("requirements per level: Standard one live photo; Strict two live + optional screenshot; Elite screenshot required", () => {
  assertEquals(requirementsFor("gym", "standard").map((r) => [r.id, r.kind, r.required]), [["training", "live", true]]);
  assertEquals(requirementsFor("gym", "strict").map((r) => [r.id, r.kind, r.required]), [["training", "live", true], ["environment", "live", true], ["tracker", "screenshot", false]]);
  assertEquals(requirementsFor("running", "elite").map((r) => r.required), [true, true, true]);
  for (const a of ["gym", "running", "reading", "studying", "eating", "wake_up", "general"] as const) {
    for (const r of requirementsFor(a, "elite")) assert(r.label.en && r.label.ro && r.check);
  }
});

// ---------- engine ----------

const baseInput = (over: Partial<EngineInput> = {}): EngineInput => ({
  commitment: { title: "Gym workout", description: null, proofHint: "Me at the gym" },
  activity: "gym", level: "strict", localTargetTime: "18:00", localReceivedTime: "18:04", language: "en",
  images: [{ kind: "live", base64: "AAAA" }, { kind: "live", base64: "BBBB" }],
  ...over,
});
const answer = (over: Record<string, unknown> = {}) => ({
  status: "VERIFIED", confidence: 0.92, summary: "Gym session.", consistency: "Same gym.", explanation: "You are training at a gym.", next_action: "",
  evidence: [{ image: 1, shows: "person squatting", relevant: true, concerns: "" }, { image: 2, shows: "racks", relevant: true, concerns: "" }],
  requirements: [{ id: "training", satisfied: true, image: 1, note: "" }, { id: "environment", satisfied: true, image: 2, note: "" }, { id: "tracker", satisfied: false, image: 0, note: "" }],
  ...over,
});

Deno.test("engine prompt: activity guide, requirement ids, server time, evidence labels, language", () => {
  const req = buildEngineRequest(baseInput({ language: "ro", notes: ["Image 2 is nearly identical to evidence from 3 Nov."] }), requirementsFor("gym", "strict"));
  const text = JSON.stringify(req.parts);
  assert(text.includes("GYM:") && text.includes("training (live photo, REQUIRED)") && text.includes("tracker (screenshot, optional)"));
  assert(text.includes("Server received the evidence at 18:04") && text.includes("nearly identical") && text.includes("in Romanian"));
  assert(text.includes("Image 1: LIVE photo") && req.parts.filter((p) => "image" in p).length === 2);
  assertEquals(req.feature, "verify");
  assertEquals(buildEngineRequest(baseInput({ appeal: { firstExplanation: "Desk only", note: "look at the mirror" } }), []).feature, "appeal");
});

Deno.test("engine: a confident VERIFIED with every requirement met stays VERIFIED", () => {
  const a = finalizeAnalysis(answer(), baseInput(), requirementsFor("gym", "strict"));
  assertEquals([a.status, a.missing.length, a.next_action], ["VERIFIED", 0, ""]);
  assertEquals(a.requirements.map((r) => r.satisfied), [true, true, false]);
});

Deno.test("engine: VERIFIED with a required item missing becomes NEEDS_MORE_EVIDENCE", () => {
  const a = finalizeAnalysis(answer({ requirements: [{ id: "training", satisfied: true, image: 1, note: "" }, { id: "environment", satisfied: false, image: 0, note: "not visible" }] }),
    baseInput(), requirementsFor("gym", "strict"));
  assertEquals(a.status, "NEEDS_MORE_EVIDENCE");
  assertEquals(a.missing, ["The gym or the equipment you used"]);
  assert(a.next_action.length > 0 && a.explanation.includes("no penalty"));
});

Deno.test("engine: a requirement can't be met by a missing image or an image of the wrong kind", () => {
  const a = finalizeAnalysis(answer({ requirements: [{ id: "training", satisfied: true, image: 5, note: "" }, { id: "environment", satisfied: true, image: 2, note: "" }] }),
    baseInput(), requirementsFor("gym", "strict"));
  assertEquals([a.status, a.requirements[0].satisfied], ["NEEDS_MORE_EVIDENCE", false]);
  const elite = finalizeAnalysis(answer({ requirements: [{ id: "training", satisfied: true, image: 1, note: "" }, { id: "environment", satisfied: true, image: 2, note: "" }, { id: "tracker", satisfied: true, image: 2, note: "" }] }),
    baseInput({ level: "elite" }), requirementsFor("gym", "elite"));
  assertEquals([elite.status, elite.requirements[2].satisfied], ["NEEDS_MORE_EVIDENCE", false]); // image 2 is a live photo, not a screenshot
});

Deno.test("engine: one photo can't satisfy two requirements (seen live with Gemini on a strict 1-photo submission)", () => {
  const a = finalizeAnalysis(answer({
    evidence: [{ image: 1, shows: "overhead press in a gym", relevant: true, concerns: "" }],
    requirements: [{ id: "training", satisfied: true, image: 1, note: "" }, { id: "environment", satisfied: true, image: 1, note: "gym visible" }, { id: "tracker", satisfied: false, image: 0, note: "" }],
  }), baseInput({ images: [{ kind: "live", base64: "AAAA" }] }), requirementsFor("gym", "strict"));
  assertEquals(a.status, "NEEDS_MORE_EVIDENCE");
  assertEquals(a.requirements.map((r) => r.satisfied), [true, false, false]);
  assertEquals([a.missing, a.requirements[1].note], [["The gym or the equipment you used"], "Needs a separate photo."]);
});

Deno.test("engine: uncertainty never penalizes — low-confidence REJECTED or VERIFIED become NEEDS_MORE_EVIDENCE", () => {
  assertEquals(finalizeAnalysis(answer({ status: "REJECTED", confidence: 0.6 }), baseInput(), requirementsFor("gym", "strict")).status, "NEEDS_MORE_EVIDENCE");
  assertEquals(finalizeAnalysis(answer({ status: "REJECTED", confidence: 0.95 }), baseInput(), requirementsFor("gym", "strict")).status, "REJECTED");
  assertEquals(finalizeAnalysis(answer({ confidence: 0.7 }), baseInput(), requirementsFor("gym", "strict")).status, "NEEDS_MORE_EVIDENCE");
  assertEquals(finalizeAnalysis(answer({ confidence: 0.78 }), baseInput({ level: "elite" }), requirementsFor("gym", "elite")).status, "NEEDS_MORE_EVIDENCE");
});

Deno.test("engine end to end with a fake provider: usage and validated analysis come back", async () => {
  const fake: typeof fetch = () => respond(200, gem(JSON.stringify(answer())));
  const { analysis, result } = await analyzeEvidence(baseInput(), { config: cfg, fetchImpl: fake });
  assertEquals([analysis.status, result.usage.input, result.model], ["VERIFIED", 1200, "gemini-test"]);
});

Deno.test("Gemini body never contains anything but the request (no key, no stray fields)", () => {
  const b = buildGeminiBody({ feature: "verify", system: "s", parts: [{ text: "t" }] });
  assertEquals(Object.keys(b).sort(), ["contents", "generationConfig", "systemInstruction"]);
});
