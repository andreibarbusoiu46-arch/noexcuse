import type { Target } from '@/data/types';
import { locale, t } from '@/i18n';

export const WINDOW_MS = 15 * 60_000;

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function windowOf(dueAt: string | Date) {
  const due = new Date(dueAt).getTime();
  return { opensAt: due - WINDOW_MS, dueAt: due, closesAt: due + WINDOW_MS };
}

export type Phase = 'early' | 'open' | 'closed';
export function phaseOf(dueAt: string, now: number): Phase {
  const w = windowOf(dueAt);
  if (now < w.opensAt) return 'early';
  if (now > w.closesAt) return 'closed';
  return 'open';
}

export function formatTime(d: string | number | Date, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(new Date(d));
  } catch {
    return new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));
  }
}

export function localDay(d: string | number | Date, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(d));
  } catch {
    return new Intl.DateTimeFormat('en-CA').format(new Date(d));
  }
}

export function dayLabel(d: string | number | Date, timeZone?: string, now = Date.now()): string {
  const day = localDay(d, timeZone);
  if (day === localDay(now, timeZone)) return t.common.today;
  if (day === localDay(now + 86_400_000, timeZone)) return t.common.tomorrow;
  if (day === localDay(now - 86_400_000, timeZone)) return t.common.yesterday;
  return new Intl.DateTimeFormat(locale(), { weekday: 'short', timeZone }).format(new Date(d));
}

/** "12:40" under an hour, "2h 50m" above. */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return t.common.hoursMinutes(h, m);
}

export function relativeIn(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return t.common.inMinutes(m);
  const h = Math.floor(m / 60);
  return t.common.inHours(h, m % 60);
}

export function describeDays(days: number[]): string {
  const DAY = t.common.weekdayShort;
  const s = [...days].sort((a, b) => a - b);
  if (s.length === 7) return t.common.daily;
  if (s.join() === '1,2,3,4,5') return t.common.monFri;
  if (s.join() === '6,7') return t.common.weekends;
  const contiguous = s.every((d, i) => i === 0 || d === s[i - 1] + 1);
  if (contiguous && s.length > 2) return `${DAY[s[0]]}–${DAY[s[s.length - 1]]}`;
  return s.map((d) => DAY[d]).join(', ');
}

export const hhmmOf = (t: string) => t.slice(0, 5);

/** The single most urgent pending target: an open window first, otherwise the soonest upcoming. */
export function nextActionable(targets: Target[], now: number): Target | null {
  const pending = targets.filter((t) => t.status === 'pending' && phaseOf(t.due_at, now) !== 'closed');
  return pending.find((t) => phaseOf(t.due_at, now) === 'open') ?? pending.sort((a, b) => a.due_at.localeCompare(b.due_at))[0] ?? null;
}

/** Locale-aware short date: "4 Nov" / "4 nov." */
export const shortDate = (d: string | number | Date, timeZone = 'UTC') =>
  new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', timeZone }).format(typeof d === 'string' && d.length === 10 ? new Date(`${d}T00:00:00Z`) : new Date(d));
export const longDate = (d: string | number | Date, timeZone?: string) =>
  new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'short', timeZone }).format(new Date(d));
