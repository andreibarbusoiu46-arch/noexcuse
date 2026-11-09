// Authentication helpers shared by sign-up, sign-in, password reset and settings.
// Passwords are only ever sent to Supabase Auth over HTTPS; it stores them hashed (bcrypt). Nothing here keeps them.
import { Platform } from 'react-native';
import { t } from '@/i18n';
import { config } from './config';

export const PASSWORD_MIN = 10;
const COMMON = ['password', 'qwerty', '123456', '12345678', '123456789', 'iloveyou', 'admin', 'welcome', 'letmein', 'noexcuse', 'parola', 'abc123', 'monkey', 'football', 'dragon'];

export type Strength = { score: 0 | 1 | 2 | 3 | 4; ok: boolean; problems: string[] };

/** Client-side strength rule (the server also enforces its own minimum). */
export function passwordStrength(pw: string, email = ''): Strength {
  const problems: string[] = [];
  const p = t.auth.pw;
  if (pw.length < PASSWORD_MIN) problems.push(p.length(PASSWORD_MIN));
  if (!/[a-zA-ZÀ-ɏ]/.test(pw) || !/\d/.test(pw)) problems.push(p.mix);
  const lower = pw.toLowerCase();
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  if (COMMON.some((c) => lower.includes(c)) || (local.length >= 4 && lower.includes(local))) problems.push(p.common);
  if (/^(.)\1+$/.test(pw)) problems.push(p.repeat);
  let score = 0;
  if (pw.length >= PASSWORD_MIN) score++;
  if (pw.length >= 14) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^a-zA-Z0-9]/.test(pw)) score++;
  if (problems.length) score = Math.min(score, 1);
  return { score: score as Strength['score'], ok: problems.length === 0, problems };
}

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

/** Where e-mail links land. Native builds also use the website: the link verifies / resets there. */
export function authUrl(path: '/auth/callback' | '/reset-password'): string {
  const base = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : config.siteUrl;
  return `${base}${path}`;
}

/** Friendly, non-revealing message for a Supabase Auth error. */
export function authError(e: { code?: string; message?: string; status?: number } | null | undefined): string {
  const a = t.auth.err;
  const code = e?.code ?? '';
  const msg = (e?.message ?? '').toLowerCase();
  if (code === 'invalid_credentials' || msg.includes('invalid login')) return a.invalid;
  if (code === 'email_not_confirmed' || msg.includes('not confirmed')) return a.notConfirmed;
  if (code === 'user_already_exists' || code === 'email_exists') return a.exists;
  if (code === 'weak_password' || msg.includes('password should')) return a.weak;
  if (code === 'same_password') return a.same;
  if (code === 'email_address_invalid' || code === 'validation_failed') return a.badEmail;
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || e?.status === 429) return a.rate;
  if (code === 'otp_expired' || msg.includes('expired')) return a.expired;
  if (code === 'signup_disabled') return a.signupOff;
  if (code === 'reauthentication_needed' || code === 'reauthentication_not_valid') return a.reauth;
  if (code === 'session_not_found' || code === 'refresh_token_not_found') return a.session;
  if (e?.status === 0 || msg.includes('fetch')) return a.network;
  return a.generic;
}

/** Which sign-in providers are switched on in Supabase Auth (so no button is shown for a disabled one). */
let providersCache: Promise<{ google: boolean; apple: boolean; email: boolean }> | null = null;
export function authProviders() {
  if (config.demo) return Promise.resolve({ google: false, apple: false, email: true });
  providersCache ??= fetch(`${config.supabaseUrl}/auth/v1/settings`, { headers: { apikey: config.supabaseAnonKey } })
    .then((r) => r.json())
    .then((j: { external?: Record<string, boolean> }) => ({ google: !!j.external?.google, apple: !!j.external?.apple, email: j.external?.email !== false }))
    .catch(() => ({ google: false, apple: false, email: true }));
  return providersCache;
}

// "Keep me signed in" (web): off → the session lives in sessionStorage and ends when the browser closes.
const REMEMBER = 'noexcuse:remember';
export function setRemember(on: boolean) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try { window.localStorage.setItem(REMEMBER, on ? '1' : '0'); } catch { /* storage blocked */ }
}
export function remembering(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return true;
  try { return window.localStorage.getItem(REMEMBER) !== '0'; } catch { return true; }
}

/** Storage for the Supabase session on the web that honours "keep me signed in". */
export const webSessionStorage = {
  getItem(key: string): string | null {
    try { return window.sessionStorage.getItem(key) ?? window.localStorage.getItem(key); } catch { return null; }
  },
  setItem(key: string, value: string) {
    try {
      if (remembering()) { window.localStorage.setItem(key, value); window.sessionStorage.removeItem(key); }
      else { window.sessionStorage.setItem(key, value); window.localStorage.removeItem(key); }
    } catch { /* storage blocked: the session lives in memory for this tab */ }
  },
  removeItem(key: string) {
    try { window.localStorage.removeItem(key); window.sessionStorage.removeItem(key); } catch { /* ignore */ }
  },
};
