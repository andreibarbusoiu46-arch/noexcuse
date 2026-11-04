// The template library is stored in English in the database. These are its Romanian texts,
// keyed by template id; anything missing falls back to the database text.
import { lang } from './index';
import type { ChallengeTemplate, PlanObjective } from '@/data/types';

type Text = { title: string; tagline: string; description: string; rules: string; evidence: string; objectives?: { title: string; proof_hint: string }[] };

const ro: Record<string, Text> = {
  'discipline-30': {
    title: '30 de zile de disciplină', tagline: 'Un angajament. Treizeci de zile. Cel mult două ratări.',
    description: 'Alege un angajament pe care îl ai deja și ține-l 30 de zile. Poți rata cel mult două zile programate.',
    rules: 'Ține angajamentul ales în fiecare zi programată, 30 de zile. Cel mult 2 zile ratate.',
    evidence: 'Ce cere deja angajamentul tău, la nivelul lui de verificare.',
  },
  'no-excuses-30': {
    title: '30 de zile fără scuze', tagline: 'Treizeci de zile. Zero ratări.',
    description: 'Ține un angajament în fiecare zi programată, 30 de zile. O singură ratare încheie provocarea.',
    rules: 'În fiecare zi programată, 30 de zile. O singură zi ratată încheie provocarea.',
    evidence: 'Ce cere deja angajamentul tău, la nivelul lui de verificare.',
  },
  'early-7': {
    title: 'Protocolul 5 AM', tagline: 'În picioare la 05:00, șapte zile la rând.',
    description: 'Șapte dimineți la rând: ieși din pat la 05:00 și dovedește asta înainte să înceapă ziua.',
    rules: '7 zile, fără ratări. Fereastra e 04:45–05:15.', evidence: 'O fotografie live: tu, treaz, cu ora vizibilă.',
    objectives: [{ title: 'Treaz la 05:00', proof_hint: 'Fața mea și un ceas sau ecranul telefonului cu ora, într-o cameră luminată.' }],
  },
  'fitness-30': {
    title: 'Fitness fără scuze', tagline: 'Un antrenament pe zi, 30 de zile.',
    description: 'Antrenează-te în fiecare zi, 30 de zile — sală, alergare sau acasă. Fotografia trebuie să arate asta.',
    rules: '30 de zile, cel mult 3 zile ratate.', evidence: 'O fotografie live cu tine la antrenament sau cu echipamentul și tu în cadru.',
    objectives: [{ title: 'Antrenament — 30 min', proof_hint: 'Eu la antrenament sau sala / echipamentul cu mine în cadru.' }],
  },
  'deep-work-21': {
    title: '21 de zile de muncă profundă', tagline: 'Nouăzeci de minute de concentrare, în fiecare zi lucrătoare.',
    description: 'Trei săptămâni de blocuri de muncă profundă în zilele lucrătoare. O ratare permisă.',
    rules: 'În fiecare zi lucrătoare, trei săptămâni. 1 zi ratată permisă.', evidence: 'Biroul tău cu cronometrul sau lucrul pe ecran.',
    objectives: [{ title: 'Muncă profundă — 90 min', proof_hint: 'Biroul meu cu cronometrul de concentrare sau lucrul pe ecran.' }],
  },
  'reading-30': {
    title: 'Disciplina lecturii', tagline: 'Douăzeci de pagini în fiecare seară, o lună.',
    description: 'Citește în fiecare seară, 30 de zile. Două ratări permise.',
    rules: '30 de zile, cel mult 2 zile ratate.', evidence: 'Cartea deschisă, cu numărul paginii vizibil.',
    objectives: [{ title: 'Citește 20 de pagini', proof_hint: 'Cartea deschisă, cu numărul paginii vizibil.' }],
  },
  'iron-75': {
    title: 'Standardul de fier, 75 de zile', tagline: 'Două antrenamente, zece pagini, trei litri. În fiecare zi, 75 de zile.',
    description: 'Un program exigent de 75 de zile, inspirat de provocările populare de 75 de zile (fără vreo afiliere cu ele). Două antrenamente pe zi — unul afară — zece pagini de lectură și trei litri de apă. În fiecare zi, fără excepții.',
    rules: '75 de zile. Fiecare obiectiv, în fiecare zi. O ratare încheie provocarea.', evidence: 'O fotografie live pentru fiecare obiectiv, în fereastra lui.',
    objectives: [
      { title: 'Antrenament — 45 min', proof_hint: 'Eu la antrenament, cu sala sau echipamentul în cadru.' },
      { title: 'Antrenament afară — 45 min', proof_hint: 'Eu la antrenament afară, cu cerul sau strada vizibile.' },
      { title: 'Citește 10 pagini', proof_hint: 'Cartea deschisă, cu numărul paginii vizibil.' },
      { title: 'Bea 3 L de apă', proof_hint: 'Sticlele goale care adunate fac trei litri.' },
    ],
  },
  'deep-work-7': {
    title: 'Muncă profundă 7Z', tagline: 'Nouăzeci de minute de concentrare, șapte zile la rând.',
    description: 'O resetare de o săptămână pentru atenția ta: un bloc de 90 de minute de muncă profundă în fiecare dimineață.',
    rules: '7 zile, 1 zi ratată permisă.', evidence: 'O fotografie live cu lucrul și cronometrul.',
    objectives: [{ title: 'Muncă profundă — 90 min', proof_hint: 'Biroul meu cu cronometrul de concentrare sau lucrul pe ecran.' }],
  },
  'digital-detox': {
    title: 'Detox digital', tagline: 'Două ore fără telefon în fiecare seară, două săptămâni.',
    description: 'Ia-ți serile înapoi: telefonul se închide două ore, în fiecare seară, 14 zile.',
    rules: '14 zile, cel mult 2 zile ratate.', evidence: 'O fotografie live cu telefonul pus deoparte și ora vizibilă.',
    objectives: [{ title: 'Telefon închis — 2 ore', proof_hint: 'Telefonul închis sau într-un sertar, cu un ceas care arată ora.' }],
  },
  'study-14': {
    title: 'Constanță la studiu', tagline: 'O oră de studiu în fiecare zi lucrătoare, două săptămâni.',
    description: 'Construiește un obicei de studiu care rezistă unei săptămâni aglomerate: o oră concentrată, de luni până vineri, două săptămâni.',
    rules: '10 zile de studiu, 1 zi ratată permisă.', evidence: 'O fotografie live cu materialul de studiu și cronometrul.',
    objectives: [{ title: 'Studiu — 60 min', proof_hint: 'Notițele sau cartea deschise, cu cronometrul vizibil.' }],
  },
  'daily-reset': {
    title: 'Resetarea zilei', tagline: 'Trei victorii mici într-o zi.',
    description: 'O zi, trei dovezi: fă patul, mișcă-te douăzeci de minute, planifică ziua de mâine.',
    rules: 'Toate cele trei obiective, azi.', evidence: 'O fotografie live pentru fiecare obiectiv.',
    objectives: [
      { title: 'Fă patul', proof_hint: 'Patul făcut.' },
      { title: 'Mișcare — 20 min', proof_hint: 'Eu făcând exerciții sau mergând pe jos.' },
      { title: 'Planifică ziua de mâine', proof_hint: 'Planul de mâine, scris.' },
    ],
  },
  'four-of-seven': {
    title: 'Patru din șapte', tagline: 'Antrenează-te cel puțin patru zile săptămâna asta.',
    description: 'O provocare săptămânală pentru viața reală: 30 de minute de antrenament în oricare patru din următoarele șapte zile.',
    rules: 'Cel puțin 4 din 7 zile (cel mult 3 zile ratate).', evidence: 'O fotografie live cu tine la antrenament.',
    objectives: [{ title: 'Antrenament — 30 min', proof_hint: 'Eu la antrenament, cu echipamentul sau locul vizibile.' }],
  },
};

const texts: Partial<Record<string, Record<string, Text>>> = { ro };

/** The template's texts in the current language. */
export function templateText(tpl: ChallengeTemplate): Omit<Text, 'objectives'> & { objectives: PlanObjective[] } {
  const x = texts[lang()]?.[tpl.id];
  return {
    title: x?.title ?? tpl.title,
    tagline: x?.tagline ?? tpl.tagline,
    description: x?.description ?? tpl.description,
    rules: x?.rules ?? tpl.rules ?? '',
    evidence: x?.evidence ?? tpl.evidence ?? '',
    objectives: (tpl.objectives ?? []).map((o, i) => ({ ...o, title: x?.objectives?.[i]?.title ?? o.title, proof_hint: x?.objectives?.[i]?.proof_hint ?? o.proof_hint })),
  };
}

/** A started challenge's title: templates are shown in the current language, own titles as written. */
export function challengeTitle(c: { template_id: string | null; title: string }): string {
  return (c.template_id && texts[lang()]?.[c.template_id]?.title) || c.title;
}
