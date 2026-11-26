// Calendar reminders (iCalendar, RFC 5545) for a commitment. Pure: no React Native, no I/O — shared by the app
// and the tests. Used on the web, where push notifications aren't available: the person's own calendar app
// (Google, Apple, Outlook) then raises the reminders on their phone.
//
// One recurring event per commitment, spanning the proof window (15 minutes before to 15 minutes after the
// target time), in the person's own timezone so it follows daylight-saving changes. Alarms mirror the app's
// push reminders: `reminder_minutes` before the window opens, and when it opens.

export const WINDOW_MINUTES = 15;
const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']; // ISO weekday 1..7

export interface CalendarHabit {
  id: string;
  title: string;
  target_time: string; // "HH:MM" or "HH:MM:SS", local wall time
  weekdays: number[]; // ISO 1 = Monday … 7 = Sunday
  reminder_minutes: number;
  proof_hint?: string | null;
}

export interface CalendarText {
  /** Event title, e.g. "NoExcuse: Read 20 pages". */
  summary: (title: string) => string;
  /** Event description; `url` opens the app. */
  description: (url: string, hint: string | null) => string;
  /** Alarm texts. */
  reminder: (title: string, minutes: number) => string;
  open: (title: string) => string;
}

/** RFC 5545 text escaping (backslash, semicolon, comma, newline). */
export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Folds content lines longer than 75 octets (RFC 5545 §3.1), counting UTF-8 bytes. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The first date on or after `from` (a local calendar date) that falls on one of the weekdays. */
function firstOccurrence(from: { y: number; m: number; d: number }, weekdays: number[]): { y: number; m: number; d: number } {
  const date = new Date(Date.UTC(from.y, from.m - 1, from.d));
  for (let i = 0; i < 7; i++) {
    const iso = ((date.getUTCDay() + 6) % 7) + 1;
    if (weekdays.includes(iso)) break;
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

/** Local wall time minus `minutes`, on a given local date (handles crossing midnight). */
function localMinus(day: { y: number; m: number; d: number }, hhmm: string, minutes: number): string {
  const [h, mi] = hhmm.split(':').map(Number);
  const t = new Date(Date.UTC(day.y, day.m - 1, day.d, h, mi) - minutes * 60_000);
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}T${pad(t.getUTCHours())}${pad(t.getUTCMinutes())}00`;
}

/**
 * Builds the .ics text. `today` is the person's current local date (in `timeZone`), `now` the creation time.
 * Returns null when the commitment has no scheduled weekdays.
 */
export function buildCommitmentIcs(
  habit: CalendarHabit,
  opts: { timeZone: string; today: { y: number; m: number; d: number }; now: Date; appUrl: string; text: CalendarText },
): string | null {
  const days = [...new Set(habit.weekdays)].filter((d) => d >= 1 && d <= 7).sort();
  if (!days.length || !/^\d{2}:\d{2}/.test(habit.target_time)) return null;
  const hhmm = habit.target_time.slice(0, 5);
  const first = firstOccurrence(opts.today, days);
  const start = localMinus(first, hhmm, WINDOW_MINUTES);
  const end = localMinus(first, hhmm, -WINDOW_MINUTES);
  // A target before 00:15 opens its window the day before: the weekly rule must name that earlier day,
  // because calendars repeat DTSTART's time on the BYDAY days.
  const [hh, mm] = hhmm.split(':').map(Number);
  const ruleDays = hh * 60 + mm < WINDOW_MINUTES ? [...new Set(days.map((d) => (d === 1 ? 7 : d - 1)))].sort() : days;
  const stamp = opts.now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const url = `${opts.appUrl.replace(/\/$/, '')}/`;
  const tz = opts.timeZone;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NoExcuse//Commitment reminders//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:commitment-${habit.id}@noexcuse`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=${tz}:${start}`,
    `DTEND;TZID=${tz}:${end}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${ruleDays.map((d) => BYDAY[d - 1]).join(',')}`,
    `SUMMARY:${escapeText(opts.text.summary(habit.title))}`,
    `DESCRIPTION:${escapeText(opts.text.description(url, habit.proof_hint?.trim() || null))}`,
    `URL:${url}`,
    'TRANSP:OPAQUE',
  ];
  if (habit.reminder_minutes > 0) {
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(opts.text.reminder(habit.title, habit.reminder_minutes))}`,
      `TRIGGER:-PT${Math.round(habit.reminder_minutes)}M`, 'END:VALARM');
  }
  lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(opts.text.open(habit.title))}`, 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/** A safe file name for the download. */
export function icsFileName(title: string): string {
  const slug = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `noexcuse-${slug || 'commitment'}.ics`;
}
