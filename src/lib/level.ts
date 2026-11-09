// Levels from all-time points. Mirrors public.level_for() in supabase/migrations/20261107100000_phase7.sql.
const STEPS = [0, 250, 750, 1500, 3000, 6000, 12000] as const;

export interface LevelInfo { level: number; floor: number; next: number | null; progress: number }

export function levelOf(points: number): LevelInfo {
  let level = 1;
  for (let i = 0; i < STEPS.length; i++) if (points >= STEPS[i]) level = i + 1;
  const floor = STEPS[level - 1];
  const next = level < STEPS.length ? STEPS[level] : null;
  const progress = next === null ? 1 : Math.min(1, Math.max(0, (points - floor) / (next - floor)));
  return { level, floor, next, progress };
}
