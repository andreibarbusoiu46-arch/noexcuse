import { View } from 'react-native';
import { color, radius } from '@/theme/tokens';
import { Badge } from './Badge';
import { IconTile } from './Blocks';
import { type IconName } from './Icon';
import { Tap } from './Tap';
import { T } from './Text';

export type HabitStatus = 'due' | 'upcoming' | 'verified' | 'missed' | 'paused' | 'excused';

const LOOK: Record<HabitStatus, { icon: IconName; bg: string; tint: string; border: string }> = {
  due: { icon: 'Bolt', bg: color.accent.soft, tint: color.accent.glow, border: color.border.accent },
  upcoming: { icon: 'Clock', bg: color.surface.glassStrong, tint: color.icon.secondary, border: color.border.hairline },
  verified: { icon: 'Check', bg: color.status.successSoft, tint: color.status.success, border: color.border.hairline },
  missed: { icon: 'Close', bg: color.status.dangerSoft, tint: color.status.danger, border: color.border.hairline },
  paused: { icon: 'Minus', bg: color.surface.glass, tint: color.icon.secondary, border: color.border.hairline },
  excused: { icon: 'Shield', bg: color.surface.glassStrong, tint: color.icon.secondary, border: color.border.hairline },
};

interface Props {
  status: HabitStatus;
  title: string;
  meta: string;
  right?: string;
  onPress?: () => void;
  accessory?: React.ReactNode;
}

/** Figma "Habit Card" — status drives the tile tint and the right slot. */
export function HabitCard({ status, title, meta, right, onPress, accessory }: Props) {
  const l = LOOK[status];
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: radius.lg, backgroundColor: color.surface.card, borderWidth: 1, borderColor: l.border,
      ...(status === 'due' ? { shadowColor: color.accent.glow, shadowOpacity: 0.45, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } } : null) }}>
      <IconTile icon={l.icon} bg={l.bg} tint={l.tint} />
      <View style={{ flex: 1, gap: 3 }}>
        <T variant="bodyStrong" tone={status === 'paused' ? 'tertiary' : 'primary'} numberOfLines={1}>{title}</T>
        <T variant="caption" tone="tertiary" numberOfLines={1}>{meta}</T>
      </View>
      {accessory}
      {!accessory && status === 'verified' && <Badge tone="success" label="+50" />}
      {!accessory && status === 'missed' && <Badge tone="danger" label="−100" />}
      {!accessory && status === 'excused' && <Badge tone="neutral" label="No penalty" />}
      {!accessory && right && (status === 'due' || status === 'upcoming') && <T variant="caption" tone={status === 'due' ? 'accent' : 'tertiary'}>{right}</T>}
    </View>
  );
  if (!onPress) return body;
  return <Tap onPress={onPress} accessibilityLabel={`${title}, ${meta}${right ? `, ${right}` : ''}`}>{body}</Tap>;
}
