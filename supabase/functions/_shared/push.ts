// Expo push notifications. Copy is direct and respectful — never degrading.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";

export type Kind = "reminder" | "window_open" | "verified" | "missed" | "milestone" | "arena_up" | "excused";

export const copy = {
  reminder: (title: string, mins: number, opens: string, closes: string) => ({
    title: `Window opens in ${mins} min`,
    body: `${title}. Proof due ${opens}–${closes}. Be ready.`,
  }),
  window_open: (title: string, due: string) => ({
    title: "Window’s open. Prove it.",
    body: `${title} — 15 minutes either side of ${due}. The camera’s ready.`,
  }),
  verified: (title: string, streak: number) => ({
    title: "Verified. +50",
    body: `${title} locked in. Streak: ${streak} ${streak === 1 ? "day" : "days"}.`,
  }),
  missed: (title: string, next: string | null) => ({
    title: `Missed: ${title}`,
    body: next ? `−100 and the streak resets. Your next window: ${next}.` : `−100 and the streak resets.`,
  }),
  milestone: (streak: number) => ({
    title: `${streak} days. New personal best.`,
    body: `${streak} straight days of no excuses.`,
  }),
  arena_up: (rank: number) => ({
    title: `You moved up to #${rank}`,
    body: "Hold it until midnight UTC.",
  }),
  excused: (title: string) => ({
    title: "Verification failed on our side",
    body: `${title}: we couldn’t check your proof. No penalty, streak untouched.`,
  }),
};

/**
 * Sends at most once per (user, kind, ref) thanks to notification_log's primary key.
 * Returns true if a message was handed to Expo.
 */
export async function notifyOnce(
  db: SupabaseClient,
  userId: string,
  kind: Kind,
  refId: string,
  message: { title: string; body: string },
  data: Record<string, unknown> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const { data: inserted, error } = await db
    .from("notification_log")
    .upsert({ user_id: userId, kind, ref_id: refId }, { onConflict: "user_id,kind,ref_id", ignoreDuplicates: true })
    .select("ref_id");
  if (error || !inserted || inserted.length === 0) return false;

  const { data: tokens } = await db.from("push_tokens").select("token").eq("user_id", userId);
  if (!tokens?.length) return false;

  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  const access = Deno.env.get("EXPO_ACCESS_TOKEN");
  if (access) headers.authorization = `Bearer ${access}`;
  const res = await fetchImpl("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers,
    body: JSON.stringify(tokens.map((t) => ({ to: t.token, sound: "default", ...message, data: { kind, refId, ...data } }))),
  });
  const out = await res.json().catch(() => null) as { data?: Array<{ status: string; details?: { error?: string } }> } | null;
  // Drop tokens Apple/Google report as gone.
  const dead = (out?.data ?? []).map((t, i) => (t.details?.error === "DeviceNotRegistered" ? tokens[i].token : null)).filter(Boolean);
  if (dead.length) await db.from("push_tokens").delete().in("token", dead as string[]);
  return res.ok;
}
