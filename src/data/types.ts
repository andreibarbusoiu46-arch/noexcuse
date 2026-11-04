export type TargetStatus = 'pending' | 'verified' | 'rejected' | 'missed' | 'excused';
export type ProofOutcome = 'processing' | 'verified' | 'rejected' | 'insufficient' | 'expired' | 'error';

export interface NotifyPrefs { reminders: boolean; heads_up: boolean; last_call: boolean; weekly_report: boolean; partners: boolean }

export interface Profile {
  id: string;
  display_name: string;
  timezone: string;
  total_points: number;
  notify_prefs: NotifyPrefs;
}

export interface CoachMessage { id: number; role: 'user' | 'coach'; content: string; created_at: string }

export interface WeeklyReportData {
  week_start: string; week_end: string;
  settled: number; verified: number; missed: number; rejected: number; excused: number;
  success_rate: number | null; previous_success_rate: number | null;
  points: number; score_start: number | null; score_end: number | null;
  best: { title: string; verified: number; settled: number } | null;
  worst: { title: string; verified: number; settled: number } | null;
  best_day: string | null; hardest_day: string | null;
  commitments: { title: string; verified: number; settled: number }[];
  challenges_completed: number; challenges_failed: number; longest_streak: number;
}
export interface WeeklyReport { id: string; week_start: string; data: WeeklyReportData; created_at: string }
export interface Plan { premium: boolean; free_max_commitments: number; active_commitments: number }

export interface Achievement { key: string; title: string; description: string; unlocked_at: string | null }

export interface Partner {
  id: string;
  display_name: string;
  total_points: number;
  score: { score: number | null; provisional: boolean } | null;
  streak: number;
  week: { settled: number; verified: number };
  today: { title: string; due_at: string; state: 'pending' | 'in_progress' | 'verified' | 'failed' | 'excused' }[];
  since: string;
  nudged_today: boolean;
}
export interface Partners { partners: Partner[]; invites: { code: string; expires_at: string }[]; max_partners: number; can_invite: boolean }

export interface WeeklyReports { locked: boolean; count?: number; reports: WeeklyReport[] }

export type Level = 'standard' | 'strict' | 'elite';
export type EvidenceKind = 'live' | 'screenshot';

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
  /** Strict and Elite are Premium; the server judges at Standard without it. */
  verification_level: Level;
  proof_hint: string | null;
  target_time: string; // "HH:MM:SS" local wall time
  weekdays: number[]; // ISO 1 = Monday … 7 = Sunday
  is_active: boolean;
  reminder_minutes: number;
  current_streak: number;
  longest_streak: number;
}

export type HabitInput = Pick<Habit, 'title' | 'proof_hint' | 'target_time' | 'weekdays' | 'is_active' | 'reminder_minutes' | 'category' | 'custom_category' | 'description' | 'notes' | 'verification_level'>;

export interface Target {
  id: string;
  habit_id: string;
  local_date: string;
  due_at: string;
  status: TargetStatus;
  settled_at: string | null;
  habit: Pick<Habit, 'id' | 'title' | 'proof_hint' | 'current_streak' | 'is_active' | 'verification_level'>;
}

export interface ScoreEvent {
  id: number;
  target_id: string;
  delta: number;
  reason: 'verified' | 'rejected' | 'expired' | 'missed' | 'challenge_bonus' | 'appeal_reversal';
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
  level?: Level;
  /** When more evidence is needed: exactly what to capture next. */
  requested_evidence?: string | null;
}

export interface EvidenceImage { kind: EvidenceKind; base64: string }

export type AppealStatus = 'pending' | 'upheld' | 'overturned' | 'unavailable';
export interface Appeal { id: string; status: AppealStatus; note: string | null; critique: string | null; created_at: string; decided_at: string | null }
export interface AppealResult { appeal_id: string; status: AppealStatus; critique: string | null; points_delta: number; streak?: number; total_points?: number }

/** The latest judged proof of a target and its appeal, if any. */
export interface TargetReview {
  proof: { id: string; outcome: ProofOutcome; critique: string | null; judged_at: string | null; level: Level; requested_evidence: string | null } | null;
  appeal: Appeal | null;
  /** Until when an appeal can be filed (rejected proofs only). */
  appealUntil: string | null;
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
  updateProfile(patch: Partial<Pick<Profile, 'display_name' | 'timezone' | 'notify_prefs'>>): Promise<void>;
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
  verifyProof(sessionId: string, images: EvidenceImage[]): Promise<VerdictResult>;
  getTargetReview(targetId: string): Promise<TargetReview>;
  /** One AI re-review per rejected proof (Premium). */
  appealProof(proofId: string, note: string | null): Promise<AppealResult>;
  getCoachMessages(limit: number): Promise<CoachMessage[]>;
  /** Premium; limited per day. */
  askCoach(message: string): Promise<{ reply: string; remaining: number }>;
  getWeeklyReports(): Promise<WeeklyReports>;
  getPartners(): Promise<Partners>;
  /** What this account may do. The server enforces every limit; this is for the UI. */
  getPlan(): Promise<Plan>;
  getAchievements(): Promise<Achievement[]>;
  /** Premium. */
  createPartnerInvite(): Promise<{ code: string; expires_at: string }>;
  acceptPartnerInvite(code: string): Promise<{ partner_id: string; display_name: string }>;
  revokePartnerInvite(code: string): Promise<boolean>;
  removePartner(id: string): Promise<boolean>;
  /** Once per partner per day. Returns false if already nudged today. */
  nudgePartner(id: string): Promise<boolean>;
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
