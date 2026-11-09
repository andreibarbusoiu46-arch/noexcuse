import { useEffect, useState } from 'react';
import { Animated, Easing, Platform, View } from 'react-native';
import type { WarRoom } from '@/data/types';
import { lang, t } from '@/i18n';
import { haptics } from '@/lib/haptics';
import { useReduceMotion } from '@/lib/hooks';
import { intel, intelKind } from '@/lib/quotes';
import { color, font, radius, scheme } from '@/theme/tokens';
import { webGlass } from './GlassDock';
import { Icon } from './Icon';
import { Tap } from './Tap';
import { T } from './Text';

/**
 * WAR ROOM · Daily Intel: one line from the curated library, chosen from the user's real progress
 * (rebuild, accountability, streak, progress). Same line all day; "Another" shows the next one.
 */
export function WarRoomIntel({ room, dayKey }: { room: WarRoom | null | undefined; dayKey: string }) {
  const reduce = useReduceMotion();
  const kind = intelKind(room);
  const [offset, setOffset] = useState(0);
  const q = intel(lang(), kind, dayKey, offset);
  const [a] = useState(() => new Animated.Value(0));

  useEffect(() => {
    a.setValue(0);
    Animated.timing(a, { toValue: 1, duration: reduce ? 160 : 520, easing: Easing.bezier(0.22, 1, 0.36, 1), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [q.text, reduce, a]);

  const dark = scheme() !== 'light';
  return (
    <View style={[{ borderRadius: radius.xl, padding: 22, gap: 18, overflow: 'hidden' },
      Platform.OS === 'web' ? webGlass('panel') : { backgroundColor: color.surface.card, borderWidth: 1, borderColor: color.border.strong }]}>
      {/* a thin lit edge across the top, like light catching glass */}
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 24, right: 24, height: 1, backgroundColor: dark ? 'rgba(255,255,255,0.28)' : 'rgba(17,17,19,0.12)' }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color.text.primary }} />
        <T variant="overline" tone="secondary" style={{ flex: 1 }}>{t.intel.label}</T>
        <T variant="overline" tone="tertiary">{t.intel.kind[kind]}</T>
      </View>
      <Animated.View accessibilityLiveRegion="polite" style={{ opacity: a,
        transform: reduce ? [] : [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
        <T style={{ fontFamily: font.serif, fontSize: 30, lineHeight: 36, letterSpacing: -0.8, color: color.text.primary }}>
          {q.text}
        </T>
      </Animated.View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <T variant="caption" tone="tertiary">{t.intel.why[kind]}</T>
        <Tap haptic="light" onPress={() => { haptics.light(); setOffset((o) => o + 1); }} accessibilityLabel={t.intel.another}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
            borderWidth: 1, borderColor: color.border.strong, backgroundColor: color.surface.glass }}>
          <Icon name="Retry" size={14} tint={color.icon.primary} />
          <T variant="caption">{t.intel.another}</T>
        </Tap>
      </View>
    </View>
  );
}
