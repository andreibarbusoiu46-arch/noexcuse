import { router } from 'expo-router';
import { View } from 'react-native';
import { Badge } from '@/components/Badge';
import { IconTile, SectionHeader, StatTile } from '@/components/Blocks';
import { Button, IconButton } from '@/components/Button';
import { Card, Divider } from '@/components/Card';
import { Delta } from '@/components/Arena';
import { Glass } from '@/components/Glass';
import { HabitCard } from '@/components/HabitCard';
import { Icon } from '@/components/Icon';
import { ProgressRing, WindowBar } from '@/components/Progress';
import { Screen } from '@/components/Screen';
import { LoadingPanel, MessagePanel } from '@/components/StatePanel';
import { Tap } from '@/components/Tap';
import { T } from '@/components/Text';
import { api, type Target } from '@/data';
import { useLoad, useNow } from '@/lib/hooks';
import { targetCard } from '@/lib/status';
import { countdown, dayLabel, formatTime, localDay, nextActionable, phaseOf, windowOf } from '@/lib/time';
import { useApp } from '@/providers/AppProvider';
import { color, radius } from '@/theme/tokens';

function greeting(now: number, tz?: string) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: tz }).format(new Date(now)));
  return h < 5 ? 'Late night,' : h < 12 ? 'Morning,' : h < 18 ? 'Afternoon,' : 'Evening,';
}

export default function Home() {
  const { profile } = useApp();
  const tz = profile?.timezone;
  const now = useNow(1000);
  const q = useLoad(async () => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const [targets, stats, events, arena] = await Promise.all([
      api.getTargets(new Date(start.getTime() - 3600_000).toISOString(), new Date(Date.now() + 36 * 3600_000).toISOString()),
      api.getStats(),
      api.getRecentEvents(4),
      api.getArena().catch(() => []),
    ]);
    return { targets, stats, events, me: arena.find((r) => r.is_me) ?? null, leader: arena[0] ?? null };
  });

  const d = q.data;
  const today = localDay(now, tz);
  const todays = (d?.targets ?? []).filter((t) => localDay(t.due_at, tz) === today && t.status !== 'excused');
  const done = todays.filter((t) => t.status === 'verified').length;
  const next = nextActionable(d?.targets ?? [], now);
  const rest = todays.filter((t) => t.id !== next?.id);
  const firstName = profile?.display_name?.split(' ')[0] ?? '';

  return (
    <Screen tabBar refreshing={q.refreshing} onRefresh={() => q.reload()}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1, gap: 4 }}>
          <T variant="overline" tone="tertiary">{new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(now))}</T>
          <T variant="h2" accessibilityRole="header">{greeting(now, tz)} <T variant="h2" tone="accent">{firstName}.</T></T>
        </View>
        <IconButton icon="Bell" label="Notification settings" onPress={() => router.navigate('/profile')} />
      </View>

      {q.loading && !d ? (
        <LoadingPanel label="Loading today…" />
      ) : q.error && !d ? (
        <MessagePanel kind="error" icon="Alert" title="Couldn’t load today." body="Check your connection. Your score is safe on the server." action="Try again" onAction={() => q.reload()} />
      ) : (
        <>
          <NextTarget target={next} now={now} tz={tz} anyHabits={(d?.targets.length ?? 0) > 0} />

          <View style={{ flexDirection: 'row', gap: 16 }}>
            <Card style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, gap: 10 }}>
              <T variant="overline" tone="tertiary">Today</T>
              <ProgressRing done={done} total={todays.length} />
              <T variant="caption" tone="secondary">{todays.length - done > 0 ? `${todays.length - done} target${todays.length - done === 1 ? '' : 's'} left` : todays.length ? 'All done today' : 'Nothing scheduled'}</T>
            </Card>
            <View style={{ flex: 1, gap: 16 }}>
              <StatTile label="Streak" value={String(d?.stats.current_streak ?? 0)} caption={`days · best ${d?.stats.longest_streak ?? 0}`} icon="Flame" />
              <StatTile label="Points" value={(d?.stats.total_points ?? 0).toLocaleString('en-US')} caption={d?.me ? `#${d.me.rank} in today’s Arena` : 'total'} icon="Bolt" />
            </View>
          </View>

          {rest.length > 0 && (
            <View style={{ gap: 12 }}>
              <SectionHeader title="Today" action="All habits" onAction={() => router.navigate('/habits')} />
              {rest.map((t) => {
                const c = targetCard(t, now, tz);
                return (
                  <HabitCard key={t.id} {...c} title={t.habit.title}
                    onPress={() => (c.status === 'due' ? router.push({ pathname: '/proof/[targetId]', params: { targetId: t.id } })
                      : c.status === 'missed' ? router.push({ pathname: '/missed/[targetId]', params: { targetId: t.id } })
                      : router.push({ pathname: '/habit/[id]', params: { id: t.habit_id } }))} />
                );
              })}
            </View>
          )}

          <Tap onPress={() => router.navigate('/arena')} accessibilityLabel="Open the Arena">
            <Card tone="accent" style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 }}>
              <IconTile icon="Arena" bg={color.accent.primary} tint={color.icon.primary} />
              <View style={{ flex: 1, gap: 2 }}>
                <T variant="bodyStrong">{d?.me ? `Arena · you’re #${d.me.rank} today` : 'Arena · not ranked yet today'}</T>
                {d?.me ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Delta change={d.me.rank_change} />
                    <T variant="caption" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
                      {d.leader && d.leader.user_id !== d.me.user_id ? `${(d.leader.points - d.me.points).toLocaleString('en-US')} pts behind #1` : 'You lead today'}
                    </T>
                  </View>
                ) : (
                  <T variant="caption" tone="secondary">One verified proof puts you on the board.</T>
                )}
              </View>
              <Icon name="ChevronRight" size={20} tint={color.icon.secondary} />
            </Card>
          </Tap>

          <View style={{ gap: 12 }}>
            <SectionHeader title="Recent activity" />
            {(d?.events.length ?? 0) === 0 ? (
              <T variant="bodySmall" tone="tertiary">Your verified proofs and penalties will show up here.</T>
            ) : (
              <Card padding={0} style={{ gap: 0 }}>
                {d!.events.map((e, i) => (
                  <View key={e.id}>
                    {i > 0 && <Divider />}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 }} accessible accessibilityLabel={`${e.habit.title}, ${e.delta > 0 ? 'plus' : 'minus'} ${Math.abs(e.delta)} points`}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <T variant="bodySmall" numberOfLines={1}>{e.habit.title} {e.reason === 'verified' ? 'verified' : e.reason === 'rejected' ? '— rejected' : '— window missed'}</T>
                        <T variant="caption" tone="tertiary">{dayLabel(e.created_at, tz, now)} · {formatTime(e.created_at, tz)}</T>
                      </View>
                      <T variant="bodyStrong" tone={e.delta > 0 ? 'success' : 'danger'}>{e.delta > 0 ? `+${e.delta}` : `−${Math.abs(e.delta)}`}</T>
                    </View>
                  </View>
                ))}
              </Card>
            )}
          </View>
        </>
      )}
    </Screen>
  );
}

/** The one thing to do next. Open window → countdown to close + camera. Otherwise → countdown to open. */
function NextTarget({ target, now, tz, anyHabits }: { target: Target | null; now: number; tz?: string; anyHabits: boolean }) {
  if (!target) {
    return (
      <Card tone="accent" style={{ padding: 20, gap: 12 }}>
        <T variant="overline" tone="accent">{anyHabits ? 'Clear for now' : 'Start here'}</T>
        <T variant="h2">{anyHabits ? 'No target due in the next day and a half.' : 'Set your first target.'}</T>
        <T variant="bodySmall" tone="secondary">{anyHabits ? 'Add another habit or rest — your streaks are safe.' : 'Pick one habit, a time and the days. Proof is due ±15 minutes around it.'}</T>
        <Button label={anyHabits ? 'Add a habit' : 'Create a habit'} icon="Plus" onPress={() => router.push('/habit/new')} />
      </Card>
    );
  }
  const w = windowOf(target.due_at);
  const open = phaseOf(target.due_at, now) === 'open';
  const fraction = open ? (now - w.opensAt) / (w.closesAt - w.opensAt) : 0;
  return (
    <Glass variant="regular" tint={open ? color.accent.soft : undefined} fallback={color.surface.card} border={open ? color.border.accent : color.border.hairline}
      style={{ borderRadius: radius.xl, padding: 20, gap: 14, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', columnGap: 8, rowGap: 8 }}>
        <T variant="overline" tone="accent">Next target · {dayLabel(target.due_at, tz, now).toLowerCase()} {formatTime(target.due_at, tz)}</T>
        {open ? <Badge tone="accent" label="Window open" /> : <Badge tone="neutral" label="Upcoming" />}
      </View>
      <T variant="h2" numberOfLines={2}>{target.habit.title}</T>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }} accessible accessibilityLabel={`${countdown(open ? w.closesAt - now : w.opensAt - now)} ${open ? 'left to submit' : 'until the window opens'}`}>
        <T variant={open || w.opensAt - now < 3600_000 ? 'numberXL' : 'numberL'} adjustsFontSizeToFit numberOfLines={1}>{countdown(open ? w.closesAt - now : w.opensAt - now)}</T>
        <T variant="caption" tone="secondary">{open ? 'left to submit' : 'until the window opens'}</T>
      </View>
      {open && (
        <>
          <WindowBar fraction={fraction} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <T variant="caption" tone="tertiary">{formatTime(w.opensAt, tz)}</T>
            <T variant="caption" tone="tertiary">±15 min window</T>
            <T variant="caption" tone="tertiary">{formatTime(w.closesAt, tz)}</T>
          </View>
        </>
      )}
      {open ? (
        <Button label="Submit live proof" icon="Camera" onPress={() => router.push({ pathname: '/proof/[targetId]', params: { targetId: target.id } })} />
      ) : (
        <Button kind="glass" label={`Camera opens at ${formatTime(w.opensAt, tz)}`} icon="Lock" disabled />
      )}
    </Glass>
  );
}
