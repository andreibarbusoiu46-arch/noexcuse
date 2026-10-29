import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export type Loadable<T> = { data: T | undefined; error: Error | null; loading: boolean; refreshing: boolean; reload: (opts?: { silent?: boolean }) => Promise<void> };

/** Loads on mount and every time the screen regains focus (silently, keeping current data). */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): Loadable<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const fnRef = useRef(fn);
  useEffect(() => { fnRef.current = fn; });
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const reload = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setRefreshing(true);
    try {
      const d = await fnRef.current();
      if (alive.current) { setData(d); setError(null); }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (alive.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);

  useFocusEffect(useCallback(() => { void reload({ silent: true }); }, [reload]));
  // Params changed while the screen stayed mounted → load again.
  const depKey = deps.map(String).join('|');
  const lastKey = useRef(depKey);
  useEffect(() => {
    if (lastKey.current === depKey) return;
    lastKey.current = depKey;
    void reload({ silent: true });
  }, [depKey, reload]);
  return { data, error, loading, refreshing, reload };
}

/** Re-renders every `ms` while mounted (for countdowns). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function useA11yFlag(name: 'isReduceMotionEnabled' | 'isReduceTransparencyEnabled', event: 'reduceMotionChanged' | 'reduceTransparencyChanged'): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    const get = (AccessibilityInfo as unknown as Record<string, unknown>)[name];
    if (typeof get === 'function') {
      (get as () => Promise<boolean>).call(AccessibilityInfo).then((v) => alive && setOn(v)).catch(() => {});
    }
    let sub: { remove: () => void } | undefined;
    try {
      sub = AccessibilityInfo.addEventListener(event, (v: boolean) => setOn(v));
    } catch {
      sub = undefined; // platform without this setting (web)
    }
    return () => { alive = false; sub?.remove(); };
  }, [name, event]);
  return on;
}
export const useReduceMotion = () => useA11yFlag('isReduceMotionEnabled', 'reduceMotionChanged');
export const useReduceTransparency = () => useA11yFlag('isReduceTransparencyEnabled', 'reduceTransparencyChanged');
