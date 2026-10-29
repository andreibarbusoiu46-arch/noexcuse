import type { HabitStatus } from '@/components/HabitCard';
import type { Habit, Target } from '@/data/types';
import { describeDays, formatTime, hhmmOf, phaseOf, relativeIn, windowOf } from './time';

export interface CardModel {
  status: HabitStatus;
  meta: string;
  right?: string;
}

/** How a scheduled target shows up as a Habit Card right now. */
export function targetCard(t: Target, now: number, tz?: string): CardModel {
  const time = formatTime(t.due_at, tz);
  switch (t.status) {
    case 'verified':
      return { status: 'verified', meta: `${time} · verified` };
    case 'rejected':
      return { status: 'missed', meta: `${time} · proof rejected` };
    case 'missed':
      return { status: 'missed', meta: `${time} · window closed` };
    case 'excused':
      return { status: 'excused', meta: `${time} · our error, no penalty` };
    default: {
      const w = windowOf(t.due_at);
      const p = phaseOf(t.due_at, now);
      if (p === 'open') return { status: 'due', meta: `${time} · window ±15 min`, right: `Due ${formatTime(w.closesAt, tz)}` };
      if (p === 'closed') return { status: 'upcoming', meta: `${time} · window closed, settling…` };
      return { status: 'upcoming', meta: `${time} · opens ${formatTime(w.opensAt, tz)}`, right: relativeIn(w.opensAt - now) };
    }
  }
}

export function habitCard(h: Habit, next: Target | undefined, now: number, tz?: string): CardModel {
  if (!h.is_active) return { status: 'paused', meta: `Paused · was ${describeDays(h.weekdays)}` };
  if (next) {
    const c = targetCard(next, now, tz);
    return { ...c, meta: `${hhmmOf(h.target_time)} · ${describeDays(h.weekdays)}${h.current_streak ? ` · ${h.current_streak}-day streak` : ''}` };
  }
  return { status: 'upcoming', meta: `${hhmmOf(h.target_time)} · ${describeDays(h.weekdays)}` };
}
