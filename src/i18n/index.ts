// Translations: typed dictionaries per namespace (src/i18n/ns). English is the source of truth;
// every other language is type-checked against it, so a missing string fails the build.
// Adding a language = one more entry in LANGS and one more key in each namespace file.
import { dict as dictEn, type Dict } from './dict.en';
import { dictRo } from './dict.ro';

export type Lang = 'en' | 'ro';
export const LANGS: { id: Lang; native: string; english: string; mark: string }[] = [
  { id: 'en', native: 'English', english: 'English', mark: 'EN' },
  { id: 'ro', native: 'Română', english: 'Romanian', mark: 'RO' },
];
const dicts: Record<Lang, Dict> = { en: dictEn, ro: dictRo };

let current: Lang = 'en';
export const lang = (): Lang => current;
export function setLang(l: Lang) { current = l; }
export const isLang = (v: unknown): v is Lang => v === 'en' || v === 'ro';

/** BCP-47 locale for dates and numbers. */
export const locale = (): string => (current === 'ro' ? 'ro-RO' : 'en-GB');

/**
 * The current language's strings. Read at render time (never at module load) so a language change
 * — which re-renders the tree — shows everywhere at once.
 */
export const t: Dict = new Proxy({} as Dict, {
  get: (_target, key: string) => (dicts[current] as unknown as Record<string, unknown>)[key],
});

/** First-run guess when nothing is saved: Romanian devices get Romanian, everyone else English. */
export function detectLang(): Lang {
  try {
    const l = Intl.DateTimeFormat().resolvedOptions().locale ?? '';
    if (l.toLowerCase().startsWith('ro')) return 'ro';
    if (typeof navigator !== 'undefined' && Array.isArray(navigator.languages) && navigator.languages.some((x) => x.toLowerCase().startsWith('ro'))) return 'ro';
  } catch { /* fall through */ }
  return 'en';
}

export const fmtNumber = (n: number) => new Intl.NumberFormat(locale()).format(n);
