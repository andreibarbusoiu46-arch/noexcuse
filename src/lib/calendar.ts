// Downloads a commitment's calendar reminders (.ics) in the browser. Web only — native apps get push reminders.
import { Platform } from 'react-native';
import { t } from '@/i18n';
import { buildCommitmentIcs, type CalendarHabit, icsFileName } from '@/shared/calendar';
import { config } from './config';
import { localDay } from './time';

export const calendarAvailable = () => Platform.OS === 'web' && typeof document !== 'undefined';

/** Returns false when the commitment has no scheduled days (nothing to add). */
export function downloadCommitmentIcs(habit: CalendarHabit, timeZone: string): boolean {
  const [y, m, d] = localDay(Date.now(), timeZone).split('-').map(Number);
  const ics = buildCommitmentIcs(habit, { timeZone, today: { y, m, d }, now: new Date(), appUrl: config.siteUrl, text: t.form.cal });
  if (!ics) return false;
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = icsFileName(habit.title);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}
