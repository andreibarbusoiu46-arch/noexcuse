// Internal (cron secret only): runs the real verification engine against real images fetched from
// URLs, without touching any user, proof or points. Used to test the live Gemini integration.
// POST { model?, language?, cases: [{ name, title, proof_hint?, activity?, level, images: [{ kind, url }] }] }
import { activityOf, isActivity } from "../../../src/shared/activity.ts";
import { encodeBase64 } from "../_shared/b64.ts";
import { analyzeEvidence } from "../_shared/engine.ts";
import { adminClient, json } from "../_shared/http.ts";
import { isInternal } from "../_shared/internal.ts";
import { LlmError, llmConfig, recordUsage } from "../_shared/llm.ts";
import { isLevel } from "../_shared/rules.ts";

type ImageSpec = { kind: "live" | "screenshot"; url?: string; commons?: string };
type Case = { name: string; title: string; proof_hint?: string; activity?: string; level?: string; images: ImageSpec[] };

/** Finds a JPEG on Wikimedia Commons by search terms and returns a 1024 px thumbnail URL and its title. */
async function commonsImage(query: string): Promise<{ url: string; title: string } | null> {
  const api = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=8&gsrsearch=${encodeURIComponent(query + " filetype:bitmap")}&prop=imageinfo&iiprop=url|mime&iiurlwidth=1024`;
  const r = await fetch(api, { headers: { "user-agent": UA } });
  const j = await r.json().catch(() => null) as { query?: { pages?: Record<string, { index?: number; title: string; imageinfo?: { mime: string; thumburl?: string }[] }> } } | null;
  const pages = Object.values(j?.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const hit = pages.find((p) => p.imageinfo?.[0]?.mime === "image/jpeg" && p.imageinfo[0].thumburl);
  return hit ? { url: hit.imageinfo![0].thumburl!, title: hit.title } : null;
}

const UA = "NoExcuseSelfTest/1.0 (https://noexcuse.vercel.app; verification test)";

async function fetchImage(url: string): Promise<{ base64: string; mimeType: "image/jpeg" | "image/png" | "image/webp" } | string> {
  const r = await fetch(url, { headers: { "user-agent": UA } });
  if (!r.ok) return `fetch ${r.status}`;
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length > 6_000_000) return "too large";
  const mime = bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : bytes[0] === 0x89 && bytes[1] === 0x50 ? "image/png" : bytes[8] === 0x57 && bytes[9] === 0x45 ? "image/webp" : null;
  if (!mime) return "not an image";
  return { base64: encodeBase64(bytes), mimeType: mime };
}

Deno.serve(async (req) => {
  const db = adminClient();
  if (!(await isInternal(req, db))) return json(401, { error: "unauthorized" });
  const body = await req.json().catch(() => ({})) as { model?: string; language?: "en" | "ro"; cases?: Case[] };
  let config;
  try {
    config = llmConfig("verify");
    if (body.model) config = { ...config, model: body.model };
  } catch (e) {
    return json(200, { config_error: e instanceof LlmError ? e.code : String(e) });
  }
  const results = [];
  for (const c of (body.cases ?? []).slice(0, 8)) {
    const images = [];
    const sources: string[] = [];
    for (const im of c.images.slice(0, 4)) {
      let url = im.url;
      if (!url && im.commons) {
        const hit = await commonsImage(im.commons);
        if (!hit) { images.length = 0; results.push({ name: c.name, error: `no Commons image for "${im.commons}"` }); break; }
        url = hit.url;
        sources.push(hit.title);
      } else if (url) sources.push(url);
      const f = await fetchImage(url!);
      if (typeof f === "string") { images.length = 0; results.push({ name: c.name, error: `image: ${f}` }); break; }
      images.push({ kind: im.kind, base64: f.base64, mimeType: f.mimeType });
    }
    if (!images.length) continue;
    const activity = isActivity(c.activity) ? c.activity : activityOf({ title: c.title, proof_hint: c.proof_hint });
    const level = isLevel(c.level) ? c.level : "standard";
    try {
      const { analysis, result } = await analyzeEvidence({
        commitment: { title: c.title, proofHint: c.proof_hint ?? null }, activity, level, images,
        localTargetTime: "18:00", localReceivedTime: "18:03", language: body.language ?? "en",
      }, { config });
      await recordUsage(db, { userId: null, feature: "selftest", result });
      results.push({ name: c.name, sources, model: result.model, activity, level, status: analysis.status, model_status: analysis.model_status,
        confidence: analysis.confidence, summary: analysis.summary, missing: analysis.missing, requirements: analysis.requirements.map((r) => `${r.id}:${r.satisfied ? "ok" : "missing"}`),
        evidence: analysis.evidence.map((e) => e.shows), explanation: analysis.explanation, next_action: analysis.next_action,
        usage: result.usage, latency_ms: result.latencyMs, attempts: result.attempts });
    } catch (e) {
      await recordUsage(db, { userId: null, feature: "selftest", error: e });
      results.push({ name: c.name, error: e instanceof LlmError ? `${e.code}: ${e.message}` : String(e) });
    }
  }
  return json(200, { provider: config.provider, model: config.model, results });
});
