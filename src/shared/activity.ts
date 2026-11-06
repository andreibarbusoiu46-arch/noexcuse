// What counts as evidence, per activity and verification level. Shared by the app (to show the
// user what to capture) and the Edge Functions (to tell the AI what to check). No imports, so both
// the Expo bundler and Deno can use it.

export type Activity = 'gym' | 'running' | 'reading' | 'studying' | 'eating' | 'wake_up' | 'general';
export type VerifyLevel = 'standard' | 'strict' | 'elite';
export const ACTIVITIES: Activity[] = ['gym', 'running', 'reading', 'studying', 'eating', 'wake_up', 'general'];
export const isActivity = (x: unknown): x is Activity => typeof x === 'string' && (ACTIVITIES as string[]).includes(x);

export interface Requirement {
  /** Stable id the AI reports against. */
  id: string;
  /** live = in-app camera photo; screenshot = image from the gallery (lower trust). */
  kind: 'live' | 'screenshot';
  required: boolean;
  label: { en: string; ro: string };
  /** What the AI must see for this requirement to count. */
  check: string;
}

type Spec = { primary: Omit<Requirement, 'kind' | 'required'>; detail: Omit<Requirement, 'kind' | 'required'>; app: Omit<Requirement, 'kind' | 'required'> };

const SPECS: Record<Activity, Spec> = {
  gym: {
    primary: { id: 'training', label: { en: 'You training, or right after the workout', ro: 'Tu la antrenament sau imediat după' },
      check: 'The person is training, or is visibly just after a workout (gym clothes, sweat), in a gym or with training equipment.' },
    detail: { id: 'environment', label: { en: 'The gym or the equipment you used', ro: 'Sala sau echipamentul folosit' },
      check: 'The training environment: gym floor, machines, weights or home equipment, consistent with the first photo.' },
    app: { id: 'tracker', label: { en: 'Workout record (app, watch or log)', ro: 'Evidența antrenamentului (aplicație, ceas sau jurnal)' },
      check: 'A workout record (fitness app, watch summary or written log) showing today\'s session: exercises, duration or sets. Check that the date matches today if visible.' },
  },
  running: {
    primary: { id: 'run', label: { en: 'You running, or the treadmill/route', ro: 'Tu alergând, sau banda/traseul' },
      check: 'The person running or just after a run, outdoors in running gear or on a treadmill.' },
    detail: { id: 'result', label: { en: 'Watch or treadmill display with distance and time', ro: 'Ceasul sau afișajul benzii cu distanța și timpul' },
      check: 'A watch, phone or treadmill display showing distance and/or duration for this run. Read the numbers; do not guess them.' },
    app: { id: 'activity', label: { en: 'Activity screenshot (distance, duration, pace, map)', ro: 'Captură a activității (distanță, durată, ritm, hartă)' },
      check: 'A running app summary showing distance, duration and pace, and a GPS map if present. Report the values you can read and whether the date matches today.' },
  },
  reading: {
    primary: { id: 'book', label: { en: 'The open book (page number visible)', ro: 'Cartea deschisă (cu numărul paginii)' },
      check: 'An open book or e-reader with readable text and a visible page number or chapter.' },
    detail: { id: 'progress', label: { en: 'Your progress: page, chapter or bookmark', ro: 'Progresul: pagina, capitolul sau semnul de carte' },
      check: 'A close-up that shows reading progress: page number, chapter heading or bookmark position.' },
    app: { id: 'reader_app', label: { en: 'Reading app progress', ro: 'Progresul din aplicația de citit' },
      check: 'An e-reader or reading app screen showing progress (percentage, pages or time read).' },
  },
  studying: {
    primary: { id: 'material', label: { en: 'Your study material and notes', ro: 'Materialele de studiu și notițele' },
      check: 'Study materials in use: notes, textbook, exercises or study work on a screen.' },
    detail: { id: 'work', label: { en: 'What you completed (exercises, notes, pages)', ro: 'Ce ai terminat (exerciții, notițe, pagini)' },
      check: 'A close-up of completed work: solved exercises, written notes or finished pages.' },
    app: { id: 'timer', label: { en: 'Study timer or app screenshot', ro: 'Captură a cronometrului sau a aplicației de studiu' },
      check: 'A focus timer or study app showing the session length, or a screenshot of the work itself.' },
  },
  eating: {
    primary: { id: 'meal', label: { en: 'Your meal', ro: 'Masa ta' },
      check: 'A real meal on a plate or in a container. Identify the foods you can see; do not invent ingredients or calories.' },
    detail: { id: 'meal_detail', label: { en: 'Close-up or preparation of the meal', ro: 'Prim-plan sau prepararea mesei' },
      check: 'A close-up of the meal or its preparation (ingredients, cooking), consistent with the first photo.' },
    app: { id: 'food_log', label: { en: 'Food log screenshot', ro: 'Captură din jurnalul alimentar' },
      check: 'A food-tracking app entry for this meal. Report what it lists; do not compute nutrition yourself.' },
  },
  wake_up: {
    primary: { id: 'awake', label: { en: 'You awake, with the time visible', ro: 'Tu treaz, cu ora vizibilă' },
      check: 'The person awake and out of bed, with a clock or phone showing the time. Compare the visible time with the time the server received the photo.' },
    detail: { id: 'up', label: { en: 'Proof you are up (kitchen, bathroom, outside)', ro: 'Dovada că te-ai ridicat (bucătărie, baie, afară)' },
      check: 'A scene that shows the person is up and moving: kitchen, bathroom, dressed, outside. Lighting should be consistent with the time.' },
    app: { id: 'alarm', label: { en: 'Alarm or sleep-tracker screenshot', ro: 'Captură a alarmei sau a monitorului de somn' },
      check: 'An alarm dismissal or sleep-tracker screen showing today\'s wake-up time.' },
  },
  general: {
    primary: { id: 'activity', label: { en: 'You doing the activity', ro: 'Tu făcând activitatea' },
      check: 'The committed activity being done, or its clear immediate result.' },
    detail: { id: 'result', label: { en: 'Close-up of the result', ro: 'Prim-plan cu rezultatul' },
      check: 'A close-up of the result: screen, page, display or finished work.' },
    app: { id: 'record', label: { en: 'Tracking screenshot', ro: 'Captură de monitorizare' },
      check: 'A tracking app or timer showing this session.' },
  },
};

/** The evidence a submission must contain. Live photos come first, in capture order. */
export function requirementsFor(activity: Activity, level: VerifyLevel): Requirement[] {
  const s = SPECS[activity];
  if (level === 'standard') return [{ ...s.primary, kind: 'live', required: true }];
  return [
    { ...s.primary, kind: 'live', required: true },
    { ...s.detail, kind: 'live', required: true },
    { ...s.app, kind: 'screenshot', required: level === 'elite' },
  ];
}

// Keyword detection (English and Romanian) for commitments left on "auto". Order matters: the first match wins.
// Each entry is a list of word stems; a stem matches at the start of a word.
const KEYWORDS: [Activity, string[]][] = [
  ['wake_up', ['wake', 'woke', 'awake', 'up at', '5 am', '5am', '6 am', '6am', 'early rise', 'trezi', 'trezire', 'în picioare', 'in picioare']],
  ['running', ['run', 'jog', 'treadmill', 'marathon', '5k', '10k', 'alerg', 'banda de alergare', 'maraton']],
  ['gym', ['gym', 'workout', 'lift', 'weights', 'strength', 'squat', 'bench', 'deadlift', 'crossfit', 'training', 'sala', 'sală', 'antrenament', 'greutăți', 'greutati', 'forță', 'forta', 'fitness']],
  ['reading', ['read', 'book', 'pages', 'chapter', 'citi', 'citesc', 'lectur', 'carte', 'cărți', 'carti', 'pagin', 'capitol']],
  ['studying', ['study', 'studies', 'homework', 'exam', 'course', 'lecture', 'learn', 'notes', 'învăț', 'invat', 'studi', 'temă', 'teme ', 'examen', 'curs', 'notițe', 'notite']],
  ['eating', ['eat', 'meal', 'breakfast', 'lunch', 'dinner', 'salad', 'vegetable', 'protein', 'diet', 'cook', 'mânc', 'manc', 'masă', 'mic dejun', 'prânz', 'pranz', 'cină', 'cina', 'salat', 'legum', 'gătit', 'gatit']],
];

const startsWord = (text: string, stem: string) => {
  let i = text.indexOf(stem);
  while (i !== -1) {
    if (i === 0 || !/\p{L}|\p{N}/u.test(text[i - 1])) return true;
    i = text.indexOf(stem, i + 1);
  }
  return false;
};

export function detectActivity(title: string, category?: string | null, proofHint?: string | null): Activity {
  const text = `${title} ${proofHint ?? ''}`.toLowerCase();
  for (const [a, stems] of KEYWORDS) if (stems.some((st) => startsWord(text, st))) return a;
  if (category === 'fitness') return 'gym';
  if (category === 'education') return 'studying';
  return 'general';
}

export function activityOf(h: { activity?: string | null; title: string; category?: string | null; proof_hint?: string | null }): Activity {
  return isActivity(h.activity) ? h.activity : detectActivity(h.title, h.category, h.proof_hint);
}
