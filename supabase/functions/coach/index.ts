// POST { message } → the coach's reply, grounded in the user's own data (Premium, daily limit).
import { askCoach, type CoachTurn } from "../_shared/coach.ts";
import { adminClient, fail, hasPremium, json, requireUser, withCors } from "../_shared/http.ts";
import { recordUsage } from "../_shared/llm.ts";

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return fail(405, "method_not_allowed", "POST only.");
  const db = adminClient();
  const user = await requireUser(req, db);
  if (user instanceof Response) return user;
  const body = await req.json().catch(() => ({})) as { message?: unknown };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 1000) return fail(400, "bad_request", "Write a message of up to 1000 characters.");
  if (!(await hasPremium(db, user.id))) return fail(402, "premium_required", "The coach is part of NoExcuse Premium.");

  const [{ data: used }, { data: limitRow }] = await Promise.all([
    db.rpc("coach_messages_today", { p_user: user.id }),
    db.from("app_config").select("value").eq("key", "coach_daily_messages").single(),
  ]);
  const limit = (limitRow as { value: number } | null)?.value ?? 20;
  if ((used as number ?? 0) >= limit) return fail(429, "daily_limit", `You’ve used today’s ${limit} coach messages. They reset at midnight your time.`);

  const [{ data: context, error: cErr }, { data: hist }] = await Promise.all([
    db.rpc("get_coach_context", { p_user: user.id }),
    db.from("coach_messages").select("role, content").eq("user_id", user.id).order("created_at", { ascending: false }).limit(12),
  ]);
  if (cErr) return fail(500, "server_error", "Couldn’t load your data.");
  const history = ((hist ?? []) as CoachTurn[]).reverse();

  let reply: string;
  try {
    const { data: prof } = await db.from("profiles").select("language").eq("id", user.id).maybeSingle();
    const replyLanguage = prof?.language === "ro" ? "Romanian" : "English";
    const out = await askCoach({ ...(context as object), reply_language: replyLanguage }, history, message);
    reply = out.reply;
    await recordUsage(db, { userId: user.id, feature: "coach", result: out.result });
  } catch (e) {
    await recordUsage(db, { userId: user.id, feature: "coach", error: e });
    return fail(503, "coach_unavailable", "The coach is unavailable right now. Your message wasn’t counted — try again in a moment.");
  }
  // Only an answered exchange is stored (and counted toward the daily limit).
  const { error: insErr } = await db.from("coach_messages").insert([
    { user_id: user.id, role: "user", content: message },
    { user_id: user.id, role: "coach", content: reply },
  ]);
  if (insErr) return fail(500, "server_error", "Couldn’t save the conversation.");
  return json(200, { reply, remaining: Math.max(0, limit - ((used as number ?? 0) + 1)) });
}));
