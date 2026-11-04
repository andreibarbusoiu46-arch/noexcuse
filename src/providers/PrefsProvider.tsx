// Language and appearance. Saved on the device (works signed out) and on the profile (follows the
// account across devices). Changing either re-renders every screen at once.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePathname } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Appearance, Platform } from 'react-native';
import { api } from '@/data';
import { detectLang, isLang, setLang, type Lang } from '@/i18n';
import { config } from '@/lib/config';
import { applyScheme, type Scheme } from '@/theme/tokens';
import { useApp } from './AppProvider';

export type ThemePref = 'dark' | 'light' | 'system';
const isTheme = (v: unknown): v is ThemePref => v === 'dark' || v === 'light' || v === 'system';
export const KEY_LANG = 'nx.lang';
export const KEY_THEME = 'nx.theme';

const resolve = (pref: ThemePref): Scheme => (pref === 'system' ? (Appearance.getColorScheme() === 'light' ? 'light' : 'dark') : pref);

// Web reads storage synchronously before the first render, so the right theme and language paint first.
function readSync(key: string): string | null {
  if (Platform.OS !== 'web') return null;
  try { return window.localStorage.getItem(key); } catch { return null; }
}
const bootLang: Lang = isLang(readSync(KEY_LANG)) ? (readSync(KEY_LANG) as Lang) : detectLang();
const bootTheme: ThemePref = isTheme(readSync(KEY_THEME)) ? (readSync(KEY_THEME) as ThemePref) : 'dark';
setLang(bootLang);
applyScheme(resolve(bootTheme));

interface Prefs {
  ready: boolean;
  lang: Lang;
  theme: ThemePref;
  scheme: Scheme;
  /** Changes on every language/appearance switch; the navigator re-renders under this key. */
  version: number;
  /** Where to return after the re-render (the screen the change was made on). */
  restorePath: string | null;
  setLanguage: (l: Lang) => Promise<void>;
  setTheme: (t: ThemePref) => Promise<void>;
}
const Ctx = createContext<Prefs | null>(null);
export const usePrefs = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('usePrefs outside PrefsProvider');
  return c;
};

export function PrefsProvider({ children }: { children: ReactNode }) {
  const { profile, session } = useApp();
  const pathname = usePathname();
  const [ready, setReady] = useState(Platform.OS === 'web');
  const [state, setState] = useState({ lang: bootLang, theme: bootTheme, scheme: resolve(bootTheme), version: 0, restorePath: null as string | null });
  const path = useRef(pathname);
  useEffect(() => { path.current = pathname; }, [pathname]);

  const commit = useCallback((lang: Lang, theme: ThemePref, restore: boolean) => {
    const scheme = resolve(theme);
    setLang(lang);
    applyScheme(scheme);
    setState((s) => (s.lang === lang && s.theme === theme && s.scheme === scheme ? s
      : { lang, theme, scheme, version: s.version + 1, restorePath: restore ? path.current : null }));
  }, []);

  // Native: saved device preferences before the splash screen goes away.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    (async () => {
      const [l, th] = await Promise.all([AsyncStorage.getItem(KEY_LANG).catch(() => null), AsyncStorage.getItem(KEY_THEME).catch(() => null)]);
      commit(isLang(l) ? l : detectLang(), isTheme(th) ? th : 'dark', false);
      setReady(true);
    })();
  }, [commit]);

  // Signed in: the account's preferences win (they follow you across devices).
  const pLang = profile?.language;
  const pTheme = profile?.theme;
  useEffect(() => {
    if (!session || config.demo || !isLang(pLang) || !isTheme(pTheme)) return;
    void AsyncStorage.multiSet([[KEY_LANG, pLang], [KEY_THEME, pTheme]]).catch(() => {});
    commit(pLang, pTheme, false);
  }, [session, pLang, pTheme, commit]);

  // "System" follows the OS live.
  useEffect(() => {
    const sub = Appearance.addChangeListener(() => {
      setState((s) => {
        if (s.theme !== 'system') return s;
        const scheme = resolve('system');
        if (scheme === s.scheme) return s;
        applyScheme(scheme);
        return { ...s, scheme, version: s.version + 1, restorePath: path.current };
      });
    });
    return () => sub.remove();
  }, []);

  const setLanguage = useCallback(async (l: Lang) => {
    await AsyncStorage.setItem(KEY_LANG, l).catch(() => {});
    commit(l, state.theme, true);
    if (session && !config.demo) await api.updateProfile({ language: l }).catch(() => {});
  }, [commit, session, state.theme]);

  const setTheme = useCallback(async (th: ThemePref) => {
    await AsyncStorage.setItem(KEY_THEME, th).catch(() => {});
    commit(state.lang, th, true);
    if (session && !config.demo) await api.updateProfile({ theme: th }).catch(() => {});
  }, [commit, session, state.lang]);

  const value = useMemo(() => ({ ready, ...state, setLanguage, setTheme }), [ready, state, setLanguage, setTheme]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
