import { router } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';
import { Segmented } from '@/components/Blocks';
import { IconButton } from '@/components/Button';
import { HabitCard } from '@/components/HabitCard';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { LoadingPanel, MessagePanel } from '@/components/StatePanel';
import { T } from '@/components/Text';
import { api, type Habit, type Target } from '@/data';
import { haptics } from '@/lib/haptics';
import { useLoad, useNow } from '@/lib/hooks';
import { habitCard } from '@/lib/status';
import { localDay } from '@/lib/time';
import { useApp } from '@/providers/AppProvider';
import { color } from '@/theme/tokens';

type Filter = 'today' | 'all' | 'paused';

export default function Habits() {
  const { profile } = useApp();
  const tz = profile?.timezone;
  const now = useNow(30_000);
  const [filter, setFilter] = useState<Filter>('today');
  const q = useLoad(async () => {
    const [habits, targets] = await Promise.all([
      api.getHabits(),
      api.getTargets(new Date(Date.now() - 12 * 3600_000).toISOString(), new Date(Date.now() + 48 * 3600_000).toISOString()),
    ]);
    return { habits, targets };
  });

  const habits = q.data?.habits ?? [];
  const today = localDay(now, tz);
  const nextFor = (h: Habit): Target | undefined => {
    const ts = (q.data?.targets ?? []).filter((t) => t.habit_id === h.id);
    return ts.find((t) => localDay(t.due_at, tz) === today) ?? ts.find((t) => t.status === 'pending');
  };
  const active = habits.filter((h) => h.is_active);
  const shown = filter === 'paused' ? habits.filter((h) => !h.is_active)
    : filter === 'today' ? active.filter((h) => (q.data?.targets ?? []).some((t) => t.habit_id === h.id && localDay(t.due_at, tz) === today))
    : habits;

  async function toggle(h: Habit, on: boolean) {
    haptics.medium();
    await api.updateHabit(h.id, { is_active: on }).catch(() => haptics.error());
    void q.reload({ silent: true });
  }

  return (
    <Screen tabBar refreshing={q.refreshing} onRefresh={() => q.reload()}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1, gap: 4 }}>
          <T variant="overline" tone="tertiary">{active.length} active · {habits.length - active.length} paused</T>
          <T variant="h1" accessibilityRole="header">Habits</T>
        </View>
        <IconButton icon="Plus" label="New habit" onPress={() => router.push('/habit/new')} />
      </View>
      <Segmented value={filter} onChange={setFilter} options={[{ key: 'today', label: 'Today' }, { key: 'all', label: 'All' }, { key: 'paused', label: 'Paused' }]} />

      {q.loading && !q.data ? (
        <LoadingPanel label="Loading habits…" />
      ) : q.error && !q.data ? (
        <MessagePanel kind="error" icon="Alert" title="Couldn’t load habits." body="Check your connection and try again." action="Try again" onAction={() => q.reload()} />
      ) : habits.length === 0 ? (
        <MessagePanel kind="empty" icon="Target" title="No habits yet." body="Create one target with a time and days. That’s your first commitment." action="Create a habit" onAction={() => router.push('/habit/new')} />
      ) : shown.length === 0 ? (
        <MessagePanel kind="empty" icon={filter === 'paused' ? 'Minus' : 'Check'} title={filter === 'paused' ? 'Nothing paused.' : 'Nothing scheduled today.'} body={filter === 'paused' ? 'Paused habits keep their history and score nothing.' : 'Check “All” to see your full schedule.'} />
      ) : (
        <View style={{ gap: 12 }}>
          {shown.map((h) => {
            const t = nextFor(h);
            const c = habitCard(h, t, now, tz);
            return (
              <HabitCard key={h.id} {...c} title={h.title}
                accessory={!h.is_active ? <Switch value={false} onValueChange={(on) => toggle(h, on)} accessibilityLabel={`Activate ${h.title}`} trackColor={{ true: color.status.success, false: color.surface.control }} thumbColor="#FFFFFF" /> : undefined}
                onPress={() => (c.status === 'due' && t ? router.push({ pathname: '/proof/[targetId]', params: { targetId: t.id } }) : router.push({ pathname: '/habit/[id]', params: { id: h.id } }))} />
            );
          })}
        </View>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="Clock" size={16} tint={color.icon.secondary} />
        <T variant="caption" tone="tertiary" style={{ flex: 1 }}>Proof is accepted 15 min either side of the target time, in {tz ?? 'your'} time, judged on the server clock.</T>
      </View>
    </Screen>
  );
}
