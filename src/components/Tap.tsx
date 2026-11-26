import { Platform, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { haptics, type HapticKind } from '@/lib/haptics';

export interface TapProps extends Omit<PressableProps, 'style'> {
  haptic?: HapticKind;
  style?: StyleProp<ViewStyle> | ((s: { pressed: boolean }) => StyleProp<ViewStyle>);
  /** Dim on press for plain (non-glass) surfaces. Native glass handles its own press response. */
  dim?: boolean;
}

const CHECKABLE = new Set(['radio', 'checkbox', 'switch', 'menuitemradio', 'menuitemcheckbox']);
const SELECTABLE = new Set(['tab', 'option', 'row', 'gridcell']);

/**
 * react-native-web 0.21 no longer turns `accessibilityState` into ARIA attributes, so screen readers on the web
 * didn't hear which option was selected. Derive them here, once, for every pressable. Explicit aria-* props win.
 */
function webAria(role: string | undefined, state: PressableProps['accessibilityState'], disabled: boolean | null | undefined) {
  if (Platform.OS !== 'web') return {};
  const out: Record<string, boolean> = {};
  const on = state?.checked ?? state?.selected;
  if (role && CHECKABLE.has(role) && typeof on === 'boolean') out['aria-checked'] = on;
  if (role && SELECTABLE.has(role) && typeof state?.selected === 'boolean') out['aria-selected'] = state.selected;
  if (state?.disabled ?? disabled) out['aria-disabled'] = true;
  if (typeof state?.expanded === 'boolean') out['aria-expanded'] = state.expanded;
  if (state?.busy) out['aria-busy'] = true;
  return out;
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
      {...webAria(accessibilityRole ?? undefined, rest.accessibilityState, disabled)}
      {...rest}
    />
  );
}
