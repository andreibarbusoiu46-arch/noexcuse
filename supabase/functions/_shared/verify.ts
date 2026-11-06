// One verification pipeline, used by verify-proof (live) and cron-tick (retries).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { activityOf } from "../../../src/shared/activity.ts";
import { type Analysis, analyzeEvidence, type EngineImage, OUTCOME } from "./engine.ts";
import { LlmError, llmConfig, recordUsage } from "./llm.ts";
import { formatLocalTime, isLevel, isMilestone, type Level } from "./rules.ts";
import { copy, notifyOnce } from "./push.ts";

export interface VerdictResult {
  proof_id: string;
  outcome: "verified" | "rejected" | "insufficient" | "expired" | "error";
  verified: boolean;
  critique: string;
  points_delta: number;
  streak: number;
  total_points: number;
  target_status: string;
  already_settled: boolean;
  level: Level;
  /** When more evidence is needed: exactly what to capture next. */
  requested_evidence: string | null;
  /** The validated AI analysis (null when the AI could not run). */
  analysis: Analysis | null;
  /** Why the AI could not run (no penalty in every case). */
  error_code?: string;
}

/** Messages when the AI could not give an answer. Each one says what is true: nothing is deducted. */
function unavailableText(code: string, ro: boolean): string {
  const t = {
    config: ["Verification isn’t configured on the server yet. Your proof is saved with its capture time and nothing is deducted; it will be checked once the AI is available, or the target is excused.",
      "Verificarea nu e încă configurată pe server. Dovada ta e salvată cu ora capturii și nu se scade nimic; o verificăm când AI-ul e disponibil, altfel obiectivul e scuzat."],
    quota: ["The AI service has reached its usage limit. Your proof is saved and nothing is deducted. We’ll retry; if it still can’t be checked, this target is excused.",
      "Serviciul AI și-a atins limita de utilizare. Dovada ta e salvată și nu se scade nimic. Reîncercăm; dacă tot nu poate fi verificată, obiectivul e scuzat."],
    blocked: ["The AI service declined to analyse these images. Nothing is deducted. We’ll retry; if it still can’t be checked, this target is excused.",
      "Serviciul AI a refuzat să analizeze aceste imagini. Nu se scade nimic. Reîncercăm; dacă tot nu poate fi verificată, obiectivul e scuzat."],
    other: ["The AI check didn’t give a valid answer. Your proof is saved with its capture time and nothing is deducted. We’ll retry shortly; if it still can’t be checked, this target is excused.",
      "Verificarea AI n-a dat un răspuns valid. Dovada ta e salvată cu ora capturii și nu se scade nimic. Reîncercăm curând; dacă tot nu poate fi verificată, obiectivul e scuzat."],
  } as const;
  const k = code === "config" || code === "quota" || code === "blocked" ? code : "other";
  return t[k][ro ? 1 : 0];
}

export async function judgeAndApply(db: SupabaseClient, proofId: string, images: EngineImage[], notes: string[] = []): Promise<VerdictResult> {
  const { data: proof, error } = await db
    .from("proofs")
    .select("id, user_id, received_at, level, target:targets!inner(id, due_at, habit:habits!inner(id, title, proof_hint, description, category, activity, longest_streak, challenge:challenges!habits_challenge_id_fkey(title, rules))), profile:profiles!inner(timezone, language)")
    .eq("id", proofId)
    .single();
  if (error || !proof) throw new Error(`proof ${proofId} not found`);
  // deno-lint-ignore no-explicit-any
  const p = proof as any;
  const tz: string = p.profile.timezone;
  const ro = p.profile.language === "ro";
  const level: Level = isLevel(p.level) ? p.level : "standard";
  const habit = p.target.habit;

  let outcome: VerdictResult["outcome"];
  let critique: string;
  let confidence: number | null = null;
  let raw: unknown = null;
  let analysis: Analysis | null = null;
  let requested: string | null = null;
  let errorCode: string | undefined;
  let model: string | null = null;
  try {
    model = llmConfig("verify").model;
  } catch { /* reported below */ }
  try {
    const { analysis: a, result } = await analyzeEvidence({
      commitment: { title: habit.title, description: habit.description, proofHint: habit.proof_hint },
      challenge: habit.challenge ? { title: habit.challenge.title, rules: habit.challenge.rules } : null,
      activity: activityOf(habit),
      level,
      images,
      localTargetTime: formatLocalTime(new Date(p.target.due_at), tz),
      localReceivedTime: formatLocalTime(new Date(p.received_at), tz),
      notes,
      language: ro ? "ro" : "en",
    });
    await recordUsage(db, { userId: p.user_id, feature: "verify", result, refId: proofId });
    analysis = { ...a, provider: result.provider, model: result.model } as Analysis;
    model = result.model;
    outcome = OUTCOME[a.status];
    confidence = a.confidence;
    critique = a.explanation;
    if (outcome === "insufficient") requested = a.next_action.slice(0, 300) || null;
    raw = { provider: result.provider, model: result.model, usage: result.usage, attempts: result.attempts, model_status: a.model_status, notes };
  } catch (e) {
    await recordUsage(db, { userId: p.user_id, feature: "verify", error: e, refId: proofId });
    outcome = "error";
    errorCode = e instanceof LlmError ? e.code : "error";
    critique = unavailableText(errorCode, ro);
    // Only codes and status — never the evidence or the model's text.
    raw = { error: errorCode, status: e instanceof LlmError ? e.status ?? null : null, message: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200) };
  }

  const before = outcome === "verified" ? await myRank(db, p.user_id) : null;
  const { data: applied, error: applyErr } = await db.rpc("apply_verdict", {
    p_proof_id: proofId, p_outcome: outcome, p_critique: critique, p_confidence: confidence, p_model: model, p_raw: raw,
  });
  if (applyErr) throw new Error(`apply_verdict: ${applyErr.message}`);
  await db.from("proofs").update({ requested_evidence: requested, analysis }).eq("id", proofId);
  const a = applied as { points_delta: number; streak: number; total_points: number; target_status: string; already_settled: boolean };

  if (outcome === "verified" && !a.already_settled) {
    await notifyOnce(db, p.user_id, "verified", p.target.id, copy.verified(habit.title, a.streak));
    if (isMilestone(a.streak, habit.longest_streak)) {
      await notifyOnce(db, p.user_id, "milestone", p.target.id, copy.milestone(a.streak));
    }
    const after = await myRank(db, p.user_id);
    if (after !== null && after <= 10 && (before === null || after < before)) {
      await notifyOnce(db, p.user_id, "arena_up", p.target.id, copy.arena_up(after));
    }
  }

  return {
    proof_id: proofId,
    outcome,
    verified: outcome === "verified" && !a.already_settled,
    critique,
    points_delta: a.points_delta,
    streak: a.streak,
    total_points: a.total_points,
    target_status: a.target_status,
    already_settled: a.already_settled,
    level,
    requested_evidence: requested,
    analysis,
    error_code: errorCode,
  };
}

async function myRank(db: SupabaseClient, userId: string): Promise<number | null> {
  const { data } = await db.rpc("get_arena", { p_day: null, p_limit: 100 });
  const row = (data as Array<{ user_id: string; rank: number }> | null)?.find((r) => r.user_id === userId);
  return row?.rank ?? null;
}
