import type { HabitStatus } from '@/components/HabitCard';
import type { Habit, Target } from '@/data/types';
import { t } from '@/i18n';
import { describeDays, formatTime, hhmmOf, phaseOf, relativeIn, windowOf } from './time';

export interface CardModel {
  status: HabitStatus;
  meta: string;
  right?: string;
}

/** How a scheduled target shows up as a Habit Card right now. */
export function targetCard(x: Target, now: number, tz?: string): CardModel {
  const time = formatTime(x.due_at, tz);
  switch (x.status) {
    case 'verified':
      return { status: 'verified', meta: t.domain.card.verified(time) };
    case 'rejected':
      return { status: 'missed', meta: t.domain.card.rejected(time) };
    case 'missed':
      return { status: 'missed', meta: t.domain.card.missed(time) };
    case 'excused':
      return { status: 'excused', meta: t.domain.card.excused(time) };
    default: {
      const w = windowOf(x.due_at);
      const p = phaseOf(x.due_at, now);
      if (p === 'open') return { status: 'due', meta: t.domain.card.open(time), right: t.domain.card.due(formatTime(w.closesAt, tz)) };
      if (p === 'closed') return { status: 'upcoming', meta: t.domain.card.settling(time) };
      return { status: 'upcoming', meta: t.domain.card.opens(time, formatTime(w.opensAt, tz)), right: relativeIn(w.opensAt - now) };
    }
  }
}

export function habitCard(h: Habit, next: Target | undefined, now: number, tz?: string): CardModel {
  if (!h.is_active) return { status: 'paused', meta: t.domain.card.paused(describeDays(h.weekdays)) };
  if (next) {
    const c = targetCard(next, now, tz);
    return { ...c, meta: `${hhmmOf(h.target_time)} · ${describeDays(h.weekdays)}${h.current_streak ? ` · ${t.common.dayStreak(h.current_streak)}` : ''}` };
  }
  return { status: 'upcoming', meta: `${hhmmOf(h.target_time)} · ${describeDays(h.weekdays)}` };
}
