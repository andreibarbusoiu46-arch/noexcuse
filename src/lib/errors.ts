import { lang, t } from '@/i18n';
import { ApiError } from './supabase';

// Database exceptions carry an English reason; match the stable part and translate it.
const DB: [RegExp, () => string][] = [
  [/Free accounts can have (\d+)/, () => t.domain.errors.freeLimit(2)],
  [/Strict and Elite verification/, () => t.domain.errors.levelPremium],
  [/Challenges are part of Premium/, () => t.domain.errors.challengesPremium],
  [/inviting partners is part of Premium/i, () => t.domain.errors.invitePremium],
  [/invite code is invalid or expired/, () => t.domain.errors.inviteInvalid],
  [/accept your own invite/, () => t.domain.errors.inviteOwn],
  [/already partners/, () => t.domain.errors.alreadyPartners],
  [/partner limit reached/, () => t.domain.errors.partnerLimit],
  [/too many open invites/, () => t.domain.errors.tooManyInvites],
  [/already has an active challenge/, () => t.domain.errors.alreadyChallenge],
  [/must be active/, () => t.domain.errors.mustBeActive],
  [/too many active challenge objectives/, () => t.domain.errors.tooManyObjectives],
];

/** A message the user can read, in their language. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const m = (t.domain.errors as unknown as Record<string, unknown>)[e.code];
    if (typeof m === 'string') return e.code === 'evidence_incomplete' || e.code === 'duplicate_evidence' ? localizedServerDetail(e, m) : m;
    return e.message || t.common.somethingWrong;
  }
  const msg = e instanceof Error ? e.message : '';
  const free = /Free accounts can have (\d+)/.exec(msg);
  if (free) return t.domain.errors.freeLimit(Number(free[1]));
  for (const [re, f] of DB) if (re.test(msg)) return f();
  return msg || t.common.somethingWrong;
}

// The verification function explains *which* evidence is missing or reused; that detail is English.
// In English show it as is; otherwise show the translated summary.
function localizedServerDetail(e: ApiError, fallback: string): string {
  return lang() === 'en' && e.message ? e.message : fallback;
}
