import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type Profile } from '@/data';
import { config, demoGate } from '@/lib/config';
import { forgetPurchaser, getCustomerInfo, hasPremium, identifyPurchaser, onCustomerInfo, purchasesAvailable } from '@/lib/purchases';
import { refreshPushTokenIfGranted } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import { deviceTimeZone } from '@/lib/time';

interface AppState {
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  /** UI gate only. The server re-checks the entitlement for every proof. */
  premium: boolean;
  refreshProfile: () => Promise<void>;
  refreshPremium: () => Promise<boolean>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);
export const useApp = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside AppProvider');
  return c;
};

const DEMO_SESSION = { user: { id: 'demo-me' } } as unknown as Session;

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(config.demo && demoGate() !== 'signedout' ? DEMO_SESSION : null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [premium, setPremium] = useState(config.demo && demoGate() === null);

  const refreshProfile = useCallback(async () => {
    const p = await api.getProfile();
    setProfile(p);
  }, []);

  /** RevenueCat first (the store's truth); if the SDK is unavailable, the server's webhook-maintained row. */
  const refreshPremium = useCallback(async () => {
    if (config.demo) { setPremium(true); return true; }
    let active = false;
    try {
      const info = await getCustomerInfo();
      if (info) active = hasPremium(info);
      else if (!purchasesAvailable()) active = Boolean((await api.getEntitlement())?.is_active);
    } catch {
      active = Boolean((await api.getEntitlement().catch(() => null))?.is_active);
    }
    setPremium(active);
    return active;
  }, []);

  // Auth session lifecycle
  useEffect(() => {
    if (config.demo) {
      let alive = true;
      (async () => {
        await refreshProfile().catch(() => {});
        if (alive) setReady(true);
      })();
      return () => { alive = false; };
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) { setProfile(null); setPremium(false); setReady(true); }
    });
    return () => sub.subscription.unsubscribe();
  }, [refreshProfile]);

  // Signed in → identify with RevenueCat, load profile + entitlement, keep timezone in sync.
  const userId = session?.user.id;
  useEffect(() => {
    if (config.demo || !userId) return;
    let alive = true;
    let unsubscribe = () => {};
    (async () => {
      try {
        await identifyPurchaser(userId);
        unsubscribe = onCustomerInfo((info) => setPremium(hasPremium(info)));
        const [p] = await Promise.all([api.getProfile(), refreshPremium()]);
        if (!alive) return;
        const tz = deviceTimeZone();
        if (p.timezone !== tz) {
          await api.updateProfile({ timezone: tz }).then(() => { p.timezone = tz; }).catch(() => {});
        }
        setProfile(p);
        void refreshPushTokenIfGranted();
      } catch {
        // Offline at launch: show the app with whatever we have; screens show their own errors.
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => { alive = false; unsubscribe(); };
  }, [userId, refreshPremium]);

  const signOut = useCallback(async () => {
    if (config.demo) return;
    await api.deletePushTokens().catch(() => {});
    await forgetPurchaser();
    await supabase.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({ ready, session, profile, premium, refreshProfile, refreshPremium, signOut }),
    [ready, session, profile, premium, refreshProfile, refreshPremium, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
