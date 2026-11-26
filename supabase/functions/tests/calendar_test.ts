// Calendar reminders for web users (src/shared/calendar.ts).
import nodeAssert from "node:assert/strict";
import { buildCommitmentIcs, escapeText, foldLine, icsFileName } from "../../../src/shared/calendar.ts";

const assert = (v: unknown, msg = "assertion failed") => nodeAssert.ok(v, msg);
const assertEquals = (a: unknown, b: unknown, msg?: string) => nodeAssert.deepStrictEqual(a, b, msg);

const text = {
  summary: (t: string) => `NoExcuse: ${t}`,
  description: (url: string, hint: string | null) => `Open ${url}${hint ? `\n\nValid proof: ${hint}` : ""}`,
  reminder: (t: string, m: number) => `${t}: opens in ${m} min.`,
  open: (t: string) => `${t}: open now.`,
};
const base = { id: "h1", title: "Read 20 pages", target_time: "07:00:00", weekdays: [1, 3, 5], reminder_minutes: 10, proof_hint: "Open book, page visible" };
// 2026-11-25 is a Wednesday.
const opts = { timeZone: "Europe/Bucharest", today: { y: 2026, m: 11, d: 25 }, now: new Date("2026-11-25T14:00:00Z"), appUrl: "https://noexcuse.vercel.app", text };
const unfold = (ics: string) => ics.replace(/\r\n /g, "");

Deno.test("calendar: one weekly event over the proof window, in the person's timezone", () => {
  const ics = buildCommitmentIcs(base, opts)!;
  assert(ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"), "CRLF and envelope");
  const u = unfold(ics);
  assert(u.includes("DTSTART;TZID=Europe/Bucharest:20261125T064500"), "starts 15 min before the target, on the first scheduled day (Wednesday)");
  assert(u.includes("DTEND;TZID=Europe/Bucharest:20261125T071500"), "ends 15 min after");
  assert(u.includes("RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"));
  assert(u.includes("UID:commitment-h1@noexcuse"), "stable UID: re-importing updates instead of duplicating");
  assert(u.includes("SUMMARY:NoExcuse: Read 20 pages"));
  assert(u.includes("DTSTAMP:20261125T140000Z"));
});

Deno.test("calendar: alarms mirror the app's reminders", () => {
  const u = unfold(buildCommitmentIcs(base, opts)!);
  assertEquals((u.match(/BEGIN:VALARM/g) ?? []).length, 2);
  assert(u.includes("TRIGGER:-PT10M") && u.includes("TRIGGER:PT0M"));
  const none = unfold(buildCommitmentIcs({ ...base, reminder_minutes: 0 }, opts)!);
  assertEquals((none.match(/BEGIN:VALARM/g) ?? []).length, 1, "no early reminder when the person turned it off");
});

Deno.test("calendar: first occurrence moves to the next scheduled weekday", () => {
  const u = unfold(buildCommitmentIcs({ ...base, weekdays: [6] }, opts)!); // Saturday only
  assert(u.includes("DTSTART;TZID=Europe/Bucharest:20261128T064500"));
});

Deno.test("calendar: a target just after midnight opens the day before, and the rule follows", () => {
  const u = unfold(buildCommitmentIcs({ ...base, target_time: "00:05", weekdays: [1] }, { ...opts, today: { y: 2026, m: 11, d: 30 } })!); // Monday
  assert(u.includes("DTSTART;TZID=Europe/Bucharest:20261129T235000"), "Sunday 23:50");
  assert(u.includes("DTEND;TZID=Europe/Bucharest:20261130T002000"));
  assert(u.includes("BYDAY=SU"), "rule names Sunday, so every occurrence opens Sunday 23:50");
});

Deno.test("calendar: text is escaped and long lines folded at 75 octets", () => {
  assertEquals(escapeText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
  const ics = buildCommitmentIcs({ ...base, title: "Citesc 20 de pagini, apoi notițe; fără scuze — " + "ă".repeat(60) }, opts)!;
  for (const line of ics.split("\r\n")) assert(new TextEncoder().encode(line).length <= 75, `line over 75 octets: ${line}`);
  assert(unfold(ics).includes("SUMMARY:NoExcuse: Citesc 20 de pagini\\, apoi notițe\\; fără scuze"));
  assert(unfold(ics).includes("Valid proof: Open book\\, page visible"), "newlines in the description become \\n");
  assertEquals(foldLine("x".repeat(80)).split("\r\n ").map((l) => l.length), [75, 5]);
});

Deno.test("calendar: nothing to add without days; safe file names", () => {
  assertEquals(buildCommitmentIcs({ ...base, weekdays: [] }, opts), null);
  assertEquals(buildCommitmentIcs({ ...base, target_time: "bad" }, opts), null);
  assertEquals(icsFileName("Citește 20 de pagini!"), "noexcuse-citeste-20-de-pagini.ics");
  assertEquals(icsFileName("💪"), "noexcuse-commitment.ics");
});
