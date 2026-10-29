import { useEffect, useState } from 'react';
import { Animated, View } from 'react-native';
import { useReduceMotion } from '@/lib/hooks';
import { color, radius } from '@/theme/tokens';
import { IconTile } from './Blocks';
import { Button } from './Button';
import { type IconName } from './Icon';
import { T } from './Text';

const panel = { alignSelf: 'stretch' as const, alignItems: 'center' as const, gap: 12, paddingHorizontal: 24, paddingVertical: 32, borderRadius: radius.xl, backgroundColor: color.surface.card, borderWidth: 1, borderColor: color.border.hairline };

export function LoadingPanel({ label, rows = 3 }: { label: string; rows?: number }) {
  const reduce = useReduceMotion();
  const [pulse] = useState(() => new Animated.Value(0.5));
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse, reduce]);
  return (
    <View style={panel} accessibilityRole="progressbar" accessibilityLabel={label}>
      <Animated.View style={{ alignSelf: 'stretch', gap: 18, opacity: reduce ? 0.7 : pulse }}>
        {Array.from({ length: rows }).map((_, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: color.surface.glassStrong }} />
            <View style={{ width: 150 - i * 20, height: 12, borderRadius: 6, backgroundColor: color.surface.glassStrong }} />
            <View style={{ flex: 1 }} />
            <View style={{ width: 48, height: 12, borderRadius: 6, backgroundColor: color.surface.glass }} />
          </View>
        ))}
      </Animated.View>
      <T variant="caption" tone="tertiary">{label}</T>
    </View>
  );
}

export function MessagePanel({ kind, icon, title, body, action, onAction }: { kind: 'empty' | 'error'; icon: IconName; title: string; body: string; action?: string; onAction?: () => void }) {
  return (
    <View style={panel}>
      <IconTile icon={icon} size={52} bg={kind === 'error' ? color.status.dangerSoft : color.accent.soft} tint={kind === 'error' ? color.status.danger : color.accent.glow} />
      <T variant="h3" align="center">{title}</T>
      <T variant="bodySmall" tone="secondary" align="center">{body}</T>
      {action && <Button kind="glass" label={action} onPress={onAction} style={{ marginTop: 4 }} />}
    </View>
  );
}
