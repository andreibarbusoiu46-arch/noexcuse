import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { BackHeader } from '@/components/BackHeader';
import { Badge, type Tone } from '@/components/Badge';
import { SectionHeader } from '@/components/Blocks';
import { Button } from '@/components/Button';
import { Card, Divider } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { LoadingPanel, MessagePanel } from '@/components/StatePanel';
import { T } from '@/components/Text';
import { Bar, MiniStat } from '@/components/WarRoom';
import { api, type Target } from '@/data';
import { confirmDestructive, notify } from '@/lib/dialog';
import { useLoad } from '@/lib/hooks';
import { dayLabel, formatTime } from '@/lib/time';
import { useApp } from '@/providers/AppProvider';

const STATUS: Record<Target['status'], { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'neutral' }, verified: { label: 'Verified', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' }, missed: { label: 'Missed', tone: 'danger' }, excused: { label: 'Excused', tone: 'neutral' },
};
const END: Record<string, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'accent' }, completed: { label: 'Completed', tone: 'success' }, failed: { label: 'Failed', tone: 'danger' }, abandoned: { label: 'Abandoned', tone: 'neutral' },
};

export default function ChallengeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useApp();
  const tz = profile?.timezone;
  const [busy, setBusy] = useState(false);
  const q = useLoad(async () => {
    const all = await api.getChallenges();
    const c = all.mine.find((x) => x.id === id) ?? null;
    if (!c) return { c, days: [] as Target[] };
    const history = await api.getHabitHistory(c.habit_id, Math.min(200, c.required_days + c.allowed_misses + 30));
    return { c, days: history.filter((t) => t.local_date >= c.start_date && t.local_date <= c.end_date) };
  }, [id]);

  const c = q.data?.c;
  async function abandon() {
    if (!c) return;
    const ok = await confirmDestructive('Abandon this challenge?', 'It ends now and no bonus is paid. Points already earned on the commitment stay.', 'Abandon');
    if (!ok) return;
    setBusy(true);
    try { await api.abandonChallenge(c.id); await q.reload(); } catch (e) { notify('Couldn’t abandon', (e as Error).message); } finally { setBusy(false); }
  }

  return (
    <Screen refreshing={q.refreshing} onRefresh={() => q.reload()}>
      <BackHeader overline={c ? `${c.habit_title} · ${c.start_date} → ${c.end_date}` : 'Challenge'} title={c?.title ?? 'Challenge'} />
      {q.loading && !q.data ? <LoadingPanel label="Loading…" /> : q.error && !q.data ? (
        <MessagePanel kind="error" icon="Alert" title="Couldn’t load the challenge." body="Check your connection and try again." action="Try again" onAction={() => q.reload()} />
      ) : !c ? (
        <MessagePanel kind="empty" icon="Target" title="Challenge not found." body="It may belong to another account." action="All challenges" onAction={() => router.navigate('/challenges')} />
      ) : (
        <>
          <Card style={{ padding: 20, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <T variant="h2" style={{ flex: 1 }}>{c.progress.done} / {c.progress.required} days</T>
              <Badge {...END[c.status]} />
            </View>
            <Bar value={c.progress.percent} />
            <T variant="caption" tone="secondary">
              {c.status === 'active' ? `Complete it for +${c.bonus_points} bonus points.` : c.status === 'completed' ? `Bonus of +${c.bonus_points} points paid.` : 'No bonus was paid.'}
            </T>
          </Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <MiniStat label="Verified" value={String(c.progress.done)} />
            <MiniStat label="Missed" value={String(c.progress.lost)} caption={`${c.allowed_misses} allowed`} />
            <MiniStat label="Days left" value={String(c.progress.days_remaining)} />
          </View>

          <View style={{ gap: 12 }}>
            <SectionHeader title="Day by day" />
            {q.data!.days.length === 0 ? <T variant="bodySmall" tone="tertiary">No windows yet. The first one opens on the next scheduled day.</T> : (
              <Card padding={0} style={{ gap: 0 }}>
                {q.data!.days.map((t, i) => (
                  <View key={t.id}>
                    {i > 0 && <Divider />}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}>
                      <T variant="bodySmall" style={{ flex: 1 }}>{dayLabel(t.due_at, tz)} · {formatTime(t.due_at, tz)}</T>
                      <Badge {...STATUS[t.status]} />
                    </View>
                  </View>
                ))}
              </Card>
            )}
          </View>

          {c.status === 'active' && <Button kind="danger" label="Abandon challenge" icon="Close" loading={busy} onPress={abandon} />}
          <T variant="caption" tone="tertiary">Progress is computed on the server from verified targets only. Excused days don’t count against you.</T>
        </>
      )}
    </Screen>
  );
}
