// One server-side entry point for every AI call (proof verification, appeals, coach, challenge
// generator). Gemini is the default provider; OpenAI stays as an optional fallback.
// API keys are read from the function environment only and never leave the server.
// Nothing here logs prompts, images or answers — only status codes, timings and token counts.

export type Provider = "gemini" | "openai";
export type Feature = "verify" | "appeal" | "coach" | "generate" | "selftest";

export type LlmPart = { text: string } | { image: { mimeType: "image/jpeg" | "image/png" | "image/webp"; base64: string } };

export interface JsonSchema {
  type: "object" | "array" | "string" | "number" | "integer" | "boolean";
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  maxItems?: number;
  description?: string;
}

export interface LlmRequest {
  feature: Feature;
  system: string;
  /** Earlier turns (coach only). */
  history?: { role: "user" | "model"; text: string }[];
  parts: LlmPart[];
  /** When set, the model must answer with JSON matching it; the answer is validated here too. */
  schema?: JsonSchema;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface Usage { input: number | null; output: number | null; thinking: number | null; total: number | null }

export interface LlmResult {
  text: string;
  json: unknown;
  provider: Provider;
  model: string;
  usage: Usage;
  latencyMs: number;
  attempts: number;
}

export type LlmErrorCode =
  | "config" // no API key / provider configured
  | "auth" // key rejected
  | "quota" // quota or billing exhausted — retrying won't help now
  | "rate_limit" // too many requests — retry later
  | "bad_request" // our request was rejected (model name, schema…)
  | "blocked" // safety filter blocked the prompt or answer
  | "timeout"
  | "network"
  | "server" // provider 5xx
  | "invalid_output"; // answer missing, truncated or not matching the schema

export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly provider?: Provider,
    readonly model?: string,
    readonly usage?: Usage,
    readonly attempts = 1,
  ) {
    super(message);
  }
}

// ---------- configuration ----------

export interface LlmConfig { provider: Provider; model: string; apiKey: string }

const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";

/** Gemini when GEMINI_API_KEY is set (or AI_PROVIDER=gemini), otherwise OpenAI if configured. */
export function llmConfig(feature: Feature, env: (k: string) => string | undefined = (k) => Deno.env.get(k)): LlmConfig {
  const forced = env("AI_PROVIDER");
  const gemini = env("GEMINI_API_KEY")?.trim();
  const openai = env("OPENAI_API_KEY")?.trim();
  const pick: Provider | null = forced === "gemini" || forced === "openai" ? forced : gemini ? "gemini" : openai ? "openai" : null;
  if (pick === "gemini") {
    if (!gemini) throw new LlmError("config", "GEMINI_API_KEY is not set", false, undefined, "gemini");
    const model = env(`GEMINI_MODEL_${feature.toUpperCase()}`) ?? env("GEMINI_MODEL") ?? DEFAULT_GEMINI_MODEL;
    return { provider: "gemini", model, apiKey: gemini };
  }
  if (pick === "openai") {
    if (!openai) throw new LlmError("config", "OPENAI_API_KEY is not set", false, undefined, "openai");
    return { provider: "openai", model: env("OPENAI_MODEL") ?? "gpt-5-mini", apiKey: openai };
  }
  throw new LlmError("config", "No AI provider is configured (set GEMINI_API_KEY)", false);
}

// ---------- schema validation ----------

/** Strict validation of a parsed JSON value against our schema subset. Returns the first problem, or null. */
export function validateSchema(schema: JsonSchema, value: unknown, path = "$"): string | null {
  switch (schema.type) {
    case "object": {
      if (!value || typeof value !== "object" || Array.isArray(value)) return `${path} is not an object`;
      const o = value as Record<string, unknown>;
      for (const k of schema.required ?? []) if (!(k in o)) return `${path}.${k} is missing`;
      for (const k of Object.keys(o)) if (!schema.properties?.[k]) return `${path}.${k} is not allowed`;
      for (const [k, s] of Object.entries(schema.properties ?? {})) {
        if (k in o) {
          const e = validateSchema(s, o[k], `${path}.${k}`);
          if (e) return e;
        }
      }
      return null;
    }
    case "array": {
      if (!Array.isArray(value)) return `${path} is not an array`;
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${path} has too many items`;
      for (let i = 0; i < value.length; i++) {
        const e = validateSchema(schema.items!, value[i], `${path}[${i}]`);
        if (e) return e;
      }
      return null;
    }
    case "string":
      if (typeof value !== "string") return `${path} is not a string`;
      if (schema.enum && !schema.enum.includes(value)) return `${path} is not one of ${schema.enum.join("/")}`;
      return null;
    case "number":
    case "integer":
      if (typeof value !== "number" || !Number.isFinite(value)) return `${path} is not a number`;
      if (schema.type === "integer" && !Number.isInteger(value)) return `${path} is not an integer`;
      if (schema.minimum !== undefined && value < schema.minimum) return `${path} is below ${schema.minimum}`;
      if (schema.maximum !== undefined && value > schema.maximum) return `${path} is above ${schema.maximum}`;
      return null;
    case "boolean":
      return typeof value === "boolean" ? null : `${path} is not a boolean`;
  }
}

// ---------- Gemini (REST generateContent) ----------

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Gemini's older responseSchema dialect: upper-case types, no additionalProperties. */
function toGeminiSchema(s: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = { type: s.type.toUpperCase() };
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum;
  if (s.minimum !== undefined) out.minimum = s.minimum;
  if (s.maximum !== undefined) out.maximum = s.maximum;
  if (s.maxItems !== undefined) out.maxItems = String(s.maxItems);
  if (s.items) out.items = toGeminiSchema(s.items);
  if (s.properties) {
    out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
    out.required = s.required ?? [];
    out.propertyOrdering = Object.keys(s.properties);
  }
  return out;
}

/** JSON Schema with additionalProperties: false everywhere (for responseJsonSchema). */
function toJsonSchema(s: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = { ...s };
  if (s.items) out.items = toJsonSchema(s.items);
  if (s.properties) {
    out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toJsonSchema(v)]));
    out.additionalProperties = false;
  }
  return out;
}

export function buildGeminiBody(req: LlmRequest, schemaDialect: "json" | "legacy" = "json") {
  const parts = req.parts.map((p) => ("text" in p ? { text: p.text } : { inlineData: { mimeType: p.image.mimeType, data: p.image.base64 } }));
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: req.maxOutputTokens ?? 2048,
    temperature: req.temperature ?? 0.2,
  };
  if (req.schema) {
    generationConfig.responseMimeType = "application/json";
    if (schemaDialect === "json") generationConfig.responseJsonSchema = toJsonSchema(req.schema);
    else generationConfig.responseSchema = toGeminiSchema(req.schema);
  }
  return {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [
      ...(req.history ?? []).map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
      { role: "user", parts },
    ],
    generationConfig,
  };
}

type GeminiError = { error?: { code?: number; message?: string; status?: string; details?: Array<Record<string, unknown>> } };

/** Maps a Gemini HTTP error to our error codes. 429 is a quota error when a quota limit was hit. */
export function classifyGeminiError(status: number, body: unknown): { code: LlmErrorCode; retryable: boolean; retryAfterMs?: number; message: string } {
  const e = (body as GeminiError | null)?.error;
  const msg = `gemini http ${status}${e?.status ? ` ${e.status}` : ""}`;
  const details = e?.details ?? [];
  const retryInfo = details.find((d) => String(d["@type"] ?? "").endsWith("RetryInfo"));
  const delay = typeof retryInfo?.retryDelay === "string" ? Math.round(parseFloat(retryInfo.retryDelay) * 1000) : undefined;
  if (status === 429) {
    const quota = details.find((d) => String(d["@type"] ?? "").endsWith("QuotaFailure")) as { violations?: Array<{ quotaId?: string; quotaMetric?: string }> } | undefined;
    const ids = (quota?.violations ?? []).map((v) => `${v.quotaId ?? ""} ${v.quotaMetric ?? ""}`).join(" ");
    // Daily or billing quotas won't recover within this request; per-minute limits will.
    const daily = /PerDay|per_day|billing/i.test(ids) || (/billing|exceeded your current quota/i.test(e?.message ?? "") && !/PerMinute|per_minute/i.test(ids));
    return daily ? { code: "quota", retryable: false, message: msg } : { code: "rate_limit", retryable: true, retryAfterMs: delay, message: msg };
  }
  if (status === 401 || status === 403) return { code: "auth", retryable: false, message: msg };
  if (status === 400 && /API key/i.test(e?.message ?? "")) return { code: "auth", retryable: false, message: msg };
  if (status === 400 || status === 404) return { code: "bad_request", retryable: false, message: `${msg}: ${(e?.message ?? "").slice(0, 160)}` };
  if (status === 408 || status === 504) return { code: "timeout", retryable: true, message: msg };
  if (status >= 500) return { code: "server", retryable: true, retryAfterMs: delay, message: msg };
  return { code: "server", retryable: false, message: msg };
}

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number };
  modelVersion?: string;
};

export function geminiUsage(r: GeminiResponse | null): Usage {
  const u = r?.usageMetadata;
  return { input: u?.promptTokenCount ?? null, output: u?.candidatesTokenCount ?? null, thinking: u?.thoughtsTokenCount ?? null, total: u?.totalTokenCount ?? null };
}

/** Extracts the answer text from a Gemini response, or throws a classified error. */
export function parseGeminiResponse(r: GeminiResponse | null): string {
  if (!r) throw new LlmError("invalid_output", "empty response", true);
  if (r.promptFeedback?.blockReason) throw new LlmError("blocked", `prompt blocked: ${r.promptFeedback.blockReason}`, false);
  const c = r.candidates?.[0];
  if (!c) throw new LlmError("invalid_output", "no candidate", true);
  const reason = c.finishReason ?? "STOP";
  if (["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "IMAGE_SAFETY", "RECITATION"].includes(reason)) {
    throw new LlmError("blocked", `answer blocked: ${reason}`, false);
  }
  const text = (c.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("").trim();
  if (reason === "MAX_TOKENS") throw new LlmError("invalid_output", "answer truncated (MAX_TOKENS)", true);
  if (!text) throw new LlmError("invalid_output", `no text (finish ${reason})`, true);
  return text;
}

// ---------- OpenAI (Responses API), optional fallback ----------

function buildOpenAiBody(req: LlmRequest, model: string) {
  const content = req.parts.map((p) =>
    "text" in p ? { type: "input_text", text: p.text } : { type: "input_image", image_url: `data:${p.image.mimeType};base64,${p.image.base64}`, detail: "high" }
  );
  const body: Record<string, unknown> = {
    model,
    input: [
      { role: "system", content: [{ type: "input_text", text: req.system }] },
      ...(req.history ?? []).map((h) =>
        h.role === "user" ? { role: "user", content: [{ type: "input_text", text: h.text }] } : { role: "assistant", content: [{ type: "output_text", text: h.text }] }
      ),
      { role: "user", content },
    ],
    max_output_tokens: req.maxOutputTokens ?? 2048,
    store: false,
  };
  if (req.schema) body.text = { format: { type: "json_schema", name: "result", strict: true, schema: toJsonSchema(req.schema) } };
  return body;
}

function parseOpenAi(raw: unknown): { text: string; usage: Usage } {
  const p = raw as { status?: string; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>; usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number; output_tokens_details?: { reasoning_tokens?: number } } };
  const usage: Usage = { input: p?.usage?.input_tokens ?? null, output: p?.usage?.output_tokens ?? null, thinking: p?.usage?.output_tokens_details?.reasoning_tokens ?? null, total: p?.usage?.total_tokens ?? null };
  if (!p || !Array.isArray(p.output)) throw new LlmError("invalid_output", "malformed response", true);
  let text = "";
  for (const item of p.output) {
    for (const c of item.content ?? []) {
      if (c.type === "refusal") throw new LlmError("blocked", "model refused", false);
      if (c.type === "output_text" && typeof c.text === "string") text += c.text;
    }
  }
  if (!text.trim()) throw new LlmError("invalid_output", `no text (status ${p.status})`, true);
  return { text: text.trim(), usage };
}

// ---------- the call, with timeout and retries ----------

export interface CallOptions {
  config?: LlmConfig;
  fetchImpl?: typeof fetch;
  /** Per attempt. */
  timeoutMs?: number;
  /** Total attempts (1 = no retry). */
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

export async function llmCall(req: LlmRequest, opts: CallOptions = {}): Promise<LlmResult> {
  const cfg = opts.config ?? llmConfig(req.feature);
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxAttempts = opts.maxAttempts ?? 3;
  const started = Date.now();
  let dialect: "json" | "legacy" = "json";
  let last: LlmError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 40_000);
    let usage: Usage | undefined;
    try {
      let text: string;
      if (cfg.provider === "gemini") {
        const res = await doFetch(`${GEMINI_BASE}/models/${encodeURIComponent(cfg.model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": cfg.apiKey },
          body: JSON.stringify(buildGeminiBody(req, dialect)),
          signal: ctrl.signal,
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          const c = classifyGeminiError(res.status, body);
          // Older API versions only know responseSchema: switch dialect once and retry immediately.
          if (c.code === "bad_request" && dialect === "json" && /responseJsonSchema|response_json_schema|Unknown name/i.test(JSON.stringify(body))) {
            dialect = "legacy";
            attempt--;
            continue;
          }
          throw Object.assign(new LlmError(c.code, c.message, c.retryable, res.status, cfg.provider, cfg.model), { retryAfterMs: c.retryAfterMs });
        }
        usage = geminiUsage(body);
        text = parseGeminiResponse(body);
      } else {
        const res = await doFetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify(buildOpenAiBody(req, cfg.model)),
          signal: ctrl.signal,
        });
        const raw = await res.json().catch(() => null);
        if (!res.ok) {
          const code = (raw as { error?: { code?: string } } | null)?.error?.code;
          if (res.status === 429 && (code === "insufficient_quota" || code === "credit_balance_exhausted")) throw new LlmError("quota", `openai http 429 ${code}`, false, 429, "openai", cfg.model);
          if (res.status === 429) throw new LlmError("rate_limit", "openai http 429", true, 429, "openai", cfg.model);
          if (res.status === 401 || res.status === 403) throw new LlmError("auth", `openai http ${res.status}`, false, res.status, "openai", cfg.model);
          if (res.status >= 500) throw new LlmError("server", `openai http ${res.status}`, true, res.status, "openai", cfg.model);
          throw new LlmError("bad_request", `openai http ${res.status}`, false, res.status, "openai", cfg.model);
        }
        const o = parseOpenAi(raw);
        usage = o.usage;
        text = o.text;
      }

      let json: unknown = null;
      if (req.schema) {
        try {
          json = JSON.parse(text);
        } catch {
          throw new LlmError("invalid_output", "answer is not JSON", true);
        }
        const problem = validateSchema(req.schema, json);
        if (problem) throw new LlmError("invalid_output", `schema: ${problem}`, true);
      }
      return { text, json, provider: cfg.provider, model: cfg.model, usage: usage ?? { input: null, output: null, thinking: null, total: null }, latencyMs: Date.now() - started, attempts: attempt };
    } catch (e) {
      const err = e instanceof LlmError
        ? e
        : ctrl.signal.aborted
        ? new LlmError("timeout", "request timed out", true)
        : new LlmError("network", e instanceof Error ? e.message.slice(0, 120) : "network error", true);
      last = new LlmError(err.code, err.message, err.retryable, err.status, cfg.provider, cfg.model, usage ?? err.usage, attempt);
      if (!err.retryable || attempt >= maxAttempts) break;
      const hinted = (e as { retryAfterMs?: number }).retryAfterMs;
      await sleep(Math.min(hinted ?? 1000 * 3 ** (attempt - 1), 8000));
    } finally {
      clearTimeout(timer);
    }
  }
  throw last ?? new LlmError("server", "unknown failure", true);
}

// ---------- usage accounting ----------

type Db = { from: (t: string) => { insert: (row: Record<string, unknown>) => PromiseLike<{ error: unknown }> } };

/** One row per AI call (success or failure). Never contains prompts, images or answers. */
export async function recordUsage(
  db: Db,
  row: { userId: string | null; feature: Feature; result?: LlmResult; error?: unknown; refId?: string | null },
): Promise<void> {
  const r = row.result;
  const e = row.error instanceof LlmError ? row.error : null;
  const u = r?.usage ?? e?.usage;
  let provider: string | null = r?.provider ?? e?.provider ?? null;
  let model: string | null = r?.model ?? e?.model ?? null;
  if (!provider) {
    try {
      const c = llmConfig(row.feature);
      provider = c.provider;
      model = c.model;
    } catch { /* not configured */ }
  }
  await db.from("ai_usage").insert({
    user_id: row.userId,
    feature: row.feature,
    provider,
    model,
    status: r ? "ok" : e?.code ?? "error",
    http_status: e?.status ?? null,
    input_tokens: u?.input ?? null,
    output_tokens: u?.output ?? null,
    thinking_tokens: u?.thinking ?? null,
    total_tokens: u?.total ?? null,
    latency_ms: r?.latencyMs ?? null,
    attempts: r?.attempts ?? e?.attempts ?? 1,
    ref_id: row.refId ?? null,
  }).then(() => undefined, () => undefined);
}
