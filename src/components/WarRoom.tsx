// War Room building blocks: Discipline Score card, commitment rows with live state, challenge progress.
import { View } from 'react-native';
import { t } from '@/i18n';
import type { ChallengeProgress, CommitmentState, DisciplineScore } from '@/data/types';
import { color, radius } from '@/theme/tokens';
import { Badge, type Tone } from './Badge';
import { Icon } from './Icon';
import { Tap } from './Tap';
import { T } from './Text';

const STATE_TONE: Record<CommitmentState, Tone> = {
  pending: 'neutral', in_progress: 'accent', submitted: 'ai', needs_evidence: 'warning', verified: 'success', failed: 'danger', excused: 'neutral',
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
  const caption = s === null ? t.warroom.scoreNone
    : score!.provisional ? t.warroom.calibrating(settled) : t.warroom.last28;
  return (
    <Tap onPress={onPress} accessibilityLabel={t.warroom.scoreA11y(s === null ? t.warroom.notYet : String(s), caption)} accessibilityHint={t.warroom.scoreHint}>
      <View style={{ backgroundColor: color.surface.card, borderColor: color.border.hairline, borderWidth: 1, borderRadius: radius.xl, padding: 20, gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <T variant="overline" tone="tertiary">{t.warroom.score}</T>
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
  const st = { label: t.domain.state[state], tone: STATE_TONE[state] };
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
    <Tap onPress={onPress} accessibilityLabel={t.warroom.challengeA11y(title, progress.done, progress.required, progress.days_remaining, progress.misses_left)}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <T variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>{title}</T>
          <T variant="caption" tone="secondary">{progress.done}/{progress.required}</T>
        </View>
        <Bar value={progress.percent} />
        <T variant="caption" tone="tertiary">
          {t.warroom.daysLeft(progress.days_remaining)} · {t.warroom.missesLeft(progress.misses_left)}
        </T>
      </View>
    </Tap>
  );
}
