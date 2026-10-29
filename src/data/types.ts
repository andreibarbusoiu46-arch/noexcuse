export type TargetStatus = 'pending' | 'verified' | 'rejected' | 'missed' | 'excused';
export type ProofOutcome = 'processing' | 'verified' | 'rejected' | 'insufficient' | 'expired' | 'error';

export interface Profile {
  id: string;
  display_name: string;
  timezone: string;
  total_points: number;
}

export interface Habit {
  id: string;
  title: string;
  proof_hint: string | null;
  target_time: string; // "HH:MM:SS" local wall time
  weekdays: number[]; // ISO 1 = Monday … 7 = Sunday
  is_active: boolean;
  reminder_minutes: number;
  current_streak: number;
  longest_streak: number;
}

export type HabitInput = Pick<Habit, 'title' | 'proof_hint' | 'target_time' | 'weekdays' | 'is_active' | 'reminder_minutes'>;

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
  reason: 'verified' | 'rejected' | 'expired' | 'missed';
  streak_after: number;
  created_at: string;
  habit: { title: string };
}

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
}
