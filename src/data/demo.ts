// Demo mode (EXPO_PUBLIC_DEMO=1): fixture data shaped exactly like the live API.
// No backend, no AI, no purchases — for design review and Expo Go only. Never ships with this flag on.
import type { Api, ArenaRow, Habit, HabitInput, Profile, ScoreEvent, Target, VerdictResult } from './types';

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
  { id: 'h-shower', title: 'Cold shower — 3 min', proof_hint: 'Me under the running shower, timer visible on my phone.', target_time: hhmm(-180), weekdays: [1, 2, 3, 4, 5, 6, 7], is_active: true, reminder_minutes: 10, current_streak: 12, longest_streak: 21 },
  { id: 'h-run', title: 'Morning run — 5 km', proof_hint: 'Outdoor track or road, with my watch showing the distance.', target_time: hhmm(5), weekdays: [1, 2, 3, 4, 5, 6], is_active: true, reminder_minutes: 10, current_streak: 12, longest_streak: 12 },
  { id: 'h-work', title: 'Deep work — 2 hours', proof_hint: 'Desk with the focus timer on screen.', target_time: hhmm(170), weekdays: [1, 2, 3, 4, 5], is_active: true, reminder_minutes: 10, current_streak: 4, longest_streak: 9 },
  { id: 'h-read', title: 'Read 20 pages', proof_hint: 'The open book with the page number and a clock in frame.', target_time: hhmm(860), weekdays: [1, 2, 3, 4, 5, 6, 7], is_active: true, reminder_minutes: 10, current_streak: 0, longest_streak: 6 },
  { id: 'h-gym', title: 'Gym — upper body', proof_hint: null, target_time: '18:00:00', weekdays: [2, 4], is_active: false, reminder_minutes: 10, current_streak: 0, longest_streak: 3 },
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
    const h: Habit = { ...input, id: id(), current_streak: 0, longest_streak: 0 };
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
};
