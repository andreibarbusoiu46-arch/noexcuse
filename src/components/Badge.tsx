import { View } from 'react-native';
import { color, radius } from '@/theme/tokens';
import { T } from './Text';

export type Tone = 'success' | 'warning' | 'danger' | 'ai' | 'accent' | 'neutral';
// Read at render time so the tints follow the current theme.
const tones = (): Record<Tone, { bg: string; dot: string; text: 'success' | 'warning' | 'danger' | 'ai' | 'accent' | 'secondary' }> => ({
  success: { bg: color.status.successSoft, dot: color.status.success, text: 'success' },
  warning: { bg: color.status.warningSoft, dot: color.status.warning, text: 'warning' },
  danger: { bg: color.status.dangerSoft, dot: color.status.danger, text: 'danger' },
  ai: { bg: color.ai.soft, dot: color.ai.accent, text: 'ai' },
  accent: { bg: color.accent.soft, dot: color.accent.glow, text: 'accent' },
  neutral: { bg: color.surface.glassStrong, dot: color.icon.secondary, text: 'secondary' },
});

export function Badge({ tone, label }: { tone: Tone; label: string }) {
  const k = tones()[tone];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.full, backgroundColor: k.bg, alignSelf: 'flex-start' }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: k.dot }} />
      <T variant="overline" tone={k.text} numberOfLines={1}>{label}</T>
    </View>
  );
}
