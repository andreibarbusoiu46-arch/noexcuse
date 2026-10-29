// Runs every minute (pg_cron + pg_net, see README). Idempotent: safe to run twice.
//  1. Generate today's/tomorrow's targets in each user's timezone.
//  2. Settle closed windows with no valid proof → missed (−100), notify.
//  3. Reminders before a window opens, and "window open" nudges.
//  4. Retry proofs stuck in processing/error; give up after N tries → excused, no penalty.
import { encodeBase64 } from "../_shared/b64.ts";
import { adminClient, env, fail, json } from "../_shared/http.ts";
import { copy, notifyOnce } from "../_shared/push.ts";
import { formatLocalTime, MAX_VERIFY_ATTEMPTS, windowBounds } from "../_shared/rules.ts";
import { safeEqual } from "../_shared/revenuecat.ts";
import { judgeAndApply } from "../_shared/verify.ts";

Deno.serve(async (req) => {
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${env("CRON_SECRET")}`)) return fail(401, "unauthorized", "");
  const db = adminClient();
  const now = new Date();
  const report = { generated: 0, settled: 0, reminders: 0, opened: 0, retried: 0, excused: 0 };

  // 1
  const gen = await db.rpc("ensure_targets_all");
  report.generated = (gen.data as number) ?? 0;

  // 2
  const { data: settled } = await db.rpc("settle_due_targets", { p_now: now.toISOString() });
  for (const s of (settled ?? []) as Array<{ target_id: string; user_id: string; habit_title: string; next_due_at: string | null }>) {
    report.settled++;
    const { data: prof } = await db.from("profiles").select("timezone").eq("id", s.user_id).single();
    const next = s.next_due_at ? describeNext(new Date(s.next_due_at), now, prof?.timezone ?? "UTC") : null;
    await notifyOnce(db, s.user_id, "missed", s.target_id, copy.missed(s.habit_title, next));
  }

  // 3
  const horizon = new Date(now.getTime() + 2.5 * 3600_000).toISOString();
  const { data: upcoming } = await db
    .from("targets")
    .select("id, user_id, due_at, habit:habits!inner(title, reminder_minutes), profile:profiles!inner(timezone)")
    .eq("status", "pending").gte("due_at", new Date(now.getTime() - 15 * 60_000).toISOString()).lte("due_at", horizon);
  // deno-lint-ignore no-explicit-any
  for (const t of (upcoming ?? []) as any[]) {
    const due = new Date(t.due_at);
    const { opensAt, closesAt } = windowBounds(due);
    const tz = t.profile.timezone;
    const remindAt = new Date(opensAt.getTime() - t.habit.reminder_minutes * 60_000);
    if (t.habit.reminder_minutes > 0 && now >= remindAt && now < opensAt) {
      if (await notifyOnce(db, t.user_id, "reminder", t.id,
        copy.reminder(t.habit.title, Math.max(1, Math.round((opensAt.getTime() - now.getTime()) / 60_000)), formatLocalTime(opensAt, tz), formatLocalTime(closesAt, tz)),
        { targetId: t.id })) report.reminders++;
    }
    if (now >= opensAt && now <= closesAt) {
      if (await notifyOnce(db, t.user_id, "window_open", t.id, copy.window_open(t.habit.title, formatLocalTime(due, tz)), { targetId: t.id })) report.opened++;
    }
  }

  // 4
  const { data: stuck } = await db
    .from("proofs")
    .select("id, user_id, storage_path, attempts, created_at, target:targets!inner(id, status, habit:habits!inner(title))")
    .in("outcome", ["processing", "error"])
    .lt("created_at", new Date(now.getTime() - 2 * 60_000).toISOString())
    .limit(10);
  // deno-lint-ignore no-explicit-any
  for (const p of (stuck ?? []) as any[]) {
    if (p.target.status !== "pending") continue;
    const tooOld = now.getTime() - new Date(p.created_at).getTime() > 24 * 3600_000;
    if (p.attempts >= MAX_VERIFY_ATTEMPTS || tooOld) {
      const { data: ok } = await db.rpc("excuse_target", { p_target_id: p.target.id });
      if (ok) { report.excused++; await notifyOnce(db, p.user_id, "excused", p.target.id, copy.excused(p.target.habit.title)); }
      continue;
    }
    const file = await db.storage.from("proofs").download(p.storage_path);
    if (file.error || !file.data) continue;
    const b64 = encodeBase64(new Uint8Array(await file.data.arrayBuffer()));
    try { await judgeAndApply(db, p.id, b64); report.retried++; } catch { /* next tick */ }
  }

  return json(200, report);
});

function describeNext(next: Date, now: Date, tz: string): string {
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
  const tomorrow = new Date(now.getTime() + 86_400_000);
  const label = day(next) === day(now) ? "today" : day(next) === day(tomorrow) ? "tomorrow" : new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: tz }).format(next);
  return `${label} ${formatLocalTime(next, tz)}`;
}
