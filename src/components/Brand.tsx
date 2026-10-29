import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { color, palette } from '@/theme/tokens';
import { T } from './Text';

/** Figma "Brand/Mark": violet tile with the summit stroke. */
export function Mark({ size = 56 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.29, shadowColor: palette.violet500, shadowOpacity: 0.55, shadowRadius: 17, shadowOffset: { width: 0, height: 10 } }} accessibilityRole="image" accessibilityLabel="NoExcuse">
      <Svg width={size} height={size} viewBox="0 0 56 56">
        <Defs>
          <LinearGradient id="m" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={palette.violet400} />
            <Stop offset="0.55" stopColor={palette.violet600} />
            <Stop offset="1" stopColor="#2A1A80" />
          </LinearGradient>
        </Defs>
        <Rect x="0.5" y="0.5" width="55" height="55" rx="16" fill="url(#m)" stroke="rgba(255,255,255,0.16)" />
        <Path d="M11 39 23.5 18l7 11.5 4-5.5L45 39" stroke="#FFFFFF" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </Svg>
    </View>
  );
}

export function Lockup() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <Mark size={40} />
      <T variant="bodyStrong" style={{ letterSpacing: 4.5, color: color.text.primary }}>NOEXCUSE</T>
    </View>
  );
}
