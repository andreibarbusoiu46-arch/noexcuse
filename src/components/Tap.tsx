import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { haptics, type HapticKind } from '@/lib/haptics';

export interface TapProps extends Omit<PressableProps, 'style'> {
  haptic?: HapticKind;
  style?: StyleProp<ViewStyle> | ((s: { pressed: boolean }) => StyleProp<ViewStyle>);
  /** Dim on press for plain (non-glass) surfaces. Native glass handles its own press response. */
  dim?: boolean;
}

/** The only pressable in the app: every touch fires a haptic. */
export function Tap({ haptic = 'light', onPress, style, dim = true, accessibilityRole = 'button', disabled, ...rest }: TapProps) {
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      disabled={disabled}
      onPress={(e) => { haptics[haptic](); onPress?.(e); }}
      style={(s) => [typeof style === 'function' ? style(s) : style, dim && s.pressed && { opacity: 0.72 }, disabled && { opacity: 0.45 }]}
      hitSlop={6}
      {...rest}
    />
  );
}
