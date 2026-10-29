import { View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { color, palette } from '@/theme/tokens';
import { T } from './Text';

/** Figma "Progress Ring". */
export function ProgressRing({ done, total, size = 132, caption = 'done today' }: { done: number; total: number; size?: number; caption?: string }) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessible accessibilityLabel={`${done} of ${total} ${caption}`}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={palette.violet600} />
            <Stop offset="1" stopColor={palette.violet300} />
          </LinearGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color.surface.glassStrong} strokeWidth={stroke} fill="none" />
        {pct > 0 && (
          <Circle cx={size / 2} cy={size / 2} r={r} stroke="url(#ring)" strokeWidth={stroke} fill="none" strokeLinecap="round"
            strokeDasharray={`${c * pct} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        )}
      </Svg>
      <T variant="h1">{`${done}/${total}`}</T>
      <T variant="caption" tone="tertiary">{caption}</T>
    </View>
  );
}

/** Thin window bar: how far through the ±15 min window we are. */
export function WindowBar({ fraction }: { fraction: number }) {
  return (
    <View style={{ height: 6, borderRadius: 3, backgroundColor: color.surface.glassStrong, overflow: 'hidden' }}>
      <View style={{ width: `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`, height: 6, borderRadius: 3, backgroundColor: palette.violet400 }} />
    </View>
  );
}
