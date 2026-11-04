// Runs every minute (pg_cron + pg_net, see README). Idempotent: safe to run twice.
//  1. Generate today's/tomorrow's targets in each user's timezone.
//  2. Settle closed windows with no valid proof → missed (−100), notify.
//  3. Reminders before a window opens, and "window open" nudges.
//  4. Retry proofs stuck in processing/error; give up after N tries → excused, no penalty.
//  5. Retry appeals whose re-review couldn’t run.
//  6. Smart reminders (Premium): heads-up for often-missed commitments, last call before a window closes.
//  7. Weekly reports, Monday from 06:00 local time.
//  8. Partner nudges.
//  9. Achievements earned by recent activity.
// 10. Evidence retention: photos older than 30 days for users who chose it.
import { runAppealReview } from "../_shared/appeal.ts";
import { loadEvidence, storedNotes } from "../_shared/evidence.ts";
import { adminClient, fail, json } from "../_shared/http.ts";
import { ACHIEVEMENT_RO, copy, type Lang, notifyOnce } from "../_shared/push.ts";
import { formatLocalTime, MAX_VERIFY_ATTEMPTS, windowBounds } from "../_shared/rules.ts";
import { safeEqual } from "../_shared/revenuecat.ts";
import { judgeAndApply } from "../_shared/verify.ts";

// Auth: the caller (pg_cron via pg_net) sends the secret kept in Supabase Vault. The function reads
// the same value through a service-role-only RPC, so the secret never leaves the project.
async function cronSecret(db: ReturnType<typeof adminClient>): Promise<string | null> {
  const fromEnv = Deno.env.get("CRON_SECRET");
  if (fromEnv) return fromEnv;
  const { data } = await db.rpc("cron_secret");
  return typeof data === "string" && data.length >= 32 ? data : null;
}

Deno.serve(async (req) => {
  const db = adminClient();
  const secret = await cronSecret(db);
  if (!secret || !safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return fail(401, "unauthorized", "");
  const now = new Date();
  const report = { generated: 0, settled: 0, reminders: 0, opened: 0, retried: 0, excused: 0, appeals: 0, smart: 0, reports: 0, partner: 0, achievements: 0, evidence_deleted: 0 };

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
    await alertPartners(db, s.user_id, s.target_id, s.habit_title).then((n) => { report.partner += n; });
  }

  // 3
  const horizon = new Date(now.getTime() + 2.5 * 3600_000).toISOString();
  const { data: upcoming } = await db
    .from("targets")
    .select("id, user_id, due_at, habit:habits!inner(title, reminder_minutes), profile:profiles!inner(timezone, notify_prefs)")
    .eq("status", "pending").gte("due_at", new Date(now.getTime() - 15 * 60_000).toISOString()).lte("due_at", horizon);
  // deno-lint-ignore no-explicit-any
  for (const t of (upcoming ?? []) as any[]) {
    const due = new Date(t.due_at);
    const { opensAt, closesAt } = windowBounds(due);
    const tz = t.profile.timezone;
    const remindAt = new Date(opensAt.getTime() - t.habit.reminder_minutes * 60_000);
    if (t.habit.reminder_minutes > 0 && t.profile.notify_prefs?.reminders !== false && now >= remindAt && now < opensAt) {
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
    const images = await loadEvidence(db, p);
    if (!images) continue;
    const notes = await storedNotes(db, p.user_id, p.target.id, p.id).catch(() => []);
    try { await judgeAndApply(db, p.id, images, notes); report.retried++; } catch { /* next tick */ }
  }

  // 5
  const { data: appeals } = await db.from("appeals").select("id").eq("status", "pending")
    .lt("created_at", new Date(now.getTime() - 60_000).toISOString()).order("created_at").limit(5);
  for (const a of appeals ?? []) {
    const r = await runAppealReview(db, a.id).catch(() => null);
    if (r && r.status !== "pending") report.appeals++;
  }

  // 6
  const { data: smart } = await db.rpc("smart_reminder_candidates", { p_now: now.toISOString() });
  for (const c of (smart ?? []) as Array<{ kind: "heads_up" | "last_call"; target_id: string; user_id: string; title: string; due_at: string; timezone: string; misses: number }>) {
    const due = new Date(c.due_at);
    const msg = c.kind === "heads_up"
      ? copy.heads_up(c.title, formatLocalTime(due, c.timezone), c.misses)
      : copy.last_call(c.title, formatLocalTime(windowBounds(due).closesAt, c.timezone));
    if (await notifyOnce(db, c.user_id, c.kind, c.target_id, msg, { targetId: c.target_id })) report.smart++;
  }

  // 7
  if (now.getUTCMinutes() % 10 === 0) {
    const { data: reports } = await db.rpc("generate_weekly_reports", { p_now: now.toISOString() });
    for (const r of (reports ?? []) as Array<{ user_id: string; report_id: string }>) {
      report.reports++;
      const { data: wants } = await db.rpc("wants", { p_user: r.user_id, p_kind: "weekly_report" });
      if (wants !== false) await notifyOnce(db, r.user_id, "weekly_report", r.report_id, copy.weekly_report(), { reportId: r.report_id });
    }
  }

  // 8
  const { data: nudges } = await db.rpc("claim_partner_nudges", { p_limit: 50 });
  for (const n of (nudges ?? []) as Array<{ nudge_id: string; from_name: string; to_user: string }>) {
    const { data: wants } = await db.rpc("wants", { p_user: n.to_user, p_kind: "partners" });
    if (wants !== false && await notifyOnce(db, n.to_user, "nudge", n.nudge_id, copy.nudge(n.from_name))) report.partner++;
  }

  // 9
  if (now.getUTCMinutes() % 5 === 0) {
    const { data: earned } = await db.rpc("award_achievements_recent", { p_since: new Date(now.getTime() - 15 * 60_000).toISOString() });
    for (const a of (earned ?? []) as Array<{ user_id: string; key: string; title: string }>) {
      report.achievements++;
      // notification_log needs a uuid ref: derive a stable one from the achievement key.
      await notifyOnce(db, a.user_id, "achievement", await keyUuid(a.key), copy.achievement({ en: a.title, ro: ACHIEVEMENT_RO[a.key] ?? a.title }));
    }
  }

  // 10
  if (now.getUTCMinutes() % 15 === 7) {
    const { data: due } = await db.rpc("evidence_due_for_deletion", { p_limit: 200 });
    const rows = (due ?? []) as Array<{ proof_id: string; paths: string[] }>;
    if (rows.length) {
      const { error } = await db.storage.from("proofs").remove(rows.flatMap((r) => r.paths));
      if (!error) {
        const { data: n } = await db.rpc("mark_evidence_deleted", { p_proofs: rows.map((r) => r.proof_id) });
        report.evidence_deleted = (n as number) ?? 0;
      }
    }
  }

  return json(200, report);
});

async function keyUuid(key: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`achievement:${key}`)));
  const hex = [...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Tells a user's partners (who want partner alerts) that a window closed without proof. */
async function alertPartners(db: ReturnType<typeof adminClient>, userId: string, targetId: string, title: string): Promise<number> {
  const [{ data: ids }, { data: me }] = await Promise.all([
    db.rpc("partner_ids", { p_user: userId }),
    db.from("profiles").select("display_name").eq("id", userId).single(),
  ]);
  let sent = 0;
  // setof uuid: PostgREST returns scalars; accept the object form too.
  for (const row of (ids ?? []) as Array<string | { partner_ids: string }>) {
    const pid = typeof row === 'string' ? row : row.partner_ids;
    const { data: wants } = await db.rpc("wants", { p_user: pid, p_kind: "partners" });
    if (wants !== false && await notifyOnce(db, pid, "partner_missed", targetId, copy.partner_missed(me?.display_name ?? "Your partner", title))) sent++;
  }
  return sent;
}

function describeNext(next: Date, now: Date, tz: string): Record<Lang, string> {
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
  const tomorrow = new Date(now.getTime() + 86_400_000);
  const rel = day(next) === day(now) ? 0 : day(next) === day(tomorrow) ? 1 : null;
  const weekday = (locale: string) => new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: tz }).format(next);
  const time = formatLocalTime(next, tz);
  return {
    en: `${rel === 0 ? "today" : rel === 1 ? "tomorrow" : weekday("en-GB")} ${time}`,
    ro: `${rel === 0 ? "azi" : rel === 1 ? "mâine" : weekday("ro-RO")} la ${time}`,
  };
}
