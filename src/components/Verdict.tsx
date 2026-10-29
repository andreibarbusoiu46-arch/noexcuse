import { ActivityIndicator, View } from 'react-native';
import type { VerdictResult } from '@/data/types';
import { color, radius } from '@/theme/tokens';
import { Divider } from './Card';
import { IconTile } from './Blocks';
import { type IconName } from './Icon';
import { T } from './Text';

export type VerdictState = 'processing' | VerdictResult['outcome'];

const COPY: Record<VerdictState, { icon: IconName; bg: string; tint: string; over: string; overTone: 'ai' | 'success' | 'danger' | 'warning' | 'secondary'; title: string }> = {
  processing: { icon: 'Sparkle', bg: color.ai.soft, tint: color.ai.accent, over: 'AI verification', overTone: 'ai', title: 'Checking your proof…' },
  verified: { icon: 'Check', bg: color.status.successSoft, tint: color.status.success, over: 'Verified', overTone: 'success', title: 'Done. No excuses.' },
  rejected: { icon: 'Close', bg: color.status.dangerSoft, tint: color.status.danger, over: 'Rejected', overTone: 'danger', title: 'Proof doesn’t match.' },
  insufficient: { icon: 'EyeOff', bg: color.status.warningSoft, tint: color.status.warning, over: 'Insufficient evidence', overTone: 'warning', title: 'Can’t confirm this one.' },
  expired: { icon: 'Clock', bg: color.status.dangerSoft, tint: color.status.danger, over: 'Window closed', overTone: 'danger', title: 'Submitted too late.' },
  error: { icon: 'Alert', bg: color.surface.glassStrong, tint: color.icon.secondary, over: 'Temporary error', overTone: 'secondary', title: 'Verification is down. Not you.' },
};

/** Figma "Verdict Card" — six states, server-authored critique and outcome. */
export function VerdictCard({ state, critique, points, streak }: { state: VerdictState; critique: string; points: string; streak: string }) {
  const c = COPY[state];
  const pointsTone = state === 'verified' ? 'success' : state === 'rejected' || state === 'expired' ? 'danger' : 'secondary';
  const streakTone = state === 'verified' ? 'primary' : state === 'rejected' || state === 'expired' ? 'danger' : 'secondary';
  return (
    <View accessibilityLiveRegion="polite" style={{ alignSelf: 'stretch', padding: 24, gap: 16, borderRadius: radius.xl, backgroundColor: color.surface.card, borderWidth: 1,
      borderColor: state === 'processing' ? color.ai.accent : color.border.hairline,
      ...(state === 'processing' ? { shadowColor: color.ai.accent, shadowOpacity: 0.4, shadowRadius: 15, shadowOffset: { width: 0, height: 8 } } : null),
      ...(state === 'verified' ? { shadowColor: color.status.success, shadowOpacity: 0.35, shadowRadius: 15, shadowOffset: { width: 0, height: 8 } } : null) }}>
      {state === 'processing' ? (
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={color.ai.accent} />
        </View>
      ) : (
        <IconTile icon={c.icon} bg={c.bg} tint={c.tint} size={56} />
      )}
      <View style={{ gap: 8 }}>
        <T variant="overline" tone={c.overTone}>{c.over}</T>
        <T variant="h2" accessibilityRole="header">{c.title}</T>
        <T variant="bodySmall" tone="secondary">{critique}</T>
      </View>
      <Divider />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <T variant="overline" tone="tertiary">Points</T>
          <T variant="h3" tone={pointsTone}>{points}</T>
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <T variant="overline" tone="tertiary">Streak</T>
          <T variant="h3" tone={streakTone}>{streak}</T>
        </View>
      </View>
    </View>
  );
}
