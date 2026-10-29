import { GlassContainer, GlassView } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useLiquidGlassEnabled } from '@/lib/glass';
import { color } from '@/theme/tokens';

export interface GlassProps {
  /** "regular" for panels and sheets, "clear" for controls (Liquid Glass skill). */
  variant?: 'regular' | 'clear';
  /** Semantic tint only (primary action, AI, selection). */
  tint?: string;
  interactive?: boolean;
  /** What to show when native glass isn't available (pre-iOS 26, Android, Reduce Transparency): a plain opaque surface. */
  fallback?: string;
  border?: string | null;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

/**
 * The only glass in the app: native Liquid Glass through expo-glass-effect.
 * Never hand-rolled with blur/opacity — when native glass isn't available we degrade to an opaque surface.
 */
export function Glass({ variant = 'regular', tint, interactive, fallback = color.surface.raised, border = color.border.strong, style, children }: GlassProps) {
  const enabled = useLiquidGlassEnabled();
  if (!enabled) {
    return (
      <View style={[{ backgroundColor: fallback, borderColor: border ?? 'transparent', borderWidth: border ? 1 : 0 }, style]}>
        {children}
      </View>
    );
  }
  return (
    <GlassView glassEffectStyle={variant} tintColor={tint} isInteractive={interactive} colorScheme="dark" style={style}>
      {children}
    </GlassView>
  );
}

/** Groups adjacent glass so the shapes blend/morph as one (GlassEffectContainer). */
export function GlassGroup({ spacing = 12, style, children }: { spacing?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const enabled = useLiquidGlassEnabled();
  if (!enabled) return <View style={style}>{children}</View>;
  return <GlassContainer spacing={spacing} style={style}>{children}</GlassContainer>;
}
