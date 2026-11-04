import { router } from 'expo-router';
import { t } from '@/i18n';
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
import { notify } from '@/lib/dialog';
import { errorText } from '@/lib/errors';
import { haptics } from '@/lib/haptics';
import { useLoad, useNow } from '@/lib/hooks';
import { habitCard } from '@/lib/status';
import { localDay } from '@/lib/time';
import { useApp } from '@/providers/AppProvider';
import { color } from '@/theme/tokens';

type Filter = 'today' | 'all' | 'paused';

export default function Habits() {
  const { profile, premium } = useApp();
  const tz = profile?.timezone;
  const now = useNow(30_000);
  const [filter, setFilter] = useState<Filter>('today');
  const q = useLoad(async () => {
    const [habits, targets, plan] = await Promise.all([
      api.getHabits(),
      api.getTargets(new Date(Date.now() - 12 * 3600_000).toISOString(), new Date(Date.now() + 48 * 3600_000).toISOString()),
      api.getPlan().catch(() => null),
    ]);
    return { habits, targets, plan };
  }, [premium]);

  // Archived commitments keep their history (open them from the habit detail) but are not listed here.
  const habits = (q.data?.habits ?? []).filter((h) => !h.archived_at);
  const today = localDay(now, tz);
  const nextFor = (h: Habit): Target | undefined => {
    const ts = (q.data?.targets ?? []).filter((t) => t.habit_id === h.id);
    return ts.find((t) => localDay(t.due_at, tz) === today) ?? ts.find((t) => t.status === 'pending');
  };
  const active = habits.filter((h) => h.is_active);
  const shown = filter === 'paused' ? habits.filter((h) => !h.is_active)
    : filter === 'today' ? active.filter((h) => (q.data?.targets ?? []).some((t) => t.habit_id === h.id && localDay(t.due_at, tz) === today))
    : habits;

  const freeMax = q.data?.plan?.free_max_commitments ?? 2;
  const atFreeLimit = !premium && active.length >= freeMax;

  async function toggle(h: Habit, on: boolean) {
    haptics.medium();
    await api.updateHabit(h.id, { is_active: on }).catch((e: unknown) => { haptics.error(); notify(t.habits.cantActivate, errorText(e)); });
    void q.reload({ silent: true });
  }

  const create = () => (atFreeLimit ? router.push('/paywall') : router.push('/habit/new'));

  return (
    <Screen tabBar refreshing={q.refreshing} onRefresh={() => q.reload()}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1, gap: 4 }}>
          <T variant="overline" tone="tertiary">{t.habits.overline(active.length, habits.length - active.length)}</T>
          <T variant="h1" accessibilityRole="header">{t.habits.title}</T>
        </View>
        <IconButton icon="Plus" label={t.habits.newA11y} onPress={create} />
      </View>
      {!premium && (
        <T variant="caption" tone={atFreeLimit ? 'secondary' : 'tertiary'}>
          {t.habits.freePlan(Math.min(active.length, freeMax), freeMax)}{atFreeLimit ? t.habits.freeFull : ''}
        </T>
      )}
      <Segmented value={filter} onChange={setFilter} options={[{ key: 'today', label: t.habits.today }, { key: 'all', label: t.habits.all }, { key: 'paused', label: t.habits.paused }]} />

      {q.loading && !q.data ? (
        <LoadingPanel label={t.habits.loading} />
      ) : q.error && !q.data ? (
        <MessagePanel kind="error" icon="Alert" title={t.habits.failTitle} body={t.common.connection} action={t.common.tryAgain} onAction={() => q.reload()} />
      ) : habits.length === 0 ? (
        <MessagePanel kind="empty" icon="Target" title={t.habits.emptyTitle} body={t.habits.emptyBody} action={t.habits.create} onAction={create} />
      ) : shown.length === 0 ? (
        <MessagePanel kind="empty" icon={filter === 'paused' ? 'Minus' : 'Check'} title={filter === 'paused' ? t.habits.nothingPaused : t.habits.nothingToday} body={filter === 'paused' ? t.habits.pausedBody : t.habits.todayBody} />
      ) : (
        <View style={{ gap: 12 }}>
          {shown.map((h) => {
            const next = nextFor(h);
            const c = habitCard(h, next, now, tz);
            return (
              <HabitCard key={h.id} {...c} title={h.title}
                accessory={!h.is_active ? <Switch value={false} onValueChange={(on) => toggle(h, on)} accessibilityLabel={t.habits.activate(h.title)} trackColor={{ true: color.status.success, false: color.surface.control }} thumbColor={color.surface.card} /> : undefined}
                onPress={() => (c.status === 'due' && next ? router.push({ pathname: '/proof/[targetId]', params: { targetId: next.id } }) : router.push({ pathname: '/habit/[id]', params: { id: h.id } }))} />
            );
          })}
        </View>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="Clock" size={16} tint={color.icon.secondary} />
        <T variant="caption" tone="tertiary" style={{ flex: 1 }}>{t.habits.footer(tz ?? t.habits.yourTz)}</T>
      </View>
    </Screen>
  );
}
