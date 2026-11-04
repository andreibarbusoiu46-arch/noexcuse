// Expo push notifications. Copy is direct and respectful — never degrading.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";

export type Kind = "reminder" | "window_open" | "verified" | "missed" | "milestone" | "arena_up" | "excused" | "appeal" | "heads_up" | "last_call" | "weekly_report" | "nudge" | "partner_missed" | "achievement";

export type Lang = "en" | "ro";
export type Msg = { title: string; body: string };
/** Every notification is written in each supported language; notifyOnce picks the user's. */
export type Localized = Record<Lang, Msg>;

const zile = (n: number) => (n === 1 ? "zi" : n % 100 === 0 || n % 100 >= 20 ? "de zile" : "zile");

export const copy = {
  reminder: (title: string, mins: number, opens: string, closes: string): Localized => ({
    en: { title: `Window opens in ${mins} min`, body: `${title}. Proof due ${opens}–${closes}. Be ready.` },
    ro: { title: `Fereastra se deschide în ${mins} min`, body: `${title}. Dovada între ${opens} și ${closes}. Fii pregătit.` },
  }),
  window_open: (title: string, due: string): Localized => ({
    en: { title: "Window’s open. Prove it.", body: `${title} — 15 minutes either side of ${due}. The camera’s ready.` },
    ro: { title: "Fereastra e deschisă. Dovedește.", body: `${title} — 15 minute înainte și după ${due}. Camera e pregătită.` },
  }),
  verified: (title: string, streak: number): Localized => ({
    en: { title: "Verified. +50", body: `${title} locked in. Streak: ${streak} ${streak === 1 ? "day" : "days"}.` },
    ro: { title: "Verificat. +50", body: `${title} — bifat. Serie: ${streak} ${zile(streak)}.` },
  }),
  missed: (title: string, next: Record<Lang, string> | null): Localized => ({
    en: { title: `Missed: ${title}`, body: next ? `−100 and the streak resets. Your next window: ${next.en}.` : "−100 and the streak resets." },
    ro: { title: `Ratat: ${title}`, body: next ? `−100 și seria se resetează. Următoarea fereastră: ${next.ro}.` : "−100 și seria se resetează." },
  }),
  milestone: (streak: number): Localized => ({
    en: { title: `${streak} days. New personal best.`, body: `${streak} straight days of no excuses.` },
    ro: { title: `${streak} ${zile(streak)}. Nou record personal.`, body: `${streak} ${zile(streak)} la rând, fără scuze.` },
  }),
  arena_up: (rank: number): Localized => ({
    en: { title: `You moved up to #${rank}`, body: "Hold it until midnight UTC." },
    ro: { title: `Ai urcat pe locul ${rank}`, body: "Păstrează-l până la miezul nopții UTC." },
  }),
  heads_up: (title: string, due: string, misses: number): Localized => ({
    en: { title: `Heads-up: ${title} at ${due}`, body: `You’ve missed it ${misses} of the last 7 times. Decide now where and how you’ll do it.` },
    ro: { title: `Atenție: ${title} la ${due}`, body: `Ai ratat-o de ${misses} ori din ultimele 7. Decide acum unde și cum o faci.` },
  }),
  last_call: (title: string, closes: string): Localized => ({
    en: { title: `Last call: ${title}`, body: `The window closes at ${closes}. Nothing submitted yet.` },
    ro: { title: `Ultima chemare: ${title}`, body: `Fereastra se închide la ${closes}. Încă n-ai trimis nimic.` },
  }),
  nudge: (from: string): Localized => ({
    en: { title: `${from} nudged you`, body: "Your partner is watching. Go get today’s proof." },
    ro: { title: `${from} ți-a dat un ghiont`, body: "Partenerul tău e atent. Du-te și adu dovada de azi." },
  }),
  partner_missed: (name: string, title: string): Localized => ({
    en: { title: `${name} missed a target`, body: `${title} — the window closed without proof. A nudge for tomorrow might help.` },
    ro: { title: `${name} a ratat un obiectiv`, body: `${title} — fereastra s-a închis fără dovadă. Un ghiont pentru mâine poate ajuta.` },
  }),
  achievement: (title: Record<Lang, string>): Localized => ({
    en: { title: `Achievement unlocked: ${title.en}`, body: "Earned on your record. See it in Profile › Achievements." },
    ro: { title: `Realizare deblocată: ${title.ro}`, body: "Câștigată pe baza istoricului tău. O vezi în Profil › Realizări." },
  }),
  weekly_report: (): Localized => ({
    en: { title: "Your weekly report is ready", body: "What you kept, what slipped, and where to aim this week." },
    ro: { title: "Raportul săptămânal e gata", body: "Ce ai ținut, ce ți-a scăpat și unde să țintești săptămâna asta." },
  }),
  appeal: (title: string, overturned: boolean, delta: number): Localized => (overturned
    ? {
      en: { title: `Appeal won. +${delta}`, body: `${title}: the second review verified your proof. Penalty reversed, streak restored.` },
      ro: { title: `Contestație câștigată. +${delta}`, body: `${title}: a doua analiză ți-a validat dovada. Penalizarea a fost anulată, seria refăcută.` },
    }
    : {
      en: { title: "Appeal reviewed: verdict stands", body: `${title}: the second review reached the same decision. Open the app for the reason.` },
      ro: { title: "Contestație analizată: verdictul rămâne", body: `${title}: a doua analiză a ajuns la aceeași decizie. Deschide aplicația pentru motiv.` },
    }),
  appeal_unavailable: (title: string): Localized => ({
    en: { title: "Appeal couldn’t be reviewed", body: `${title}: the AI review was unavailable, so the original verdict stands.` },
    ro: { title: "Contestația nu a putut fi analizată", body: `${title}: analiza AI n-a fost disponibilă, așa că verdictul inițial rămâne.` },
  }),
  excused: (title: string): Localized => ({
    en: { title: "Verification failed on our side", body: `${title}: we couldn’t check your proof. No penalty, streak untouched.` },
    ro: { title: "Verificarea a eșuat la noi", body: `${title}: nu ți-am putut verifica dovada. Fără penalizare, seria rămâne.` },
  }),
};

// Achievement names are stored in English; these are their Romanian names.
export const ACHIEVEMENT_RO: Record<string, string> = {
  first_proof: "Prima dovadă", streak_7: "O săptămână întreagă", perfect_week: "Săptămână perfectă", comeback: "Revenire",
  points_1000: "1.000 de puncte", challenge_done: "Provocare finalizată", score_80: "Disciplinat", streak_30: "Treizeci de zile",
  elite_proof: "Dovadă Elite", appeal_won: "Verdict răsturnat", challenges_3: "Trei provocări", points_5000: "5.000 de puncte",
  streak_100: "O sută",
};

export const isLang = (x: unknown): x is Lang => x === "en" || x === "ro";

/**
 * Sends at most once per (user, kind, ref) thanks to notification_log's primary key.
 * Returns true if a message was handed to Expo.
 */
export async function notifyOnce(
  db: SupabaseClient,
  userId: string,
  kind: Kind,
  refId: string,
  message: Msg | Localized,
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
  let msg: Msg;
  if ("en" in message) {
    const { data: prof } = await db.from("profiles").select("language").eq("id", userId).maybeSingle();
    msg = message[isLang(prof?.language) ? prof.language : "en"];
  } else msg = message;

  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  const access = Deno.env.get("EXPO_ACCESS_TOKEN");
  if (access) headers.authorization = `Bearer ${access}`;
  const res = await fetchImpl("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers,
    body: JSON.stringify(tokens.map((t) => ({ to: t.token, sound: "default", ...msg, data: { kind, refId, ...data } }))),
  });
  const out = await res.json().catch(() => null) as { data?: Array<{ status: string; details?: { error?: string } }> } | null;
  // Drop tokens Apple/Google report as gone.
  const dead = (out?.data ?? []).map((t, i) => (t.details?.error === "DeviceNotRegistered" ? tokens[i].token : null)).filter(Boolean);
  if (dead.length) await db.from("push_tokens").delete().in("token", dead as string[]);
  return res.ok;
}
