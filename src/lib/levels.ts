import type { Level } from '@/data';
import { t } from '@/i18n';

/** Mirrors supabase/functions/_shared/rules.ts LEVELS. The server enforces; copy comes from the dictionary. */
const REQ: Record<Level, { live: number; screenshotsRequired: number; screenshotsMax: number }> = {
  standard: { live: 1, screenshotsRequired: 0, screenshotsMax: 0 },
  strict: { live: 2, screenshotsRequired: 0, screenshotsMax: 1 },
  elite: { live: 2, screenshotsRequired: 1, screenshotsMax: 2 },
};
export function level(l: Level) {
  const c = t.domain.level[l];
  return { ...REQ[l], label: c.label, summary: c.summary, steps: c.steps };
}
export const LEVEL_ORDER: Level[] = ['standard', 'strict', 'elite'];
