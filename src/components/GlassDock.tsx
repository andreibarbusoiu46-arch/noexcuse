import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { t } from '@/i18n';
import { useReduceMotion } from '@/lib/hooks';
import { useApp } from '@/providers/AppProvider';
import { color, font, scheme } from '@/theme/tokens';
import { Avatar } from './Avatar';
import { Icon, type IconName } from './Icon';
import { Tap } from './Tap';
import { T } from './Text';

/** Where the last tapped section sits on screen; the next scene grows out of that point. */
let originX = 0.5;
const setRevealOrigin = (x: number) => { originX = x; };

const ITEMS: Record<string, { icon: IconName; label: () => string }> = {
  habits: { icon: 'Habits', label: () => t.tabs.commitments },
  ai: { icon: 'Sparkle', label: () => t.tabs.ai },
  index: { icon: 'Home', label: () => t.tabs.home },
  challenges: { icon: 'Target', label: () => t.tabs.challenges },
  arena: { icon: 'Arena', label: () => t.tabs.arena },
};

/** Translucent layered glass for web (real backdrop blur); the native app uses the system's Liquid Glass tab bar. */
export function webGlass(strength: 'dock' | 'panel' = 'panel') {
  const dark = scheme() !== 'light';
  return {
    backgroundColor: dark ? (strength === 'dock' ? 'rgba(18,18,20,0.62)' : 'rgba(255,255,255,0.045)') : (strength === 'dock' ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.6)'),
    borderColor: dark ? 'rgba(255,255,255,0.12)' : 'rgba(17,17,19,0.08)',
    borderWidth: 1,
    backdropFilter: `blur(${strength === 'dock' ? 28 : 18}px) saturate(140%)`,
    WebkitBackdropFilter: `blur(${strength === 'dock' ? 28 : 18}px) saturate(140%)`,
    boxShadow: dark
      ? `inset 0 1px 0 rgba(255,255,255,0.10), 0 ${strength === 'dock' ? 24 : 12}px ${strength === 'dock' ? 48 : 32}px rgba(0,0,0,0.45)`
      : `inset 0 1px 0 rgba(255,255,255,0.9), 0 ${strength === 'dock' ? 18 : 10}px ${strength === 'dock' ? 40 : 28}px rgba(17,17,19,0.10)`,
  } as object;
}

/**
 * Web navigation: a floating glass dock with Home in the centre as the primary control, the four sections
 * around it and your profile at the end. A soft light follows the active section.
 */
export function GlassDock({ state, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const { profile } = useApp();
  const routes = state.routes.filter((r) => ITEMS[r.name]);
  const active = state.routes[state.index]?.name;
  const [frames, setFrames] = useState<Record<string, { x: number; w: number }>>({});
  const [dockW, setDockW] = useState(0);
  const [x] = useState(() => new Animated.Value(0));
  const [w] = useState(() => new Animated.Value(0));
  const placed = useRef(false);

  const f = active ? frames[active] : undefined;
  useEffect(() => {
    if (!f || active === 'index') return;
    if (!placed.current || reduce) { x.setValue(f.x); w.setValue(f.w); placed.current = true; return; }
    Animated.parallel([
      Animated.spring(x, { toValue: f.x, useNativeDriver: false, stiffness: 320, damping: 32, mass: 0.9 }),
      Animated.spring(w, { toValue: f.w, useNativeDriver: false, stiffness: 320, damping: 32, mass: 0.9 }),
    ]).start();
  }, [f, active, reduce, x, w]);

  const onItemLayout = (name: string) => (e: LayoutChangeEvent) => {
    const { x: lx, width } = e.nativeEvent.layout;
    setFrames((p) => (p[name]?.x === lx && p[name]?.w === width ? p : { ...p, [name]: { x: lx, w: width } }));
  };

  const go = (key: string, name: string) => {
    const fr = frames[name];
    if (fr && dockW) setRevealOrigin((fr.x + fr.w / 2) / dockW);
    navigateToTab(key);
  };

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: Math.max(insets.bottom, 12), alignItems: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, width: '100%', maxWidth: 560 }}>
        <View accessibilityRole="tablist" accessibilityLabel={t.tabs.nav} onLayout={(e) => setDockW(e.nativeEvent.layout.width)}
          style={[{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 68, borderRadius: 34, paddingHorizontal: 6 }, webGlass('dock')]}>
          {active !== 'index' && f ? (
            <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 8, bottom: 8, left: x, width: w, borderRadius: 26,
              backgroundColor: scheme() === 'light' ? 'rgba(17,17,19,0.07)' : 'rgba(255,255,255,0.10)',
              boxShadow: scheme() === 'light' ? 'inset 0 0 0 1px rgba(17,17,19,0.06)' : 'inset 0 0 0 1px rgba(255,255,255,0.10)' } as object} />
          ) : null}
          {routes.map((r) => {
            const item = ITEMS[r.name];
            const on = r.name === active;
            if (r.name === 'index') {
              return (
                <View key={r.key} onLayout={onItemLayout(r.name)} style={{ flex: 1.15, alignItems: 'center' }}>
                  <Tap haptic="selection" onPress={() => go(r.key, r.name)} accessibilityRole="tab" accessibilityState={{ selected: on }} aria-selected={on} accessibilityLabel={item.label()}
                    style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
                      backgroundColor: on ? color.accent.primary : color.surface.glassStrong, borderWidth: 1, borderColor: on ? color.accent.primary : color.border.strong,
                      ...(on ? { boxShadow: scheme() === 'light' ? '0 8px 22px rgba(17,17,19,0.25)' : '0 0 0 6px rgba(255,255,255,0.06), 0 10px 26px rgba(255,255,255,0.18)' } : null) } as object}>
                    <Icon name="Home" size={24} tint={on ? color.text.onLight : color.icon.primary} />
                  </Tap>
                </View>
              );
            }
            return (
              <View key={r.key} onLayout={onItemLayout(r.name)} style={{ flex: 1, alignItems: 'stretch' }}>
                <Tap haptic="selection" onPress={() => go(r.key, r.name)} accessibilityRole="tab" accessibilityState={{ selected: on }} aria-selected={on} accessibilityLabel={item.label()}
                  style={{ height: 52, alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                  <Icon name={item.icon} size={21} tint={on ? color.icon.primary : color.icon.secondary} />
                  <T numberOfLines={1} style={{ fontFamily: on ? font.semibold : font.medium, fontSize: 10.5, lineHeight: 13, letterSpacing: 0.2,
                    color: on ? color.text.primary : color.text.tertiary }}>{item.label()}</T>
                </Tap>
              </View>
            );
          })}
        </View>
        <Tap haptic="selection" onPress={() => router.push('/profile')} accessibilityLabel={t.tabs.you}
          style={[{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' }, webGlass('dock')]}>
          <Avatar name={profile?.display_name ?? '?'} path={profile?.avatar_path} size={42} />
        </Tap>
      </View>
    </View>
  );
}

/** The selected section expands out of its place in the dock (scale + fade), or simply fades with Reduce Motion. */
export function revealInterpolator(reduce: boolean) {
  return ({ current }: { current: { progress: Animated.AnimatedInterpolation<number> } }) => ({
    sceneStyle: reduce ? {
      opacity: current.progress.interpolate({ inputRange: [-1, 0, 1], outputRange: [0, 1, 0] }),
    } : {
      opacity: current.progress.interpolate({ inputRange: [-1, -0.5, 0, 0.5, 1], outputRange: [0, 0.2, 1, 0.2, 0] }),
      transform: [{ scale: current.progress.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.94, 1, 0.94] }) }],
      transformOrigin: `${Math.round(originX * 100)}% 100%`,
    },
  });
}

export const revealTiming = { animation: 'timing' as const, config: { duration: 320, easing: Easing.bezier(0.22, 1, 0.36, 1) } };
