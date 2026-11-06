// Internal diagnostic (cron secret only): is an AI provider configured, which Gemini models can the
// key use, and does a tiny structured request succeed? Returns status codes and model names only —
// never the key.
import { adminClient, json } from "../_shared/http.ts";
import { isInternal } from "../_shared/internal.ts";
import { LlmError, llmCall, llmConfig } from "../_shared/llm.ts";

Deno.serve(async (req) => {
  const db = adminClient();
  if (!(await isInternal(req, db))) return json(401, { error: "unauthorized" });
  const out: Record<string, unknown> = { gemini_key_present: !!Deno.env.get("GEMINI_API_KEY"), openai_key_present: !!Deno.env.get("OPENAI_API_KEY") };
  let cfg;
  try {
    cfg = llmConfig("selftest");
    out.provider = cfg.provider;
    out.model = cfg.model;
  } catch (e) {
    out.config_error = e instanceof Error ? e.message : String(e);
    return json(200, out);
  }
  if (cfg.provider === "gemini") {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": cfg.apiKey } });
    const body = await r.json().catch(() => null) as { models?: Array<{ name: string; supportedGenerationMethods?: string[]; inputTokenLimit?: number }> } | null;
    out.list_models_status = r.status;
    out.models = (body?.models ?? []).filter((m) => m.supportedGenerationMethods?.includes("generateContent")).map((m) => m.name.replace(/^models\//, ""));
  }
  try {
    const res = await llmCall({
      feature: "selftest",
      system: "Answer with the JSON requested.",
      parts: [{ text: "Return ok=true and the number 7." }],
      schema: { type: "object", required: ["ok", "n"], properties: { ok: { type: "boolean" }, n: { type: "integer" } } },
      maxOutputTokens: 200,
    }, { maxAttempts: 1, timeoutMs: 20_000 });
    out.test = { ok: true, json: res.json, usage: res.usage, latency_ms: res.latencyMs };
  } catch (e) {
    out.test = e instanceof LlmError ? { ok: false, code: e.code, status: e.status, message: e.message } : { ok: false, message: String(e) };
  }
  return json(200, out);
});
