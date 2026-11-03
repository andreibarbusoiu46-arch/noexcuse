// Demo mode (EXPO_PUBLIC_DEMO=1): fixture data shaped exactly like the live API.
// No backend, no AI, no purchases — for design review and Expo Go only. Never ships with this flag on.
import type { Challenge, Challenges, ChallengeTemplate, Discipline, WarRoom, Api, ArenaRow, Habit, HabitInput, Profile, ScoreEvent, Target, VerdictResult } from './types';

const MIN = 60_000;
const at = (offsetMin: number) => new Date(Date.now() + offsetMin * MIN).toISOString();
const hhmm = (offsetMin: number) => {
  const d = new Date(Date.now() + offsetMin * MIN);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 100;
const id = () => `demo-${++seq}`;

const profile: Profile = { id: 'demo-me', display_name: 'Andrei', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, total_points: 1250 };

const habits: Habit[] = [
  { id: 'h-shower', category: 'health', custom_category: null, description: null, notes: null, archived_at: null, title: 'Cold shower — 3 min', proof_hint: 'Me under the running shower, timer visible on my phone.', target_time: hhmm(-180), weekdays: [1, 2, 3, 4, 5, 6, 7], is_active: true, reminder_minutes: 10, current_streak: 12, longest_streak: 21 },
  { id: 'h-run', category: 'fitness', custom_category: null, description: null, notes: null, archived_at: null, title: 'Morning run — 5 km', proof_hint: 'Outdoor track or road, with my watch showing the distance.', target_time: hhmm(5), weekdays: [1, 2, 3, 4, 5, 6], is_active: true, reminder_minutes: 10, current_streak: 12, longest_streak: 12 },
  { id: 'h-work', category: 'productivity', custom_category: null, description: null, notes: null, archived_at: null, title: 'Deep work — 2 hours', proof_hint: 'Desk with the focus timer on screen.', target_time: hhmm(170), weekdays: [1, 2, 3, 4, 5], is_active: true, reminder_minutes: 10, current_streak: 4, longest_streak: 9 },
  { id: 'h-read', category: 'education', custom_category: null, description: null, notes: null, archived_at: null, title: 'Read 20 pages', proof_hint: 'The open book with the page number and a clock in frame.', target_time: hhmm(860), weekdays: [1, 2, 3, 4, 5, 6, 7], is_active: true, reminder_minutes: 10, current_streak: 0, longest_streak: 6 },
  { id: 'h-gym', category: 'fitness', custom_category: null, description: null, notes: null, archived_at: null, title: 'Gym — upper body', proof_hint: null, target_time: '18:00:00', weekdays: [2, 4], is_active: false, reminder_minutes: 10, current_streak: 0, longest_streak: 3 },
];
const habitRef = (h: Habit) => ({ id: h.id, title: h.title, proof_hint: h.proof_hint, current_streak: h.current_streak, is_active: h.is_active });

const targets: Target[] = [
  { id: 't-shower', habit_id: 'h-shower', local_date: '', due_at: at(-180), status: 'verified', settled_at: at(-173), habit: habitRef(habits[0]) },
  { id: 't-run', habit_id: 'h-run', local_date: '', due_at: at(5), status: 'pending', settled_at: null, habit: habitRef(habits[1]) },
  { id: 't-work', habit_id: 'h-work', local_date: '', due_at: at(170), status: 'pending', settled_at: null, habit: habitRef(habits[2]) },
  { id: 't-read', habit_id: 'h-read', local_date: '', due_at: at(860), status: 'pending', settled_at: null, habit: habitRef(habits[3]) },
  { id: 't-read-y', habit_id: 'h-read', local_date: '', due_at: at(-580), status: 'missed', settled_at: at(-565), habit: habitRef(habits[3]) },
];

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

const templates: ChallengeTemplate[] = [
  { id: 'discipline-30', title: '30 Days of Discipline', tagline: 'One commitment. Thirty days. Up to two misses.', description: 'Pick any commitment you already have and keep it for 30 days. You can miss at most two scheduled days.', category: 'personal', duration_days: 30, allowed_misses: 2, habit_title: null, habit_time: null, habit_weekdays: null, proof_hint: null },
  { id: 'no-excuses-30', title: '30 Days Without Excuses', tagline: 'Thirty days. Zero misses.', description: 'Keep one commitment every scheduled day for 30 days. A single miss ends the challenge.', category: 'personal', duration_days: 30, allowed_misses: 0, habit_title: null, habit_time: null, habit_weekdays: null, proof_hint: null },
  { id: 'early-7', title: '7 Days of Early Mornings', tagline: 'Up at six, seven days running.', description: 'Prove you are up and moving at 06:00 every day for a week.', category: 'lifestyle', duration_days: 7, allowed_misses: 0, habit_title: 'Up at 06:00', habit_time: '06:00:00', habit_weekdays: [1, 2, 3, 4, 5, 6, 7], proof_hint: 'My face and a clock or phone screen showing the time, in a lit room.' },
  { id: 'fitness-30', title: '30 Days of Fitness', tagline: 'A workout a day for a month. Three misses allowed.', description: 'Train every day for 30 days. Gym, run, home workout — the photo has to show it.', category: 'fitness', duration_days: 30, allowed_misses: 3, habit_title: 'Workout — 30 min', habit_time: '18:00:00', habit_weekdays: [1, 2, 3, 4, 5, 6, 7], proof_hint: 'Me training, or the gym floor / equipment with me in frame.' },
  { id: 'deep-work-21', title: '21 Days of Deep Work', tagline: 'Ninety focused minutes, every weekday.', description: 'Three weeks of weekday deep-work blocks. One miss allowed.', category: 'productivity', duration_days: 21, allowed_misses: 1, habit_title: 'Deep work — 90 min', habit_time: '09:00:00', habit_weekdays: [1, 2, 3, 4, 5], proof_hint: 'My desk with the focus timer or the work itself on screen.' },
  { id: 'reading-30', title: '30 Days of Reading', tagline: 'Twenty pages a night for a month.', description: 'Read every evening for 30 days. Two misses allowed.', category: 'education', duration_days: 30, allowed_misses: 2, habit_title: 'Read 20 pages', habit_time: '21:30:00', habit_weekdays: [1, 2, 3, 4, 5, 6, 7], proof_hint: 'The open book with the page number visible.' },
];

const challenges: Challenge[] = [
  { id: 'c-run', template_id: 'fitness-30', habit_id: 'h-run', habit_title: 'Morning run — 5 km', title: '30 Days of Fitness',
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
    return { proof_id: id(), outcome: 'verified', verified: true, points_delta: 50, streak: habits[1].current_streak, total_points: profile.total_points, received_at: new Date().toISOString(),
      critique: 'Running shoes, an outdoor track and a watch showing 5.02 km are visible. Target met inside the window.' };
  },
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
  getChallenges: async (): Promise<Challenges> => ({ templates, mine: challenges, bonus_per_day: 10 }),
  startChallenge: async (habitId, template) => {
    const tpl = typeof template === 'string' ? templates.find((t) => t.id === template)! : null;
    const days = tpl ? tpl.duration_days : (template as { days: number }).days;
    const c: Challenge = {
      id: id(), template_id: tpl?.id ?? null, habit_id: habitId, habit_title: habits.find((h) => h.id === habitId)?.title ?? '',
      title: tpl ? tpl.title : (template as { title: string }).title, start_date: new Date().toISOString().slice(0, 10),
      end_date: new Date(Date.now() + (days - 1) * 86_400_000).toISOString().slice(0, 10), weekdays: [1, 2, 3, 4, 5, 6, 7],
      required_days: days, allowed_misses: tpl ? tpl.allowed_misses : 0, bonus_points: days * 10, status: 'active', finished_at: null,
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
