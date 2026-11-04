import { callFunction, supabase } from '@/lib/supabase';
import type { Achievement, Api, Appeal, AppealResult, ArenaRow, CoachMessage, Partners, Plan, WeeklyReports, CaptureSession, Challenges, Discipline, Entitlement, Habit, HabitInput, MissedDetail, Profile, ScoreEvent, Stats, Target, TargetReview, VerdictResult, WarRoom } from './types';

const TARGET_SELECT = 'id, habit_id, local_date, due_at, status, settled_at, habit:habits!inner(id, title, proof_hint, current_streak, is_active, verification_level)';
const HABIT_SELECT = 'id, title, category, custom_category, description, notes, archived_at, verification_level, proof_hint, target_time, weekdays, is_active, reminder_minutes, current_streak, longest_streak';

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('Not signed in');
  return id;
}

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  // Server-enforced plan limits arrive as "premium_required: <reason>"; show only the reason.
  if (res.error) throw new Error(res.error.message.replace(/^premium_required: /, ''));
  return res.data as T;
}

export const liveApi: Api = {
  async getProfile() {
    return must(await supabase.from('profiles').select('id, display_name, timezone, total_points, notify_prefs').eq('id', await uid()).single()) as Profile;
  },
  async updateProfile(patch) {
    must(await supabase.from('profiles').update(patch).eq('id', await uid()));
  },
  async getTargets(fromIso, toIso) {
    return must(
      await supabase.from('targets').select(TARGET_SELECT).gte('due_at', fromIso).lte('due_at', toIso).order('due_at'),
    ) as unknown as Target[];
  },
  async getTarget(id) {
    return (must(await supabase.from('targets').select(TARGET_SELECT).eq('id', id).maybeSingle()) as unknown as Target | null) ?? null;
  },
  async getHabits() {
    return must(await supabase.from('habits').select(HABIT_SELECT).order('target_time')) as Habit[];
  },
  async getHabit(id) {
    return (must(await supabase.from('habits').select(HABIT_SELECT).eq('id', id).maybeSingle()) as Habit | null) ?? null;
  },
  async createHabit(input: HabitInput) {
    return must(await supabase.from('habits').insert({ ...input, user_id: await uid() }).select(HABIT_SELECT).single()) as Habit;
  },
  async updateHabit(id, patch) {
    must(await supabase.from('habits').update(patch).eq('id', id));
  },
  async getRecentEvents(limit) {
    return must(
      await supabase.from('score_events').select('id, target_id, delta, reason, streak_after, created_at, habit:habits!inner(title)')
        .order('created_at', { ascending: false }).limit(limit),
    ) as unknown as ScoreEvent[];
  },
  async getArena() {
    return must(await supabase.rpc('get_arena', { p_day: null, p_limit: 50 })) as ArenaRow[];
  },
  async getStats() {
    return must(await supabase.rpc('get_my_stats')) as Stats;
  },
  async getEntitlement() {
    return must(await supabase.from('entitlements').select('is_active, period_type, expires_at, will_renew').maybeSingle()) as Entitlement | null;
  },
  async getMissed(targetId) {
    const target = must(await supabase.from('targets').select(TARGET_SELECT).eq('id', targetId).single()) as unknown as Target;
    const event = (must(
      await supabase.from('score_events').select('id, target_id, delta, reason, streak_after, created_at, habit:habits!inner(title)').eq('target_id', targetId).maybeSingle(),
    ) as unknown as ScoreEvent | null) ?? null;
    const profile = await liveApi.getProfile();
    const prev = event
      ? (must(
          await supabase.from('score_events').select('streak_after').eq('habit_id', target.habit_id).lt('created_at', event.created_at)
            .order('created_at', { ascending: false }).limit(1),
        ) as { streak_after: number }[])
      : [];
    const next = (must(
      await supabase.from('targets').select(TARGET_SELECT).eq('habit_id', target.habit_id).eq('status', 'pending')
        .gt('due_at', new Date().toISOString()).order('due_at').limit(1),
    ) as unknown as Target[])[0] ?? null;
    const critique = (must(
      await supabase.from('proofs').select('critique').eq('target_id', targetId).not('critique', 'is', null)
        .order('created_at', { ascending: false }).limit(1),
    ) as { critique: string }[])[0]?.critique ?? null;
    const habit = await liveApi.getHabit(target.habit_id);
    const delta = event?.delta ?? 0;
    return {
      target, event, next, habit, lastCritique: critique,
      totalAfter: profile.total_points,
      totalBefore: profile.total_points - delta,
      streakBefore: prev[0]?.streak_after ?? 0,
    } satisfies MissedDetail;
  },
  startProof: (targetId) => callFunction<CaptureSession>('start-proof', { target_id: targetId }),
  verifyProof: (sessionId, images) => callFunction<VerdictResult>('verify-proof', { session_id: sessionId, images }),
  async getTargetReview(targetId) {
    const proof = (must(
      await supabase.from('proofs').select('id, outcome, critique, judged_at, level, requested_evidence').eq('target_id', targetId)
        .neq('outcome', 'processing').order('created_at', { ascending: false }).limit(1),
    ) as TargetReview['proof'][])[0] ?? null;
    const appeal = (must(
      await supabase.from('appeals').select('id, status, note, critique, created_at, decided_at').eq('target_id', targetId).maybeSingle(),
    ) as Appeal | null) ?? null;
    const hours = (must(await supabase.from('app_config').select('value').eq('key', 'appeal_window_hours').maybeSingle()) as { value: number } | null)?.value ?? 48;
    const appealUntil = proof?.outcome === 'rejected' && proof.judged_at && !appeal
      ? new Date(new Date(proof.judged_at).getTime() + hours * 3_600_000).toISOString() : null;
    return { proof, appeal, appealUntil };
  },
  appealProof: (proofId, note) => callFunction<AppealResult>('appeal-proof', { proof_id: proofId, note }),
  async getCoachMessages(limit) {
    const rows = must(await supabase.from('coach_messages').select('id, role, content, created_at').order('created_at', { ascending: false }).limit(limit)) as CoachMessage[];
    return rows.reverse();
  },
  askCoach: (message) => callFunction<{ reply: string; remaining: number }>('coach', { message }),
  async getWeeklyReports() {
    return must(await supabase.rpc('get_weekly_reports', { p_limit: 12 })) as WeeklyReports;
  },
  async getPartners() { return must(await supabase.rpc('get_partners')) as Partners; },
  async getPlan() { return must(await supabase.rpc('get_plan')) as Plan; },
  async getAchievements() { return must(await supabase.rpc('get_achievements')) as Achievement[]; },
  async createPartnerInvite() { return must(await supabase.rpc('create_partner_invite')) as { code: string; expires_at: string }; },
  async acceptPartnerInvite(code) { return must(await supabase.rpc('accept_partner_invite', { p_code: code })) as { partner_id: string; display_name: string }; },
  async revokePartnerInvite(code) { return must(await supabase.rpc('revoke_partner_invite', { p_code: code })) as boolean; },
  async removePartner(id) { return must(await supabase.rpc('remove_partner', { p_partner: id })) as boolean; },
  async nudgePartner(id) { return must(await supabase.rpc('nudge_partner', { p_partner: id })) as boolean; },
  refreshEntitlement: () => callFunction<{ premium: boolean }>('refresh-entitlement', {}),
  async savePushToken(token, platform) {
    must(await supabase.from('push_tokens').upsert({ token, platform, user_id: await uid(), updated_at: new Date().toISOString() }));
  },
  async deletePushTokens() {
    must(await supabase.from('push_tokens').delete().eq('user_id', await uid()));
  },
  async deleteAccount() {
    await callFunction('delete-account', {});
    await supabase.auth.signOut();
  },
  async getWarRoom() {
    return must(await supabase.rpc('get_war_room')) as WarRoom;
  },
  async getDiscipline() {
    return must(await supabase.rpc('get_discipline')) as Discipline;
  },
  async getChallenges() {
    return must(await supabase.rpc('get_challenges')) as Challenges;
  },
  async startChallenge(habitId, template) {
    const args = typeof template === 'string'
      ? { p_habit_id: habitId, p_template_id: template }
      : { p_habit_id: habitId, p_template_id: null, p_title: template.title, p_days: template.days, p_allowed_misses: template.allowedMisses };
    return must(await supabase.rpc('start_challenge', args)) as string;
  },
  async abandonChallenge(id) {
    return must(await supabase.rpc('abandon_challenge', { p_id: id })) as boolean;
  },
  async archiveHabit(id) {
    must(await supabase.from('habits').update({ archived_at: new Date().toISOString() }).eq('id', id));
  },
  async getHabitHistory(id, limit) {
    return must(
      await supabase.from('targets').select(TARGET_SELECT).eq('habit_id', id).lte('due_at', new Date(Date.now() + 2 * 86_400_000).toISOString())
        .order('due_at', { ascending: false }).limit(limit),
    ) as unknown as Target[];
  },
};
