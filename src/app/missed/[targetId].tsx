import { router, useLocalSearchParams } from 'expo-router';
import { fmtNumber, t } from '@/i18n';
import { ActivityIndicator, View } from 'react-native';
import { Badge } from '@/components/Badge';
import { Button, IconButton } from '@/components/Button';
import { Card, Divider } from '@/components/Card';
import { Icon, type IconName } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { MessagePanel } from '@/components/StatePanel';
import { T } from '@/components/Text';
import { api } from '@/data';
import { useLoad, useNow } from '@/lib/hooks';
import { countdown, dayLabel, formatTime, windowOf } from '@/lib/time';
import { useApp } from '@/providers/AppProvider';
import { color } from '@/theme/tokens';

const rejected0 = (s: string) => s === 'rejected';

/** Figma I1 — the consequence, stated plainly, and the next chance to recover. */
export default function Missed() {
  const { targetId } = useLocalSearchParams<{ targetId: string }>();
  const { profile } = useApp();
  const tz = profile?.timezone;
  const now = useNow(1000);
  const q = useLoad(async () => {
    const [m, review] = await Promise.all([api.getMissed(targetId), api.getTargetReview(targetId).catch(() => null)]);
    return { ...m, review };
  }, [targetId]);

  if (q.loading) return <View style={{ flex: 1, backgroundColor: color.bg.base, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={color.text.secondary} /></View>;
  if (!q.data) {
    return (
      <Screen glow="grey" scroll={false} contentStyle={{ justifyContent: 'center' }}>
        <MessagePanel kind="error" icon="Alert" title={t.missed.failTitle} body={t.common.connection} action={t.common.close} onAction={() => router.back()} />
      </Screen>
    );
  }
  const { target, event, next, totalBefore, totalAfter, streakBefore, review, lastCritique } = q.data;
  const appeal = review?.appeal ?? null;
  const canAppeal = rejected0(target.status) && !!review?.appealUntil && new Date(review.appealUntil).getTime() > now;
  const rejected = target.status === 'rejected';
  const when = formatTime(event?.created_at ?? windowOf(target.due_at).closesAt, tz);
  const rows: { icon: IconName; label: string; from: string; to: string; delta: string }[] = [
    { icon: 'Bolt', label: t.missed.points, from: fmtNumber(totalBefore), to: fmtNumber(totalAfter), delta: '−100' },
    { icon: 'Flame', label: t.missed.streak, from: t.missed.days(streakBefore), to: '0', delta: t.missed.reset },
  ];
  const nextOpens = next ? windowOf(next.due_at).opensAt : null;

  return (
    <Screen glow="red" footer={<>
      <Button label={t.missed.comeback} onPress={() => router.replace({ pathname: '/comeback/[habitId]', params: { habitId: target.habit_id } })} />
      <Button kind="ghost" label={t.common.done} onPress={() => router.back()} />
    </>}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Badge tone="danger" label={t.missed.badge(rejected, when)} />
        <IconButton icon="Close" label={t.common.close} onPress={() => router.back()} />
      </View>
      <View style={{ gap: 8 }}>
        <T variant="h1" accessibilityRole="header">{rejected ? t.missed.titleRejected : t.missed.titleMissed}</T>
        <T tone="secondary">
          {rejected
            ? t.missed.bodyRejected(target.habit.title)
            : t.missed.bodyMissed(target.habit.title, formatTime(windowOf(target.due_at).closesAt, tz))}
        </T>
      </View>
      <Card padding={0} style={{ gap: 0 }}>
        {rows.map((r, i) => (
          <View key={r.label}>
            {i > 0 && <Divider />}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }} accessible accessibilityLabel={t.missed.rowA11y(r.label, r.from, r.to)}>
              <Icon name={r.icon} size={20} tint={color.icon.secondary} />
              <T tone="secondary" style={{ flex: 1 }}>{r.label}</T>
              <T variant="bodySmall" tone="tertiary">{r.from}</T>
              <Icon name="ChevronRight" size={14} tint={color.icon.secondary} />
              <T variant="bodyStrong">{r.to}</T>
              <T variant="caption" tone="danger" style={{ width: 44, textAlign: 'right' }}>{r.delta}</T>
            </View>
          </View>
        ))}
      </Card>
      {rejected && (lastCritique || appeal || canAppeal) && (
        <Card style={{ padding: 18, gap: 10 }}>
          <T variant="overline" tone="tertiary">{t.missed.why}</T>
          {lastCritique ? <T variant="bodySmall">{lastCritique}</T> : null}
          {appeal ? (
            <Badge tone={appeal.status === 'overturned' ? 'success' : appeal.status === 'pending' ? 'ai' : 'neutral'}
              label={t.domain.appealStatus[appeal.status]} />
          ) : canAppeal ? (
            <Button kind="glass" icon="Shield" label={t.missed.appeal} onPress={() => router.replace({ pathname: '/appeal/[targetId]', params: { targetId: target.id } })} />
          ) : null}
        </Card>
      )}
      {next && nextOpens && (
        <Card tone="accent" style={{ padding: 18, gap: 10 }}>
          <T variant="overline" tone="accent">{t.missed.next}</T>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1, gap: 2 }}>
              <T variant="h3">{dayLabel(next.due_at, tz, now)} · {formatTime(next.due_at, tz)}</T>
              <T variant="caption" tone="secondary">{t.missed.nextMeta(next.habit.title, formatTime(nextOpens, tz), formatTime(windowOf(next.due_at).closesAt, tz))}</T>
            </View>
            <T variant="h2" tone="accent">{countdown(nextOpens - now)}</T>
          </View>
          <T variant="bodySmall">{t.missed.oneMiss}</T>
        </Card>
      )}
    </Screen>
  );
}
