// One verification pipeline, used by verify-proof (live) and cron-tick (retries).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { AiError, judgeProof } from "./ai.ts";
import { finalOutcome, formatLocalTime, isMilestone } from "./rules.ts";
import { copy, notifyOnce } from "./push.ts";
import { env } from "./http.ts";

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
}

export async function judgeAndApply(db: SupabaseClient, proofId: string, imageBase64: string): Promise<VerdictResult> {
  const { data: proof, error } = await db
    .from("proofs")
    .select("id, user_id, received_at, target:targets!inner(id, due_at, habit:habits!inner(id, title, proof_hint, longest_streak)), profile:profiles!inner(timezone)")
    .eq("id", proofId)
    .single();
  if (error || !proof) throw new Error(`proof ${proofId} not found`);
  // deno-lint-ignore no-explicit-any
  const p = proof as any;
  const tz: string = p.profile.timezone;

  let outcome: VerdictResult["outcome"];
  let critique: string;
  let confidence: number | null = null;
  let raw: unknown = null;
  const model = env("OPENAI_MODEL", "gpt-5-mini");
  try {
    const r = await judgeProof(
      {
        habitTitle: p.target.habit.title,
        proofHint: p.target.habit.proof_hint,
        localTargetTime: formatLocalTime(new Date(p.target.due_at), tz),
        localReceivedTime: formatLocalTime(new Date(p.received_at), tz),
        imageBase64,
      },
      { apiKey: env("OPENAI_API_KEY"), model, reasoningEffort: Deno.env.get("OPENAI_REASONING_EFFORT") ?? "low" },
    );
    outcome = finalOutcome(r.judgement.verdict, r.judgement.confidence);
    confidence = r.judgement.confidence;
    critique = r.judgement.critique;
    if (outcome === "insufficient" && r.judgement.verdict !== "insufficient") {
      critique = `${critique} The call wasn’t certain enough to score — retake with the activity clearly in frame.`;
    }
    raw = { ...(r.raw as object), observed: r.judgement.observed, verdict: r.judgement.verdict };
  } catch (e) {
    outcome = "error";
    critique = "The AI check didn’t respond. Your proof is saved with its capture time and will be re-checked automatically. No penalty.";
    raw = { error: e instanceof Error ? e.message : String(e), retryable: e instanceof AiError ? e.retryable : true };
  }

  const before = outcome === "verified" ? await myRank(db, p.user_id) : null;
  const { data: applied, error: applyErr } = await db.rpc("apply_verdict", {
    p_proof_id: proofId, p_outcome: outcome, p_critique: critique, p_confidence: confidence, p_model: model, p_raw: raw,
  });
  if (applyErr) throw new Error(`apply_verdict: ${applyErr.message}`);
  const a = applied as { points_delta: number; streak: number; total_points: number; target_status: string; already_settled: boolean };

  if (outcome === "verified" && !a.already_settled) {
    await notifyOnce(db, p.user_id, "verified", p.target.id, copy.verified(p.target.habit.title, a.streak));
    if (isMilestone(a.streak, p.target.habit.longest_streak)) {
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
  };
}

async function myRank(db: SupabaseClient, userId: string): Promise<number | null> {
  const { data } = await db.rpc("get_arena", { p_day: null, p_limit: 100 });
  const row = (data as Array<{ user_id: string; rank: number }> | null)?.find((r) => r.user_id === userId);
  return row?.rank ?? null;
}
