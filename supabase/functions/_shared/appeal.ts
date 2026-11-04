// Appeals: one independent AI re-review of a rejected proof. Used by appeal-proof and cron-tick.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { reviewAppeal } from "./ai.ts";
import { loadEvidence, storedNotes } from "./evidence.ts";
import { env } from "./http.ts";
import { copy, notifyOnce } from "./push.ts";
import { appealOverturns, formatLocalTime, isLevel, type Level } from "./rules.ts";

export interface AppealResult {
  appeal_id: string;
  status: "pending" | "upheld" | "overturned" | "unavailable";
  critique: string | null;
  points_delta: number;
  streak?: number;
  total_points?: number;
}

export async function runAppealReview(db: SupabaseClient, appealId: string, notify = true): Promise<AppealResult> {
  const { data, error } = await db.from("appeals")
    .select("id, user_id, note, status, proof:proofs!inner(id, storage_path, received_at, level, critique, target:targets!inner(id, due_at, habit:habits!inner(title, proof_hint, description))), profile:profiles!inner(timezone, language)")
    .eq("id", appealId).single();
  if (error || !data) throw new Error(`appeal ${appealId} not found`);
  // deno-lint-ignore no-explicit-any
  const a = data as any;
  if (a.status !== "pending") return { appeal_id: a.id, status: a.status, critique: null, points_delta: 0 };
  const level: Level = isLevel(a.proof.level) ? a.proof.level : "standard";
  const model = Deno.env.get("OPENAI_APPEAL_MODEL") ?? env("OPENAI_MODEL", "gpt-5-mini");
  const tz: string = a.profile.timezone;

  try {
    const images = await loadEvidence(db, a.proof);
    if (!images) throw new Error("evidence not found in storage");
    const notes = await storedNotes(db, a.user_id, a.proof.target.id, a.proof.id);
    const r = await reviewAppeal({
      habitTitle: a.proof.target.habit.title, proofHint: a.proof.target.habit.proof_hint, description: a.proof.target.habit.description,
      level, localTargetTime: formatLocalTime(new Date(a.proof.target.due_at), tz), localReceivedTime: formatLocalTime(new Date(a.proof.received_at), tz),
      images, notes, firstCritique: a.proof.critique, appealNote: a.note, language: a.profile.language === "ro" ? "ro" : "en",
    }, { apiKey: env("OPENAI_API_KEY"), model, reasoningEffort: Deno.env.get("OPENAI_APPEAL_REASONING_EFFORT") ?? "medium", timeoutMs: 60_000 });
    const overturn = appealOverturns(r.judgement.verdict, r.judgement.confidence, level);
    const { data: res, error: rErr } = await db.rpc("resolve_appeal", {
      p_appeal: a.id, p_overturn: overturn, p_critique: r.judgement.critique, p_confidence: r.judgement.confidence, p_model: model,
      p_raw: { ...(r.raw as object), verdict: r.judgement.verdict, observed: r.judgement.observed },
    });
    if (rErr) throw new Error(`resolve_appeal: ${rErr.message}`);
    const out = res as { status: "upheld" | "overturned"; points_delta: number; streak?: number; total_points?: number };
    if (notify) await notifyOnce(db, a.user_id, "appeal", a.id, copy.appeal(a.proof.target.habit.title, out.status === "overturned", out.points_delta), { targetId: a.proof.target.id });
    return { appeal_id: a.id, status: out.status, critique: r.judgement.critique, points_delta: out.points_delta, streak: out.streak, total_points: out.total_points };
  } catch (e) {
    const { data: st } = await db.rpc("fail_appeal", { p_appeal: a.id, p_raw: { error: e instanceof Error ? e.message : String(e) } });
    if (st === "unavailable" && notify) await notifyOnce(db, a.user_id, "appeal", a.id, copy.appeal_unavailable(a.proof.target.habit.title), { targetId: a.proof.target.id });
    return { appeal_id: a.id, status: st === "unavailable" ? "unavailable" : "pending", critique: null, points_delta: 0 };
  }
}
