import type { ReactNode } from 'react';
import { Platform, RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { color, layout, palette } from '@/theme/tokens';

type GlowTone = 'violet' | 'ice' | 'green' | 'red' | 'amber' | 'grey' | 'none';
const GLOW: Record<Exclude<GlowTone, 'none'>, [string, number]> = {
  violet: [palette.violet500, 0.42], ice: [palette.ice400, 0.25], green: [palette.green400, 0.3],
  red: [palette.red400, 0.2], amber: [palette.amber400, 0.22], grey: ['#9A9AB0', 0.18],
};

/** Ambient radial light from the top of the screen (Figma "Glow"). Pure SVG gradient — cheap, no blur. */
export function Glow({ tone = 'violet', x = '50%', height = 520 }: { tone?: GlowTone; x?: string; height?: number }) {
  if (tone === 'none') return null;
  const [c, o] = GLOW[tone];
  return (
    <Svg pointerEvents="none" style={[StyleSheet.absoluteFill, { height }]} width="100%" height={height}>
      <Defs>
        <RadialGradient id="g" cx={x} cy="0%" rx="75%" ry="60%" fx={x} fy="0%">
          <Stop offset="0" stopColor={c} stopOpacity={o} />
          <Stop offset="1" stopColor={c} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width="100%" height={height} fill="url(#g)" />
    </Svg>
  );
}

/** The black-and-white summit from the Pinterest reference, rebuilt as two silhouettes + a lit ridge. */
export function Summit({ top = 150, height = 330 }: { top?: number; height?: number }) {
  return (
    <Svg pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top }} width="100%" height={height} viewBox="0 0 390 330" preserveAspectRatio="xMidYMax slice">
      <Defs>
        <LinearGradient id="far" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#C9C9D6" stopOpacity={0.16} />
          <Stop offset="0.3" stopColor="#1E1E28" stopOpacity={0.85} />
          <Stop offset="1" stopColor={palette.obsidian950} />
        </LinearGradient>
        <LinearGradient id="near" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#3A3A48" stopOpacity={0.9} />
          <Stop offset="0.5" stopColor={palette.obsidian900} />
          <Stop offset="1" stopColor={palette.obsidian950} />
        </LinearGradient>
      </Defs>
      <Path d="M0 240 L0 150 L52 120 L88 136 L150 60 L184 88 L232 14 L268 56 L306 36 L348 92 L390 70 L390 330 L0 330 Z" fill="url(#far)" />
      <Path d="M150 60 L184 88 L232 14 L268 56 L306 36" stroke="#FFFFFF" strokeOpacity={0.45} strokeWidth={1.2} fill="none" />
      <Path d="M0 220 L0 180 L70 140 L120 166 L190 110 L250 162 L310 134 L390 190 L390 330 L0 330 Z" fill="url(#near)" />
    </Svg>
  );
}

interface ScreenProps {
  children: ReactNode;
  glow?: GlowTone;
  scroll?: boolean;
  /** Extra bottom space for the floating native tab bar. */
  tabBar?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  background?: ReactNode;
  footer?: ReactNode;
}

/** Obsidian ground + ambient glow + safe areas + a centered column that caps at 560pt on iPad. */
export function Screen({ children, glow = 'violet', scroll = true, tabBar, refreshing, onRefresh, contentStyle, background, footer }: ScreenProps) {
  const insets = useSafeAreaInsets();
  // Web preview only: expo-router's web tabs sit at the top, so content moves down instead of up.
  const webTabs = Platform.OS === 'web' && tabBar;
  const pad = { paddingTop: insets.top + 12 + (webTabs ? 76 : 0), paddingBottom: (tabBar && !webTabs ? layout.tabBarClearance : 24) + (footer ? 0 : insets.bottom) };
  const column = [styles.column, pad, contentStyle];
  return (
    <View style={styles.root}>
      <Glow tone={glow} />
      {background}
      {scroll ? (
        <ScrollView
          contentContainerStyle={column}
          contentInsetAdjustmentBehavior="never"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={color.text.tertiary} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[column, { flex: 1 }]}>{children}</View>
      )}
      {footer && <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>{footer}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg.base },
  column: { width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center', paddingHorizontal: layout.gutter, gap: 20 },
  footer: { width: '100%', maxWidth: layout.maxContentWidth, alignSelf: 'center', paddingHorizontal: layout.gutter, gap: 10, paddingTop: 12 },
});
