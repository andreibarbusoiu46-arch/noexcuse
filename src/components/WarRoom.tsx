// War Room building blocks: Discipline Score card, commitment rows with live state, challenge progress.
import { View } from 'react-native';
import type { ChallengeProgress, CommitmentState, DisciplineScore } from '@/data/types';
import { color, radius } from '@/theme/tokens';
import { Badge, type Tone } from './Badge';
import { Icon } from './Icon';
import { Tap } from './Tap';
import { T } from './Text';

export const STATE: Record<CommitmentState, { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'accent' },
  submitted: { label: 'Submitted', tone: 'ai' },
  needs_evidence: { label: 'Needs more evidence', tone: 'warning' },
  verified: { label: 'Verified', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  excused: { label: 'Excused', tone: 'neutral' },
};

export function Bar({ value, height = 6, muted }: { value: number; height?: number; muted?: boolean }) {
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: color.surface.glassStrong, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(0, Math.min(100, value))}%`, height, borderRadius: height / 2, backgroundColor: muted ? color.text.tertiary : color.text.primary }} />
    </View>
  );
}

export function ScoreCard({ score, onPress }: { score: DisciplineScore | null; onPress: () => void }) {
  const s = score?.score ?? null;
  const settled = score?.counts.settled_28 ?? 0;
  const caption = s === null ? 'Your score appears after your first settled target.'
    : score!.provisional ? `Calibrating · ${settled} of 5 settled targets` : 'Last 28 days · tap for the breakdown';
  return (
    <Tap onPress={onPress} accessibilityLabel={`Discipline Score ${s ?? 'not available yet'}. ${caption}`} accessibilityHint="Opens how the score is calculated">
      <View style={{ backgroundColor: color.surface.card, borderColor: color.border.hairline, borderWidth: 1, borderRadius: radius.xl, padding: 20, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <T variant="overline" tone="tertiary">Discipline Score</T>
          <Icon name="ChevronRight" size={18} tint={color.icon.secondary} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
          <T variant="numberXL">{s === null ? '—' : String(s)}</T>
          <T variant="bodySmall" tone="tertiary" style={{ marginBottom: 12 }}>/ 100</T>
        </View>
        <Bar value={s ?? 0} muted={score?.provisional} />
        <T variant="caption" tone="secondary">{caption}</T>
      </View>
    </Tap>
  );
}

export function MiniStat({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <View style={{ flex: 1, minWidth: 140, backgroundColor: color.surface.card, borderColor: color.border.hairline, borderWidth: 1, borderRadius: radius.lg, padding: 14, gap: 4 }}
      accessible accessibilityLabel={`${label}: ${value}${caption ? `, ${caption}` : ''}`}>
      <T variant="overline" tone="tertiary" numberOfLines={1}>{label}</T>
      <T variant="h2" numberOfLines={1} adjustsFontSizeToFit>{value}</T>
      {caption ? <T variant="caption" tone="tertiary" numberOfLines={1}>{caption}</T> : null}
    </View>
  );
}

export function CommitmentRow({ title, meta, state, onPress }: { title: string; meta: string; state: CommitmentState; onPress?: () => void }) {
  const st = STATE[state];
  return (
    <Tap onPress={onPress} accessibilityLabel={`${title}, ${meta}, ${st.label}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <T variant="bodyStrong" numberOfLines={1}>{title}</T>
          <T variant="caption" tone="tertiary" numberOfLines={1}>{meta}</T>
        </View>
        <Badge tone={st.tone} label={st.label} />
      </View>
    </Tap>
  );
}

export function ChallengeRow({ title, progress, onPress }: { title: string; progress: ChallengeProgress; onPress?: () => void }) {
  return (
    <Tap onPress={onPress} accessibilityLabel={`${title}: ${progress.done} of ${progress.required} days, ${progress.days_remaining} days remaining, ${progress.misses_left} misses left`}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <T variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>{title}</T>
          <T variant="caption" tone="secondary">{progress.done}/{progress.required}</T>
        </View>
        <Bar value={progress.percent} />
        <T variant="caption" tone="tertiary">
          {progress.days_remaining} day{progress.days_remaining === 1 ? '' : 's'} left · {progress.misses_left === 0 ? 'no misses left' : `${progress.misses_left} miss${progress.misses_left === 1 ? '' : 'es'} left`}
        </T>
      </View>
    </Tap>
  );
}
