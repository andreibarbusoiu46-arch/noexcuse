// WAR ROOM · Daily Intel — an original, curated library (written for NoExcuse, not quoted from anyone).
// Picked by context from the user's real data; never presented as AI-generated.
import type { WarRoom } from '@/data/types';
import type { Lang } from '@/i18n';

export type IntelKind = 'rebuild' | 'accountability' | 'streak' | 'progress' | 'execution';

const EN: Record<IntelKind, string[]> = {
  rebuild: [
    'You don’t need a new plan. You need the next rep of the old one.',
    'Discipline isn’t lost. It’s unpractised. Practise it today.',
    'Start smaller than your pride wants and bigger than your excuses allow.',
    'One kept promise is a foundation. Lay it today.',
    'The comeback is not a mood. It’s a schedule you keep.',
    'Rebuild with boring wins. They compound.',
  ],
  accountability: [
    'A miss is information, not identity. Use it.',
    'Own the miss in one sentence. Then go win the next window.',
    'Your excuses are accurate. They’re also irrelevant.',
    'You can explain it or you can fix it. Only one moves the score.',
    'The record doesn’t judge you. It just waits for your answer.',
    'Yesterday is settled. Today is still open.',
  ],
  streak: [
    'Momentum is earned daily and lost in a single shrug. Protect it.',
    'The streak isn’t the goal. The person who keeps it is.',
    'Consistent beats intense. You are proving it.',
    'Don’t get comfortable. Get repeatable.',
    'Every day you show up, quitting gets more expensive.',
    'The habit is holding. Keep your hands on it.',
  ],
  progress: [
    'Finished is a skill. You just practised it.',
    'You proved the plan works. Now raise the standard.',
    'Results are receipts for promises kept.',
    'Celebrate for a moment. Then choose the next hard thing.',
    'You didn’t get lucky. You got consistent.',
  ],
  execution: [
    'Decide once. Execute daily.',
    'Stop negotiating with the person you said you’d become.',
    'The window opens on time whether you’re ready or not. Be ready.',
    'Motivation is a guest. Discipline lives here.',
    'Do the thing before the feeling arrives.',
    'Small, done, verified. Repeat.',
    'Nobody is coming to make you do it. That’s the good news.',
    'Your calendar shows what you value. Make it honest.',
  ],
};

const RO: Record<IntelKind, string[]> = {
  rebuild: [
    'Nu-ți trebuie un plan nou. Îți trebuie următoarea repetare din cel vechi.',
    'Disciplina nu s-a pierdut. E doar neexersată. Exers-o azi.',
    'Începe mai mic decât vrea orgoliul și mai mare decât permit scuzele.',
    'O promisiune ținută e o fundație. Pune-o azi.',
    'Revenirea nu e o stare. E un program pe care îl respecți.',
    'Reconstruiește cu victorii plictisitoare. Se adună.',
  ],
  accountability: [
    'O ratare e o informație, nu o identitate. Folosește-o.',
    'Asumă ratarea într-o propoziție. Apoi câștigă următoarea fereastră.',
    'Scuzele tale sunt corecte. Și irelevante.',
    'Poți s-o explici sau s-o repari. Doar una mișcă scorul.',
    'Istoricul nu te judecă. Doar îți așteaptă răspunsul.',
    'Ieri e decontat. Azi e încă deschis.',
  ],
  streak: [
    'Avântul se câștigă zilnic și se pierde dintr-o ridicare din umeri. Protejează-l.',
    'Seria nu e scopul. Omul care o ține este.',
    'Constanța bate intensitatea. Tu o demonstrezi.',
    'Nu te face comod. Fă-te repetabil.',
    'Cu fiecare zi în care apari, renunțatul devine mai scump.',
    'Obiceiul ține. Nu-i da drumul.',
  ],
  progress: [
    'A termina e o abilitate. Tocmai ai exersat-o.',
    'Ai demonstrat că planul merge. Acum ridică standardul.',
    'Rezultatele sunt chitanțe pentru promisiuni ținute.',
    'Bucură-te o clipă. Apoi alege următorul lucru greu.',
    'Nu ai avut noroc. Ai fost constant.',
  ],
  execution: [
    'Decide o dată. Execută zilnic.',
    'Nu mai negocia cu omul care ai spus că vei deveni.',
    'Fereastra se deschide la timp, fie că ești gata, fie că nu. Fii gata.',
    'Motivația e musafir. Disciplina locuiește aici.',
    'Fă lucrul înainte să vină cheful.',
    'Mic, făcut, verificat. Repetă.',
    'Nimeni nu vine să te pună s-o faci. Asta e vestea bună.',
    'Calendarul arată ce prețuiești. Fă-l sincer.',
  ],
};

/** Which message fits: recent challenge finish → progress; a miss today or a weak week → accountability; low score → rebuild; long streak → streak. */
export function intelKind(room: WarRoom | null | undefined): IntelKind {
  if (!room) return 'execution';
  const since = Date.now() - 3 * 86_400_000;
  if (room.recent.some((r) => r.reason === 'challenge_bonus' && new Date(r.at).getTime() > since)) return 'progress';
  if (room.commitments.some((c) => c.state === 'failed')) return 'accountability';
  const score = room.score?.score ?? null;
  if (score !== null && !room.score?.provisional && score < 50) return 'rebuild';
  if ((room.week.success_rate ?? 100) < 50 && room.week.settled >= 3) return 'rebuild';
  if (room.streak >= 7) return 'streak';
  return 'execution';
}

/** The day's message for this context (same all day), and the n-th next one when the user asks for another. */
export function intel(lang: Lang, kind: IntelKind, dayKey: string, offset: number): { text: string; index: number; count: number } {
  const own = (lang === 'ro' ? RO : EN)[kind];
  // After the context's own lines, continue through the general ones so "another" never runs dry.
  const pool = kind === 'execution' ? own : [...own, ...(lang === 'ro' ? RO : EN).execution];
  let h = 0;
  for (const ch of dayKey) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const start = h % own.length;
  const index = (start + offset) % pool.length;
  return { text: pool[index], index, count: pool.length };
}
