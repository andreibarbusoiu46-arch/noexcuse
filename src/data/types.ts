export type TargetStatus = 'pending' | 'verified' | 'rejected' | 'missed' | 'excused';
export type ProofOutcome = 'processing' | 'verified' | 'rejected' | 'insufficient' | 'expired' | 'error';

export interface NotifyPrefs { reminders: boolean; heads_up: boolean; last_call: boolean; weekly_report: boolean; partners: boolean }

export interface Profile {
  id: string;
  display_name: string;
  timezone: string;
  total_points: number;
  notify_prefs: NotifyPrefs;
  language: 'en' | 'ro';
  theme: 'dark' | 'light' | 'system';
  evidence_retention: 'keep' | '30d';
  username?: string | null;
  /** Storage path in the public "avatars" bucket; see avatarUrl(). */
  avatar_path?: string | null;
  arena_visible?: boolean;
  show_streak?: boolean;
  show_challenge?: boolean;
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

import type { Activity } from '@/shared/activity';
export type { Activity } from '@/shared/activity';

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
  /** Set when the commitment belongs to a challenge plan. */
  challenge_id?: string | null;
  /** What kind of evidence to ask for; null = detected from the title. */
  activity?: Activity | null;
}

export type HabitInput = Pick<Habit, 'title' | 'proof_hint' | 'target_time' | 'weekdays' | 'is_active' | 'reminder_minutes' | 'category' | 'custom_category' | 'description' | 'notes' | 'verification_level'> & { activity?: Activity | null };

export interface Target {
  id: string;
  habit_id: string;
  local_date: string;
  due_at: string;
  status: TargetStatus;
  settled_at: string | null;
  habit: Pick<Habit, 'id' | 'title' | 'proof_hint' | 'current_streak' | 'is_active' | 'verification_level' | 'activity'> & { category?: Category };
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
  kind: ChallengeKind;
  difficulty: Difficulty;
  /** Null for templates that run on a commitment the user already has. */
  objectives: PlanObjective[] | null;
  rules: string | null;
  evidence: string | null;
}

export type ChallengeKind = 'daily' | 'weekly' | 'seven_day' | 'thirty_day' | 'custom' | 'elite';
export type Difficulty = 'beginner' | 'intermediate' | 'advanced' | 'elite';
export const CHALLENGE_KINDS: ChallengeKind[] = ['daily', 'weekly', 'seven_day', 'thirty_day', 'custom', 'elite'];
export const DIFFICULTIES: Difficulty[] = ['beginner', 'intermediate', 'advanced', 'elite'];

export interface PlanObjective {
  title: string;
  /** HH:MM, the user's local time. */
  time: string;
  weekdays: number[];
  proof_hint: string | null;
  verification_level: Level;
}

/** A challenge plan: from a template, built by hand, or generated by the AI and approved by the user. */
export interface ChallengePlan {
  title: string;
  description: string;
  rules: string;
  evidence?: string;
  progression?: string;
  kind: ChallengeKind;
  difficulty: Difficulty;
  duration_days: number;
  allowed_misses: number;
  objectives: PlanObjective[];
}

export type PlanInput = Partial<Omit<ChallengePlan, 'objectives'>> & { objectives: Partial<PlanObjective>[] };

export interface GenerateChallengeInput { goal: string; minutes_per_day: number; difficulty: Difficulty; duration_days?: number }

export interface Challenge {
  id: string;
  template_id: string | null;
  habit_id: string;
  habit_title: string;
  kind: ChallengeKind;
  difficulty: Difficulty;
  description: string | null;
  rules: string | null;
  source: 'template' | 'custom' | 'ai' | null;
  objective_count: number;
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

export interface ChallengeStats {
  active: number; completed: number; failed: number; abandoned: number;
  /** Completed ÷ ended, in %; null until one has ended. */
  completion_rate: number | null;
  bonus_earned: number;
}

export interface Challenges {
  templates: ChallengeTemplate[];
  mine: Challenge[];
  bonus_per_day: number;
  stats: ChallengeStats;
}

export type ChallengeDayState = 'done' | 'lost' | 'today' | 'upcoming';

export interface ChallengeDetail extends Omit<Challenge, 'habit_title' | 'objective_count'> {
  streak: number;
  objectives: { habit_id: string; title: string; time: string; weekdays: number[]; verification_level: Level; proof_hint: string | null; is_active: boolean; verified: number; failed: number }[];
  days: { day: string; state: ChallengeDayState; targets: number; ok: number; bad: number }[];
  evidence: { target_id: string; due_at: string; title: string; status: Target['status']; outcome: ProofOutcome | null; level: Level | null; critique: string | null; requested_evidence: string | null; appeal: AppealStatus | null }[];
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
  /** stripe (web) or the App Store via RevenueCat. */
  source?: 'stripe' | 'app_store' | 'play_store' | string;
  /** Stripe status: trialing | active | past_due | unpaid | canceled | incomplete | … */
  status?: string;
  trial_end?: string | null;
  current_period_start?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean;
  canceled_at?: string | null;
  payment_failed?: boolean;
}

export interface CaptureSession {
  session_id: string;
  expires_at: string;
  window_opens_at: string;
  window_closes_at: string;
  server_time: string;
}

/** The AI's structured analysis of one submission (validated and adjusted by the server). */
export interface ProofAnalysis {
  status: 'VERIFIED' | 'NEEDS_MORE_EVIDENCE' | 'REJECTED';
  confidence: number;
  summary: string;
  evidence: { image: number; kind: EvidenceKind; shows: string; relevant: boolean; concerns: string }[];
  requirements: { id: string; label: string; kind: EvidenceKind; required: boolean; satisfied: boolean; image: number | null; note: string }[];
  missing: string[];
  consistency: string;
  explanation: string;
  next_action: string;
  activity: Activity;
  level: Level;
  model_status: string;
  provider?: string;
  model?: string;
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
  /** Per-requirement and per-image analysis; null when the AI didn't run (expired, error). */
  analysis?: ProofAnalysis | null;
}

export type ArenaPeriod = 'week' | 'month' | 'all';
export interface ArenaQuery { period: ArenaPeriod; sort: 'points' | 'streak'; search: string; scope: 'all' | 'partners'; offset: number; limit: number }
export interface ArenaMember {
  rank: number; user_id: string; display_name: string; username: string | null; avatar_path: string | null;
  points: number; total_points: number; level: number; streak: number | null; challenge: string | null;
  is_me: boolean; is_partner: boolean;
}
export interface ArenaBoard {
  period: ArenaPeriod; since: string | null; total: number; eligible: number; rows: ArenaMember[];
  me: { rank: number | null; points: number; level: number; hidden?: boolean } | null;
}

/** Internal AI usage overview (admins only). Costs are estimates from public prices. */
export interface AiUsageOverview {
  since: string;
  totals: { calls: number; ok: number; errors: number; input_tokens: number; output_tokens: number; thinking_tokens: number; total_tokens: number; est_cost_usd: number; unpriced_calls: number; avg_latency_ms: number | null };
  by_feature: { feature: string; calls: number; errors: number; total_tokens: number }[];
  by_model: { model: string; provider: string | null; calls: number; total_tokens: number; est_cost_usd: number | null }[];
  errors: { status: string; count: number; last_at: string }[];
  daily: { day: string; calls: number; errors: number; total_tokens: number }[];
}

export interface EvidenceImage { kind: EvidenceKind; base64: string }

export type AppealStatus = 'pending' | 'upheld' | 'overturned' | 'unavailable';
export interface Appeal { id: string; status: AppealStatus; note: string | null; critique: string | null; created_at: string; decided_at: string | null }
export interface AppealResult { appeal_id: string; status: AppealStatus; critique: string | null; points_delta: number; streak?: number; total_points?: number }

/** The latest judged proof of a target and its appeal, if any. */
export interface TargetReview {
  proof: { id: string; outcome: ProofOutcome; critique: string | null; judged_at: string | null; level: Level; requested_evidence: string | null; analysis?: ProofAnalysis | null } | null;
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
  updateProfile(patch: Partial<Pick<Profile, 'display_name' | 'timezone' | 'notify_prefs' | 'language' | 'theme' | 'evidence_retention' | 'username' | 'arena_visible' | 'show_streak' | 'show_challenge'>>): Promise<void>;
  getTargets(fromIso: string, toIso: string): Promise<Target[]>;
  getTarget(id: string): Promise<Target | null>;
  getHabits(): Promise<Habit[]>;
  getHabit(id: string): Promise<Habit | null>;
  createHabit(input: HabitInput): Promise<Habit>;
  updateHabit(id: string, patch: Partial<HabitInput> & { archived_at?: string | null }): Promise<void>;
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
  /** Null if it doesn't exist or isn't yours. */
  getChallengeDetail(id: string): Promise<ChallengeDetail | null>;
  /** With a template id, only each objective's time, days, title and proof text may differ from the template. */
  startChallengePlan(plan: PlanInput, templateId: string | null, source: 'template' | 'custom' | 'ai'): Promise<string>;
  /** Asks the AI for a plan. Creates nothing — the user approves it first. */
  generateChallenge(input: GenerateChallengeInput): Promise<ChallengePlan>;
  /** Everything stored about the account, as JSON (photos excluded). */
  exportMyData(): Promise<unknown>;
  /** Deletes every evidence photo from storage. Results and points stay. */
  deleteEvidence(): Promise<number>;
  /** Archived commitments keep their history and can't be restored. */
  archiveHabit(id: string): Promise<void>;
  /** Settled and upcoming targets of one commitment, newest first. */
  getHabitHistory(id: string, limit: number): Promise<Target[]>;
  /** Brings an archived commitment back, paused. */
  restoreHabit(id: string): Promise<void>;
  /** Permanently deletes a commitment and its photos ('erased' = no history; 'removed' = content erased, results kept). */
  deleteHabit(id: string): Promise<'erased' | 'removed'>;
  /** Failed or abandoned challenges only. */
  deleteChallenge(id: string): Promise<void>;
  /** Uploads a JPEG (already resized) as the profile photo; returns its storage path. */
  setAvatar(image: { base64: string }): Promise<string>;
  removeAvatar(): Promise<void>;
  getArenaBoard(q: ArenaQuery): Promise<ArenaBoard>;
  /** Whether this account may see the internal AI usage overview. */
  isAdmin(): Promise<boolean>;
  getAiUsage(days: number): Promise<AiUsageOverview>;
}
