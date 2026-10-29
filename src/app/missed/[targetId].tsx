import { router, useLocalSearchParams } from 'expo-router';
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

/** Figma I1 — the consequence, stated plainly, and the next chance to recover. */
export default function Missed() {
  const { targetId } = useLocalSearchParams<{ targetId: string }>();
  const { profile } = useApp();
  const tz = profile?.timezone;
  const now = useNow(1000);
  const q = useLoad(() => api.getMissed(targetId), [targetId]);

  if (q.loading) return <View style={{ flex: 1, backgroundColor: color.bg.base, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={color.text.secondary} /></View>;
  if (!q.data) {
    return (
      <Screen glow="grey" scroll={false} contentStyle={{ justifyContent: 'center' }}>
        <MessagePanel kind="error" icon="Alert" title="Couldn’t load this result." body="Check your connection and try again." action="Close" onAction={() => router.back()} />
      </Screen>
    );
  }
  const { target, event, next, totalBefore, totalAfter, streakBefore } = q.data;
  const rejected = target.status === 'rejected';
  const when = formatTime(event?.created_at ?? windowOf(target.due_at).closesAt, tz);
  const rows: { icon: IconName; label: string; from: string; to: string; delta: string }[] = [
    { icon: 'Bolt', label: 'Points', from: totalBefore.toLocaleString('en-US'), to: totalAfter.toLocaleString('en-US'), delta: '−100' },
    { icon: 'Flame', label: 'Streak', from: `${streakBefore} days`, to: '0', delta: 'Reset' },
  ];
  const nextOpens = next ? windowOf(next.due_at).opensAt : null;

  return (
    <Screen glow="red" footer={<>
      <Button label="Plan the comeback" onPress={() => router.replace({ pathname: '/comeback/[habitId]', params: { habitId: target.habit_id } })} />
      <Button kind="ghost" label="Done" onPress={() => router.back()} />
    </>}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Badge tone="danger" label={`${rejected ? 'Rejected' : 'Missed'} · ${when}`} />
        <IconButton icon="Close" label="Close" onPress={() => router.back()} />
      </View>
      <View style={{ gap: 8 }}>
        <T variant="h1" accessibilityRole="header">{rejected ? 'Proof rejected.' : 'Target missed.'}</T>
        <T tone="secondary">
          {rejected
            ? `${target.habit.title} — the photo didn’t show the habit. Here’s what it cost.`
            : `${target.habit.title} — the window closed at ${formatTime(windowOf(target.due_at).closesAt, tz)} with no valid proof. That’s the deal you made. Here’s what it cost.`}
        </T>
      </View>
      <Card padding={0} style={{ gap: 0 }}>
        {rows.map((r, i) => (
          <View key={r.label}>
            {i > 0 && <Divider />}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }} accessible accessibilityLabel={`${r.label}: ${r.from} to ${r.to}`}>
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
      {next && nextOpens && (
        <Card tone="accent" style={{ padding: 18, gap: 10 }}>
          <T variant="overline" tone="accent">Your next chance</T>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1, gap: 2 }}>
              <T variant="h3">{dayLabel(next.due_at, tz, now)} · {formatTime(next.due_at, tz)}</T>
              <T variant="caption" tone="secondary">{next.habit.title} · window {formatTime(nextOpens, tz)}–{formatTime(windowOf(next.due_at).closesAt, tz)}</T>
            </View>
            <T variant="h2" tone="accent">{countdown(nextOpens - now)}</T>
          </View>
          <T variant="bodySmall">One miss doesn’t define you. The next window does.</T>
        </Card>
      )}
    </Screen>
  );
}
