// Appeals: one independent AI re-review of a rejected proof. Used by appeal-proof and cron-tick.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { activityOf } from "../../../src/shared/activity.ts";
import { analyzeEvidence } from "./engine.ts";
import { loadEvidence, storedNotes } from "./evidence.ts";
import { recordUsage } from "./llm.ts";
import { copy, notifyOnce } from "./push.ts";
import { APPEAL_MIN_CONFIDENCE, formatLocalTime, isLevel, type Level } from "./rules.ts";

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
    .select("id, user_id, note, status, proof:proofs!inner(id, storage_path, received_at, level, critique, target:targets!inner(id, due_at, habit:habits!inner(title, proof_hint, description, category, activity, challenge:challenges!habits_challenge_id_fkey(title, rules)))), profile:profiles!inner(timezone, language)")
    .eq("id", appealId).single();
  if (error || !data) throw new Error(`appeal ${appealId} not found`);
  // deno-lint-ignore no-explicit-any
  const a = data as any;
  if (a.status !== "pending") return { appeal_id: a.id, status: a.status, critique: null, points_delta: 0 };
  const level: Level = isLevel(a.proof.level) ? a.proof.level : "standard";
  const tz: string = a.profile.timezone;
  const habit = a.proof.target.habit;

  try {
    const images = await loadEvidence(db, a.proof);
    if (!images) throw new Error("evidence not found in storage");
    const notes = await storedNotes(db, a.user_id, a.proof.target.id, a.proof.id);
    let run;
    try {
      run = await analyzeEvidence({
        commitment: { title: habit.title, description: habit.description, proofHint: habit.proof_hint },
        challenge: habit.challenge ? { title: habit.challenge.title, rules: habit.challenge.rules } : null,
        activity: activityOf(habit), level, images, notes,
        localTargetTime: formatLocalTime(new Date(a.proof.target.due_at), tz),
        localReceivedTime: formatLocalTime(new Date(a.proof.received_at), tz),
        language: a.profile.language === "ro" ? "ro" : "en",
        appeal: { firstExplanation: a.proof.critique, note: a.note },
      }, { timeoutMs: 60_000 });
    } catch (e) {
      await recordUsage(db, { userId: a.user_id, feature: "appeal", error: e, refId: a.id });
      throw e;
    }
    await recordUsage(db, { userId: a.user_id, feature: "appeal", result: run.result, refId: a.id });
    const r = run.analysis;
    // Overturn only on a confident VERIFIED that passed the server's requirement checks.
    const overturn = r.status === "VERIFIED" && r.confidence >= APPEAL_MIN_CONFIDENCE;
    const { data: res, error: rErr } = await db.rpc("resolve_appeal", {
      p_appeal: a.id, p_overturn: overturn, p_critique: r.explanation, p_confidence: r.confidence, p_model: run.result.model,
      p_raw: { provider: run.result.provider, model: run.result.model, usage: run.result.usage, status: r.status, model_status: r.model_status, analysis: r },
    });
    if (rErr) throw new Error(`resolve_appeal: ${rErr.message}`);
    const out = res as { status: "upheld" | "overturned"; points_delta: number; streak?: number; total_points?: number };
    if (notify) await notifyOnce(db, a.user_id, "appeal", a.id, copy.appeal(habit.title, out.status === "overturned", out.points_delta), { targetId: a.proof.target.id });
    return { appeal_id: a.id, status: out.status, critique: r.explanation, points_delta: out.points_delta, streak: out.streak, total_points: out.total_points };
  } catch (e) {
    const { data: st } = await db.rpc("fail_appeal", { p_appeal: a.id, p_raw: { error: e instanceof Error ? e.message : String(e) } });
    if (st === "unavailable" && notify) await notifyOnce(db, a.user_id, "appeal", a.id, copy.appeal_unavailable(a.proof.target.habit.title), { targetId: a.proof.target.id });
    return { appeal_id: a.id, status: st === "unavailable" ? "unavailable" : "pending", critique: null, points_delta: 0 };
  }
}
