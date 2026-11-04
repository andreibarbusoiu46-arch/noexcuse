import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { color, radius } from '@/theme/tokens';

/** Content surface (not glass — glass is for the control layer). */
export function Card({ children, style, tone = 'default', padding = 18 }: { children: ReactNode; style?: StyleProp<ViewStyle>; tone?: 'default' | 'accent' | 'ai' | 'success' | 'danger'; padding?: number }) {
  const bg = { default: color.surface.card, accent: color.accent.soft, ai: color.surface.card, success: color.surface.card, danger: color.surface.card }[tone];
  const border = { default: color.border.hairline, accent: color.border.accent, ai: color.ai.accent, success: color.border.hairline, danger: color.border.hairline }[tone];
  // Light mode lifts cards with a soft shadow; in dark mode the opacity is 0 and only the hairline shows.
  return <View style={[{ backgroundColor: bg, borderColor: border, borderWidth: 1, borderRadius: radius.lg, padding, gap: 12,
    shadowColor: color.shadow.color, shadowOpacity: color.shadow.opacity, shadowRadius: 14, shadowOffset: { width: 0, height: 4 } }, style]}>{children}</View>;
}

export function Divider() {
  return <View style={{ height: 1, backgroundColor: color.border.hairline, alignSelf: 'stretch' }} />;
}
