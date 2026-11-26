// Public, build-time configuration. Only publishable values belong here —
// secrets (OpenAI, RevenueCat secret key, service role) live in Supabase function secrets.
import { Platform } from 'react-native';

export const config = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
  revenueCatKey: Platform.select({
    ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY,
    android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
    default: undefined,
  }) ?? '',
  entitlementId: 'premium',
  offeringId: process.env.EXPO_PUBLIC_REVENUECAT_OFFERING ?? 'default',
  /**
   * Terms of Service. Until NoExcuse's own Terms are published (EXPO_PUBLIC_TERMS_URL), the iPhone app falls back to
   * Apple's standard EULA, which governs App Store purchases. The web has no fallback: payments there go through
   * Stripe, so Apple's EULA would be the wrong document — the link is hidden instead.
   */
  termsUrl: process.env.EXPO_PUBLIC_TERMS_URL ?? (Platform.OS === 'ios' ? 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/' : ''),
  privacyUrl: process.env.EXPO_PUBLIC_PRIVACY_URL ?? '',
  siteUrl: process.env.EXPO_PUBLIC_SITE_URL ?? 'https://noexcuse.vercel.app',
  /** Demo mode: fixture data, no backend, no purchases. For design review and Expo Go only. */
  demo: process.env.EXPO_PUBLIC_DEMO === '1',
} as const;

/** Demo-only: which gate to preview (?gate=signedout | paywall on web). Ignored outside demo mode. */
export function demoGate(): 'signedout' | 'paywall' | null {
  if (!config.demo || typeof window === 'undefined' || !window.location?.search) return null;
  const g = new URLSearchParams(window.location.search).get('gate');
  return g === 'signedout' || g === 'paywall' ? g : null;
}

export const backendConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey);
