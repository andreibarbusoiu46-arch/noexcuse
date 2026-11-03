export type TargetStatus = 'pending' | 'verified' | 'rejected' | 'missed' | 'excused';
export type ProofOutcome = 'processing' | 'verified' | 'rejected' | 'insufficient' | 'expired' | 'error';

export interface Profile {
  id: string;
  display_name: string;
  timezone: string;
  total_points: number;
}

export type Category = 'fitness' | 'health' | 'education' | 'productivity' | 'business' | 'personal' | 'lifestyle' | 'custom';

export interface Habit {
  id: string;
  title: string;
  category: Category;
  custom_category: string | null;
  description: string | null;
  /** Private: never shown to anyone else. */
  notes: string | null;
  archived_at: string | null;
  proof_hint: string | null;
  target_time: string; // "HH:MM:SS" local wall time
  weekdays: number[]; // ISO 1 = Monday … 7 = Sunday
  is_active: boolean;
  reminder_minutes: number;
  current_streak: number;
  longest_streak: number;
}

export type HabitInput = Pick<Habit, 'title' | 'proof_hint' | 'target_time' | 'weekdays' | 'is_active' | 'reminder_minutes' | 'category' | 'custom_category' | 'description' | 'notes'>;

export interface Target {
  id: string;
  habit_id: string;
  local_date: string;
  due_at: string;
  status: TargetStatus;
  settled_at: string | null;
  habit: Pick<Habit, 'id' | 'title' | 'proof_hint' | 'current_streak' | 'is_active'>;
}

export interface ScoreEvent {
  id: number;
  target_id: string;
  delta: number;
  reason: 'verified' | 'rejected' | 'expired' | 'missed' | 'challenge_bonus';
  streak_after: number;
  created_at: string;
  habit: { title: string };
}

// ---------- War Room / Discipline Score / Challenges (server read models) ----------

/** What a commitment is doing right now. Derived on the server from target + latest proof. */
export type CommitmentState = 'pending' | 'in_progress' | 'submitted' | 'needs_evidence' | 'verified' | 'failed' | 'excused';

export interface DisciplineScore {
  score: number | null;
  provisional: boolean;
  day: string;
  components: { completion: number; recent: number; consistency: number; streak: number } | null;
  /** Percent weights, summing to 100. */
  weights: { completion: number; recent: number; consistency: number; streak: number };
  counts: { settled_28: number; verified_28: number; settled_7: number; verified_7: number; days_14: number; clean_days_14: number; streak: number };
}

export interface Discipline {
  current: DisciplineScore | null;
  history: { day: string; score: number; provisional: boolean }[];
  weekly: { week: string; avg: number }[];
  monthly: { month: string; avg: number }[];
}

export interface ChallengeProgress {
  done: number;
  lost: number;
  left: number;
  required: number;
  allowed_misses: number;
  misses_left: number;
  percent: number;
  days_remaining: number;
  today: string;
}

export interface WarRoom {
  today: string;
  score: DisciplineScore | null;
  total_points: number;
  streak: number;
  week: { settled: number; verified: number; success_rate: number | null };
  commitments: { target_id: string; habit_id: string; title: string; category: Category; custom_category: string | null; due_at: string; streak: number; state: CommitmentState; critique: string | null }[];
  upcoming: { target_id: string; title: string; due_at: string }[];
  recent: { id: number; delta: number; reason: ScoreEvent['reason']; at: string; title: string }[];
  challenges: { id: string; title: string; end_date: string; progress: ChallengeProgress }[];
}

export interface ChallengeTemplate {
  id: string;
  title: string;
  tagline: string;
  description: string;
  category: Category;
  duration_days: number;
  allowed_misses: number;
  habit_title: string | null;
  habit_time: string | null;
  habit_weekdays: number[] | null;
  proof_hint: string | null;
}

export interface Challenge {
  id: string;
  template_id: string | null;
  habit_id: string;
  habit_title: string;
  title: string;
  start_date: string;
  end_date: string;
  weekdays: number[];
  required_days: number;
  allowed_misses: number;
  bonus_points: number;
  status: 'active' | 'completed' | 'failed' | 'abandoned';
  finished_at: string | null;
  created_at: string;
  progress: ChallengeProgress;
}

export interface Challenges {
  templates: ChallengeTemplate[];
  mine: Challenge[];
  bonus_per_day: number;
}

export interface CustomChallenge { title: string; days: number; allowedMisses: number }

export interface ArenaRow {
  rank: number;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  points: number;
  streak: number;
  rank_change: number | null;
  is_me: boolean;
}

export interface Stats {
  total_points: number;
  current_streak: number;
  longest_streak: number;
  habits_completed: number;
  settled_targets: number;
  success_rate: number | null;
  premium: boolean;
}

export interface Entitlement {
  is_active: boolean;
  period_type: string | null;
  expires_at: string | null;
  will_renew: boolean | null;
}

export interface CaptureSession {
  session_id: string;
  expires_at: string;
  window_opens_at: string;
  window_closes_at: string;
  server_time: string;
}

export interface VerdictResult {
  proof_id: string;
  outcome: Exclude<ProofOutcome, 'processing'>;
  verified: boolean;
  critique: string;
  points_delta: number;
  streak?: number;
  total_points?: number;
  target_status?: TargetStatus;
  already_settled?: boolean;
  received_at: string;
}

export interface MissedDetail {
  target: Target;
  event: ScoreEvent | null;
  totalBefore: number;
  totalAfter: number;
  streakBefore: number;
  next: Target | null;
  lastCritique: string | null;
  habit: Habit | null;
}

export interface Api {
  getProfile(): Promise<Profile>;
  updateProfile(patch: Partial<Pick<Profile, 'display_name' | 'timezone'>>): Promise<void>;
  getTargets(fromIso: string, toIso: string): Promise<Target[]>;
  getTarget(id: string): Promise<Target | null>;
  getHabits(): Promise<Habit[]>;
  getHabit(id: string): Promise<Habit | null>;
  createHabit(input: HabitInput): Promise<Habit>;
  updateHabit(id: string, patch: Partial<HabitInput>): Promise<void>;
  getRecentEvents(limit: number): Promise<ScoreEvent[]>;
  getArena(): Promise<ArenaRow[]>;
  getStats(): Promise<Stats>;
  getEntitlement(): Promise<Entitlement | null>;
  getMissed(targetId: string): Promise<MissedDetail>;
  startProof(targetId: string): Promise<CaptureSession>;
  verifyProof(sessionId: string, imageBase64: string): Promise<VerdictResult>;
  refreshEntitlement(): Promise<{ premium: boolean }>;
  savePushToken(token: string, platform: 'ios' | 'android'): Promise<void>;
  deletePushTokens(): Promise<void>;
  deleteAccount(): Promise<void>;
  getWarRoom(): Promise<WarRoom>;
  getDiscipline(): Promise<Discipline>;
  getChallenges(): Promise<Challenges>;
  /** Starts a challenge on one of the user's active commitments. Template id, or a custom definition. */
  startChallenge(habitId: string, template: string | CustomChallenge): Promise<string>;
  abandonChallenge(id: string): Promise<boolean>;
  /** Archived commitments keep their history and can't be restored. */
  archiveHabit(id: string): Promise<void>;
  /** Settled and upcoming targets of one commitment, newest first. */
  getHabitHistory(id: string, limit: number): Promise<Target[]>;
}
