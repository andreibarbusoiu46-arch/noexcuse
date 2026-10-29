import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useLiquidGlassEnabled } from '@/lib/glass';
import { color, radius } from '@/theme/tokens';
import { Glass } from './Glass';
import { Icon, type IconName } from './Icon';
import { Tap } from './Tap';
import { T } from './Text';

export type ButtonStyle = 'primary' | 'glass' | 'ghost' | 'danger';

interface Props {
  label: string;
  onPress?: () => void;
  kind?: ButtonStyle;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}

/** Figma "Button". One primary per screen. Primary = solid white with a black label; glass = clear glass. */
export function Button({ label, onPress, kind = 'primary', icon, loading, disabled, style, accessibilityHint }: Props) {
  const glassOn = useLiquidGlassEnabled();
  const tone = kind === 'ghost' ? 'secondary' : kind === 'danger' ? 'danger' : kind === 'primary' ? 'onLight' : 'primary';
  const content = (
    <View style={styles.row}>
      {loading ? (
        <ActivityIndicator color={kind === 'primary' ? color.text.onLight : color.text.primary} />
      ) : (
        <>
          {icon && <Icon name={icon} size={20} tint={color.text[tone]} />}
          <T variant="button" tone={tone} numberOfLines={1}>{label}</T>
        </>
      )}
    </View>
  );

  return (
    <Tap
      haptic={kind === 'primary' ? 'medium' : 'light'}
      onPress={onPress}
      disabled={disabled || loading}
      dim={!glassOn || kind === 'ghost' || kind === 'danger'}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      style={[kind === 'primary' && !glassOn && styles.primaryShadow, style]}
    >
      {kind === 'primary' ? (
        <Glass variant="regular" tint={color.accent.primary} interactive fallback={color.accent.primary} border={color.border.strong} style={styles.base}>
          {content}
        </Glass>
      ) : kind === 'glass' ? (
        <Glass variant="clear" interactive fallback={color.surface.glassStrong} border={color.border.strong} style={styles.base}>
          {content}
        </Glass>
      ) : (
        <View style={[styles.base, kind === 'danger' && styles.danger]}>{content}</View>
      )}
    </Tap>
  );
}

export function IconButton({ icon, label, onPress, tint }: { icon: IconName; label: string; onPress?: () => void; tint?: string }) {
  return (
    <Tap onPress={onPress} accessibilityLabel={label} dim={false} style={{ borderRadius: radius.full }}>
      <Glass variant="clear" interactive fallback={color.surface.glassStrong} style={styles.iconBtn}>
        <Icon name={icon} size={20} tint={tint} />
      </Glass>
    </Tap>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 56, borderRadius: radius.full, paddingHorizontal: 24, justifyContent: 'center', overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  danger: { backgroundColor: color.status.dangerSoft, borderWidth: 1, borderColor: color.status.danger },
  primaryShadow: { borderRadius: radius.full, shadowColor: color.accent.glow, shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  iconBtn: { width: 44, height: 44, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
