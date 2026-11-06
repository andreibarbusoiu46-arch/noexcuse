// Demo mode (EXPO_PUBLIC_DEMO=1): fixture data shaped exactly like the live API.
// No backend, no AI, no purchases — for design review and Expo Go only. Never ships with this flag on.
import { ApiError } from '@/lib/supabase';
import { demoTemplates } from './demoTemplates';
import type { ChallengeDetail, Achievement, Api, Appeal, AppealResult, ArenaRow, CoachMessage, Partners, Plan, WeeklyReports, Challenge, Challenges, ChallengeTemplate, Discipline, Habit, HabitInput, Profile, ScoreEvent, Target, TargetReview, VerdictResult, WarRoom } from './types';

const MIN = 60_000;
const at = (offsetMin: number) => new Date(Date.now() + offsetMin * MIN).toISOString();
const hhmm = (offsetMin: number) => {
  const d = new Date(Date.now() + offsetMin * MIN);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 100;
const id = () => `demo-${++seq}`;

const profile: Profile = { id: 'demo-me', display_name: 'Andrei', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, total_points: 1250,
  notify_prefs: { reminders: true, heads_up: true, last_call: true, weekly_report: true, partners: true },
  language: 'en', theme: 'dark', evidence_retention: 'keep' };

const habits: Habit[] = [
  { id: 'h-shower', category: 'health', custom_category: null, description: null, notes: null, archived_at: null, verification_level: 'standard', title: 'Cold shower — 3 min', proof_hint: 'Me under the running shower, timer visible on my phone.', target_time: hhmm(-180), weekdays: [1, 2, 3, 4, 5, 6, 7], is_active: true, reminder_minutes: 10, current_streak: 12, longest_streak: 21 },
  { id: 'h-run', category: 'fitness', custom_category: null, description: null, notes: null, archived_at: null, verification_level: 'strict', title: 'Morning run — 5 km', proof_hint: 'Outdoor track or road, with my watch showing the distance.', target_time: hhmm(5), weekdays: [1, 2, 3, 4, 5, 6], is_active: true, reminder_minutes: 10, current_streak: 12, longest_streak: 12 },
  { id: 'h-work', category: 'productivity', custom_category: null, description: null, notes: null, archived_at: null, verification_level: 'standard', title: 'Deep work — 2 hours', proof_hint: 'Desk with the focus timer on screen.', target_time: hhmm(170), weekdays: [1, 2, 3, 4, 5], is_active: true, reminder_minutes: 10, current_streak: 4, longest_streak: 9 },
  { id: 'h-read', category: 'education', custom_category: null, description: null, notes: null, archived_at: null, verification_level: 'standard', title: 'Read 20 pages', proof_hint: 'The open book with the page number and a clock in frame.', target_time: hhmm(860), weekdays: [1, 2, 3, 4, 5, 6, 7], is_active: true, reminder_minutes: 10, current_streak: 0, longest_streak: 6 },
  { id: 'h-gym', category: 'fitness', custom_category: null, description: null, notes: null, archived_at: null, verification_level: 'standard', title: 'Gym — upper body', proof_hint: null, target_time: '18:00:00', weekdays: [2, 4], is_active: false, reminder_minutes: 10, current_streak: 0, longest_streak: 3 },
];
const habitRef = (h: Habit) => ({ id: h.id, title: h.title, proof_hint: h.proof_hint, current_streak: h.current_streak, is_active: h.is_active, verification_level: h.verification_level });

const targets: Target[] = [
  { id: 't-shower', habit_id: 'h-shower', local_date: '', due_at: at(-180), status: 'verified', settled_at: at(-173), habit: habitRef(habits[0]) },
  { id: 't-run', habit_id: 'h-run', local_date: '', due_at: at(5), status: 'pending', settled_at: null, habit: habitRef(habits[1]) },
  { id: 't-work', habit_id: 'h-work', local_date: '', due_at: at(170), status: 'pending', settled_at: null, habit: habitRef(habits[2]) },
  { id: 't-read', habit_id: 'h-read', local_date: '', due_at: at(860), status: 'pending', settled_at: null, habit: habitRef(habits[3]) },
  { id: 't-read-y', habit_id: 'h-read', local_date: '', due_at: at(-580), status: 'missed', settled_at: at(-565), habit: habitRef(habits[3]) },
];

const demoAppeals: Record<string, Appeal> = {};
const coach: CoachMessage[] = [];
// Demo partner — fixture only, clearly labelled as demo data in the UI build.
const demoPartners: Partners = {
  partners: [{ id: 'demo-partner', display_name: 'Demo partner', total_points: 940, score: { score: 68, provisional: false }, streak: 5,
    week: { settled: 12, verified: 10 }, since: at(-14 * 1440), nudged_today: false,
    today: [{ title: 'Gym — legs', due_at: at(-120), state: 'verified' }, { title: 'No sugar', due_at: at(240), state: 'pending' }] }],
  invites: [], max_partners: 5, can_invite: true,
};
const monday = (() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7); return d.toISOString().slice(0, 10); })();
const demoReport = {
  id: 'r1', week_start: monday, created_at: new Date().toISOString(),
  data: { week_start: monday, week_end: monday, settled: 23, verified: 20, missed: 2, rejected: 1, excused: 0, success_rate: 87, previous_success_rate: 79,
    points: 800, score_start: 70, score_end: 74, best: { title: 'Cold shower — 3 min', verified: 7, settled: 7 }, worst: { title: 'Read 20 pages', verified: 4, settled: 7 },
    best_day: 'Tuesday', hardest_day: 'Saturday', commitments: [{ title: 'Cold shower — 3 min', verified: 7, settled: 7 }, { title: 'Morning run — 5 km', verified: 6, settled: 6 }, { title: 'Read 20 pages', verified: 4, settled: 7 }, { title: 'Deep work — 2 hours', verified: 3, settled: 3 }],
    challenges_completed: 0, challenges_failed: 0, longest_streak: 12 },
};

const events: ScoreEvent[] = [
  { id: 5, target_id: 't-shower', delta: 50, reason: 'verified', streak_after: 12, created_at: at(-173), habit: { title: 'Cold shower — 3 min' } },
  { id: 4, target_id: 't-read-y', delta: -100, reason: 'missed', streak_after: 0, created_at: at(-565), habit: { title: 'Read 20 pages' } },
  { id: 3, target_id: 'x3', delta: 50, reason: 'verified', streak_after: 11, created_at: at(-1440), habit: { title: 'Morning run — 5 km' } },
  { id: 2, target_id: 'x2', delta: 50, reason: 'verified', streak_after: 3, created_at: at(-1600), habit: { title: 'Deep work — 2 hours' } },
];

const arena: ArenaRow[] = [
  ['Sofia K.', 3240, 41, 0], ['Luca V.', 2910, 26, 1], ['Tudor M.', 2780, 19, -1], ['Daria R.', 2450, 18, 2], ['Mihai P.', 2300, 9, 0],
  ['Elena S.', 2250, 31, -2], ['Andrei C.', 2100, 6, 4], ['Ioana D.', 1950, 3, -1], ['Radu T.', 1800, 14, 1], ['Maria L.', 1650, 8, 0],
].map(([n, p, s, c], i) => ({ rank: i + 1, user_id: `u${i}`, display_name: n as string, avatar_url: null, points: p as number, streak: s as number, rank_change: c as number, is_me: false }));
arena.push({ rank: 14, user_id: 'demo-me', display_name: 'Andrei', avatar_url: null, points: 1250, streak: 12, rank_change: 3, is_me: true });

const demoScore = {
  score: 74, provisional: false, day: new Date().toISOString().slice(0, 10),
  components: { completion: 80, recent: 86, consistency: 80, streak: 57 },
  weights: { completion: 45, recent: 25, consistency: 20, streak: 10 },
  counts: { settled_28: 60, verified_28: 48, settled_7: 14, verified_7: 12, days_14: 14, clean_days_14: 11, streak: 12 },
};

const templates: ChallengeTemplate[] = demoTemplates;

const challenges: Challenge[] = [
  { id: 'c-run', template_id: 'fitness-30', habit_id: 'h-run', habit_title: 'Morning run — 5 km', title: '30 Days of Fitness', kind: 'thirty_day', difficulty: 'intermediate', description: null, rules: null, source: 'template', objective_count: 1,
    start_date: new Date(Date.now() - 11 * 86_400_000).toISOString().slice(0, 10), end_date: new Date(Date.now() + 18 * 86_400_000).toISOString().slice(0, 10),
    weekdays: [1, 2, 3, 4, 5, 6], required_days: 26, allowed_misses: 3, bonus_points: 260, status: 'active', finished_at: null, created_at: at(-11 * 1440),
    progress: { done: 9, lost: 1, left: 16, required: 26, allowed_misses: 3, misses_left: 2, percent: 35, days_remaining: 19, today: new Date().toISOString().slice(0, 10) } },
];

export const demoApi: Api = {
  getProfile: async () => ({ ...profile }),
  updateProfile: async (patch) => { Object.assign(profile, patch); },
  getTargets: async () => targets.map((t) => ({ ...t, habit: habitRef(habits.find((h) => h.id === t.habit_id)!) })).sort((a, b) => a.due_at.localeCompare(b.due_at)),
  getTarget: async (tid) => {
    const t = targets.find((x) => x.id === tid);
    return t ? { ...t, habit: habitRef(habits.find((h) => h.id === t.habit_id)!) } : null;
  },
  getHabits: async () => habits.map((h) => ({ ...h })),
  getHabit: async (hid) => habits.find((h) => h.id === hid) ?? null,
  createHabit: async (input: HabitInput) => {
    const h: Habit = { ...input, id: id(), current_streak: 0, longest_streak: 0, archived_at: null };
    habits.push(h);
    return h;
  },
  updateHabit: async (hid, patch) => { Object.assign(habits.find((h) => h.id === hid)!, patch); },
  getRecentEvents: async (limit) => events.slice(0, limit),
  getArena: async () => { await sleep(400); return arena; },
  getStats: async () => ({ total_points: profile.total_points, current_streak: 12, longest_streak: 21, habits_completed: 142, settled_targets: 163, success_rate: 87, premium: true }),
  getEntitlement: async () => ({ is_active: true, period_type: 'trial', expires_at: at(3 * 1440), will_renew: true }),
  getMissed: async (tid) => {
    const t = targets.find((x) => x.id === tid) ?? targets[4];
    return {
      target: t, event: events.find((e) => e.target_id === t.id) ?? events[1], totalBefore: 1350, totalAfter: 1250, streakBefore: 6,
      next: targets.find((x) => x.habit_id === t.habit_id && x.status === 'pending') ?? null,
      lastCritique: null, habit: habits.find((h) => h.id === t.habit_id) ?? null,
    };
  },
  startProof: async (tid) => {
    const t = targets.find((x) => x.id === tid);
    const due = t ? new Date(t.due_at).getTime() : Date.now();
    return { session_id: id(), expires_at: at(3), window_opens_at: new Date(due - 15 * MIN).toISOString(), window_closes_at: new Date(due + 15 * MIN).toISOString(), server_time: new Date().toISOString() };
  },
  verifyProof: async (): Promise<VerdictResult> => {
    await sleep(2600);
    const t = targets.find((x) => x.id === 't-run')!;
    if (t.status === 'pending') { t.status = 'verified'; profile.total_points += 50; habits[1].current_streak += 1; }
    return { proof_id: id(), outcome: 'verified', verified: true, points_delta: 50, streak: habits[1].current_streak, total_points: profile.total_points, received_at: new Date().toISOString(), level: habits[1].verification_level, requested_evidence: null,
      critique: 'Running shoes, an outdoor track and a watch showing 5.02 km are visible. Target met inside the window.' };
  },
  getTargetReview: async (tid): Promise<TargetReview> => {
    const t = targets.find((x) => x.id === tid);
    if (!t || t.status === 'pending') return { proof: null, appeal: null, appealUntil: null };
    if (t.status === 'rejected') {
      return { proof: { id: `p-${tid}`, outcome: 'rejected', critique: 'Only a desk and a laptop are visible; nothing shows the run.', judged_at: at(-60), level: 'standard', requested_evidence: null },
        appeal: demoAppeals[tid] ?? null, appealUntil: demoAppeals[tid] ? null : at(47 * 60) };
    }
    return { proof: null, appeal: null, appealUntil: null };
  },
  appealProof: async (proofId, note): Promise<AppealResult> => {
    await sleep(2200);
    const tid = proofId.replace(/^p-/, '');
    demoAppeals[tid] = { id: id(), status: 'upheld', note, critique: 'The second review reached the same decision: the photos show a desk, not a run.', created_at: new Date().toISOString(), decided_at: new Date().toISOString() };
    return { appeal_id: demoAppeals[tid].id, status: 'upheld', critique: demoAppeals[tid].critique, points_delta: 0 };
  },
  getCoachMessages: async () => coach.slice(),
  askCoach: async (message) => {
    await sleep(1800);
    coach.push({ id: coach.length + 1, role: 'user', content: message, created_at: new Date().toISOString() });
    const reply = 'Demo mode: the coach answers from your real data once you sign in. In this demo, Read 20 pages is your weakest commitment — missed yesterday at its 20:00 window.\nNext: move Read 20 pages to 21:00 and put the book on your pillow.';
    coach.push({ id: coach.length + 1, role: 'coach', content: reply, created_at: new Date().toISOString() });
    return { reply, remaining: 19 };
  },
  isAdmin: async () => false,
  getAiUsage: async () => { throw new ApiError('demo', 'Demo mode: the usage overview needs a signed-in admin account.', 403); },
  getWeeklyReports: async (): Promise<WeeklyReports> => ({ locked: false, reports: [demoReport] }),
  getPlan: async (): Promise<Plan> => ({ premium: true, free_max_commitments: 2, active_commitments: habits.filter((h) => h.is_active && !h.archived_at).length }),
  getAchievements: async (): Promise<Achievement[]> => [
    ['first_proof', 'First proof', 'Your first verified target.', at(-60 * 24 * 40)], ['streak_7', 'One week straight', 'A 7-day streak on one commitment.', at(-60 * 24 * 30)],
    ['perfect_week', 'Perfect week', 'A Monday-to-Sunday week with at least 5 targets, all verified.', at(-60 * 24 * 9)], ['comeback', 'Comeback', 'Verified the next target after a miss.', at(-60 * 24 * 12)],
    ['points_1000', '1,000 points', 'Reach 1,000 total points.', at(-60 * 24 * 3)], ['challenge_done', 'Challenge complete', 'Finish a challenge.', null],
    ['score_80', 'Disciplined', 'A Discipline Score of 80 or more (not provisional).', null], ['streak_30', 'Thirty days', 'A 30-day streak on one commitment.', null],
  ].map(([key, title, description, unlocked_at]) => ({ key: key as string, title: title as string, description: description as string, unlocked_at: unlocked_at as string | null })),
  getPartners: async (): Promise<Partners> => ({ ...demoPartners, partners: demoPartners.partners.map((p) => ({ ...p })) }),
  createPartnerInvite: async () => { const inv = { code: 'K7QD3MPA', expires_at: at(7 * 1440) }; demoPartners.invites = [inv]; return inv; },
  acceptPartnerInvite: async () => { throw new Error('Demo mode: invite codes work once you sign in.'); },
  revokePartnerInvite: async (code) => { demoPartners.invites = demoPartners.invites.filter((i) => i.code !== code); return true; },
  removePartner: async (pid) => { demoPartners.partners = demoPartners.partners.filter((p) => p.id !== pid); return true; },
  nudgePartner: async (pid) => { const p = demoPartners.partners.find((x) => x.id === pid); if (!p || p.nudged_today) return false; p.nudged_today = true; return true; },
  refreshEntitlement: async () => ({ premium: true }),
  savePushToken: async () => {},
  deletePushTokens: async () => {},
  deleteAccount: async () => {},
  getWarRoom: async (): Promise<WarRoom> => {
    const today = targets.filter((t) => t.status !== 'missed' || t.id !== 't-read-y').filter((t) => t.id !== 't-read-y');
    return {
      today: new Date().toISOString().slice(0, 10),
      score: demoScore,
      total_points: profile.total_points,
      streak: 12,
      week: { settled: 23, verified: 20, success_rate: 87 },
      commitments: today.map((t) => {
        const h = habits.find((x) => x.id === t.habit_id)!;
        const due = new Date(t.due_at).getTime();
        const state = t.status === 'verified' ? 'verified' : t.status === 'missed' || t.status === 'rejected' ? 'failed'
          : Math.abs(Date.now() - due) <= 15 * MIN ? 'in_progress' : 'pending';
        return { target_id: t.id, habit_id: h.id, title: h.title, category: h.category, custom_category: null, due_at: t.due_at, streak: h.current_streak, state, critique: null };
      }),
      upcoming: targets.filter((t) => t.status === 'pending' && new Date(t.due_at).getTime() - 15 * MIN > Date.now())
        .map((t) => ({ target_id: t.id, title: habits.find((h) => h.id === t.habit_id)!.title, due_at: t.due_at })),
      recent: events.map((e) => ({ id: e.id, delta: e.delta, reason: e.reason, at: e.created_at, title: e.habit.title })),
      challenges: challenges.filter((c) => c.status === 'active').map((c) => ({ id: c.id, title: c.title, end_date: c.end_date, progress: c.progress })),
    };
  },
  getDiscipline: async (): Promise<Discipline> => ({
    current: demoScore,
    history: Array.from({ length: 30 }, (_, i) => ({ day: new Date(Date.now() - (29 - i) * 86_400_000).toISOString().slice(0, 10), score: Math.round(62 + i * 0.6 + Math.sin(i / 2) * 4), provisional: false })),
    weekly: [61, 66, 70, 74].map((avg, i) => ({ week: new Date(Date.now() - (3 - i) * 7 * 86_400_000).toISOString().slice(0, 10), avg })),
    monthly: [{ month: new Date().toISOString().slice(0, 8) + '01', avg: 72 }],
  }),
  getChallenges: async (): Promise<Challenges> => ({ templates, mine: challenges, bonus_per_day: 10,
    stats: { active: challenges.filter((c) => c.status === 'active').length, completed: 0, failed: 0, abandoned: challenges.filter((c) => c.status === 'abandoned').length, completion_rate: null, bonus_earned: 0 } }),
  // Demo fixture: the calendar is derived from the challenge's own progress numbers above.
  getChallengeDetail: async (cid) => {
    const c = challenges.find((x) => x.id === cid);
    if (!c) return null;
    const h = habits.find((x) => x.id === c.habit_id)!;
    const today = new Date().toISOString().slice(0, 10);
    const days: ChallengeDetail['days'] = [];
    let done = 0;
    for (let d = new Date(`${c.start_date}T12:00:00Z`); d.toISOString().slice(0, 10) <= c.end_date; d = new Date(d.getTime() + 86_400_000)) {
      const day = d.toISOString().slice(0, 10);
      const scheduled = c.weekdays.includes(((d.getUTCDay() + 6) % 7) + 1);
      const past = day < today;
      const lost = past && scheduled && done === 4 && !days.some((x) => x.state === 'lost');
      if (past && scheduled && !lost) done++;
      days.push({ day, targets: scheduled ? 1 : 0, ok: past && scheduled && !lost ? 1 : 0, bad: lost ? 1 : 0,
        state: day === today ? 'today' : !past ? 'upcoming' : lost ? 'lost' : scheduled ? 'done' : 'upcoming' });
    }
    const { habit_title: _ht, objective_count: _oc, ...rest } = c;
    return {
      ...rest, streak: 5,
      objectives: [{ habit_id: h.id, title: h.title, time: h.target_time.slice(0, 5), weekdays: c.weekdays, verification_level: h.verification_level, proof_hint: h.proof_hint, is_active: true, verified: c.progress.done, failed: c.progress.lost }],
      days,
      evidence: targets.filter((x) => x.habit_id === h.id && x.status !== 'pending').map((x) => ({
        target_id: x.id, due_at: x.due_at, title: h.title, status: x.status, outcome: x.status === 'verified' ? 'verified' : x.status === 'rejected' ? 'rejected' : null,
        level: h.verification_level, critique: x.status === 'verified' ? 'Treadmill display shows 5.0 km; runner visible.' : null, requested_evidence: null, appeal: null,
      })),
    };
  },
  startChallengePlan: async () => { throw new ApiError('demo', 'Demo mode: starting plans needs a signed-in account.', 400); },
  // No fake AI: the generator only runs against the real server.
  generateChallenge: async () => { throw new ApiError('ai_unavailable', 'Demo mode: the AI generator only runs with a signed-in account.', 503); },
  exportMyData: async () => ({ profile }),
  deleteEvidence: async () => 0,
  startChallenge: async (habitId, template) => {
    const tpl = typeof template === 'string' ? templates.find((t) => t.id === template)! : null;
    const days = tpl ? tpl.duration_days : (template as { days: number }).days;
    const c: Challenge = {
      id: id(), template_id: tpl?.id ?? null, habit_id: habitId, habit_title: habits.find((h) => h.id === habitId)?.title ?? '',
      title: tpl ? tpl.title : (template as { title: string }).title, start_date: new Date().toISOString().slice(0, 10),
      end_date: new Date(Date.now() + (days - 1) * 86_400_000).toISOString().slice(0, 10), weekdays: [1, 2, 3, 4, 5, 6, 7],
      required_days: days, allowed_misses: tpl ? tpl.allowed_misses : 0, bonus_points: days * 10, status: 'active', finished_at: null,
      kind: tpl?.kind ?? 'custom', difficulty: tpl?.difficulty ?? 'intermediate', description: null, rules: null, source: tpl ? 'template' : 'custom', objective_count: 1,
      created_at: new Date().toISOString(),
      progress: { done: 0, lost: 0, left: days, required: days, allowed_misses: tpl ? tpl.allowed_misses : 0, misses_left: tpl ? tpl.allowed_misses : 0, percent: 0, days_remaining: days, today: new Date().toISOString().slice(0, 10) },
    };
    challenges.unshift(c);
    return c.id;
  },
  abandonChallenge: async (cid) => { const c = challenges.find((x) => x.id === cid); if (!c || c.status !== 'active') return false; c.status = 'abandoned'; return true; },
  archiveHabit: async (hid) => { const h = habits.find((x) => x.id === hid); if (h) { h.archived_at = new Date().toISOString(); h.is_active = false; } },
  getHabitHistory: async (hid) => targets.filter((t) => t.habit_id === hid).map((t) => ({ ...t, habit: habitRef(habits.find((h) => h.id === t.habit_id)!) })).reverse(),
};
