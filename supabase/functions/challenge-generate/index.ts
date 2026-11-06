// POST { goal, minutes_per_day, difficulty, duration_days? } → a challenge plan for the user to review.
// Nothing is created here: the user approves the plan in the app, which then calls start_challenge_plan.
import { DIFFICULTIES, type Difficulty, generatePlan, validatePlan } from "../_shared/challengeai.ts";
import { adminClient, fail, hasPremium, json, requireUser, withCors } from "../_shared/http.ts";
import { LlmError, recordUsage } from "../_shared/llm.ts";

const DAILY_LIMIT = 10;

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return fail(405, "method_not_allowed", "POST only.");
  const db = adminClient();
  const user = await requireUser(req, db);
  if (user instanceof Response) return user;
  const b = await req.json().catch(() => ({})) as { goal?: unknown; minutes_per_day?: unknown; difficulty?: unknown; duration_days?: unknown };
  const goal = typeof b.goal === "string" ? b.goal.trim() : "";
  const minutes = Number(b.minutes_per_day);
  const difficulty = (DIFFICULTIES as readonly string[]).includes(String(b.difficulty)) ? b.difficulty as Difficulty : null;
  const duration = b.duration_days == null ? null : Number(b.duration_days);
  if (goal.length < 5 || goal.length > 500) return fail(400, "bad_request", "Describe your goal in 5–500 characters.");
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 240) return fail(400, "bad_request", "Available time must be 5–240 minutes.");
  if (!difficulty) return fail(400, "bad_request", "Choose a difficulty.");
  if (duration !== null && !(Number.isInteger(duration) && duration >= 1 && duration <= 90)) return fail(400, "bad_request", "Duration must be 1–90 days.");
  const premium = await hasPremium(db, user.id);
  if (!premium) return fail(402, "premium_required", "Challenges are part of NoExcuse Premium.");

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await db.from("audit_log").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).eq("action", "challenge_generated").gte("at", since);
  if ((count ?? 0) >= DAILY_LIMIT) return fail(429, "daily_limit", `You can generate ${DAILY_LIMIT} challenges per day.`);

  const { data: prof } = await db.from("profiles").select("language").eq("id", user.id).single();
  const language = prof?.language === "ro" ? "ro" : "en";
  let plan;
  try {
    const out = await generatePlan({ goal, minutesPerDay: minutes, difficulty, durationDays: duration, language, premiumLevels: premium });
    plan = out.plan;
    await recordUsage(db, { userId: user.id, feature: "generate", result: out.result });
  } catch (e) {
    await recordUsage(db, { userId: user.id, feature: "generate", error: e });
    if (e instanceof LlmError && e.code === "invalid_output") return fail(422, "ai_invalid", "The generated plan didn’t pass our rules. Try again or rephrase your goal.");
    return fail(503, "ai_unavailable", "The generator is unavailable right now. Try again in a moment.");
  }
  await db.from("audit_log").insert({ user_id: user.id, action: "challenge_generated", data: { goal: goal.slice(0, 200) } });
  const v = validatePlan(plan, premium);
  if (!v.ok) return fail(422, "ai_invalid", "The generated plan didn’t pass our rules. Try again or rephrase your goal.");
  return json(200, { plan: v.plan });
}));
