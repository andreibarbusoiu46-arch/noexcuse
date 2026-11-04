import type { Level } from '@/data';

/** Mirrors supabase/functions/_shared/rules.ts LEVELS. The server enforces; this is copy for the UI. */
export const LEVELS: Record<Level, { label: string; live: number; screenshotsRequired: number; screenshotsMax: number; summary: string; steps: string[] }> = {
  standard: {
    label: 'Standard', live: 1, screenshotsRequired: 0, screenshotsMax: 0,
    summary: 'One live photo.',
    steps: ['Show the habit being done'],
  },
  strict: {
    label: 'Strict', live: 2, screenshotsRequired: 0, screenshotsMax: 1,
    summary: 'Two live photos, optional screenshot. Higher bar for the AI.',
    steps: ['Wide shot: you doing it', 'Close-up: the result (screen, watch, page)'],
  },
  elite: {
    label: 'Elite', live: 2, screenshotsRequired: 1, screenshotsMax: 2,
    summary: 'Two live photos plus a tracking-app screenshot. Highest bar.',
    steps: ['Wide shot: you doing it', 'Close-up: the result (screen, watch, page)'],
  },
};
export const LEVEL_ORDER: Level[] = ['standard', 'strict', 'elite'];
