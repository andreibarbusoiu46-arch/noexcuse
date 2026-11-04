import { router } from 'expo-router';
import { View } from 'react-native';
import { Badge } from '@/components/Badge';
import { IconTile, SectionHeader } from '@/components/Blocks';
import { Button, IconButton } from '@/components/Button';
import { Card, Divider } from '@/components/Card';
import { Delta } from '@/components/Arena';
import { Glass } from '@/components/Glass';
import { Icon } from '@/components/Icon';
import { WindowBar } from '@/components/Progress';
import { ChallengeRow, CommitmentRow, MiniStat, ScoreCard } from '@/components/WarRoom';
import { Screen } from '@/components/Screen';
import { LoadingPanel, MessagePanel } from '@/components/StatePanel';
import { Tap } from '@/components/Tap';
import { T } from '@/components/Text';
import { api, type Target } from '@/data';
import { categoryLabel } from '@/lib/categories';
import { useLoad, useNow } from '@/lib/hooks';
import { countdown, dayLabel, formatTime, nextActionable, phaseOf, windowOf } from '@/lib/time';
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
    const [room, targets, arena] = await Promise.all([
      api.getWarRoom(),
      api.getTargets(new Date(start.getTime() - 3600_000).toISOString(), new Date(Date.now() + 36 * 3600_000).toISOString()),
      api.getArena().catch(() => []),
    ]);
    return { room, targets, me: arena.find((r) => r.is_me) ?? null, leader: arena[0] ?? null };
  });

  const d = q.data;
  const room = d?.room;
  const next = nextActionable(d?.targets ?? [], now);
  const list = room?.commitments ?? [];
  const done = list.filter((c) => c.state === 'verified').length;
  const failed = list.filter((c) => c.state === 'failed').length;
  const open = list.filter((c) => !['verified', 'failed', 'excused'].includes(c.state)).length;
  const firstName = profile?.display_name?.split(' ')[0] ?? '';

  return (
    <Screen tabBar refreshing={q.refreshing} onRefresh={() => q.reload()}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1, gap: 4 }}>
          <T variant="overline" tone="tertiary">War Room · {new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(now))}</T>
          <T variant="h2" accessibilityRole="header">{greeting(now, tz)} <T variant="h2" tone="accent">{firstName}.</T></T>
        </View>
        <IconButton icon="Bell" label="Notification settings" onPress={() => router.navigate('/profile')} />
      </View>

      {q.loading && !d ? (
        <LoadingPanel label="Loading your War Room…" />
      ) : q.error && !d ? (
        <MessagePanel kind="error" icon="Alert" title="Couldn’t load the War Room." body="Check your connection. Your score is safe on the server." action="Try again" onAction={() => q.reload()} />
      ) : (
        <>
          <NextTarget target={next} now={now} tz={tz} anyHabits={(d?.targets.length ?? 0) > 0} />

          <ScoreCard score={room?.score ?? null} onPress={() => router.push('/discipline')} />

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <QuickLink icon="Sparkle" title="Coach" caption="Ask anything" onPress={() => router.push('/coach')} />
            <QuickLink icon="Doc" title="Report" caption="Mondays" onPress={() => router.push('/reports')} />
            <QuickLink icon="Profile" title="Partners" caption="Stay honest" onPress={() => router.push('/partners')} />
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <MiniStat label="Today" value={`${done}/${list.length}`} caption={failed ? `${failed} failed · ${open} open` : `${open} open`} />
            <MiniStat label="This week" value={room?.week.success_rate == null ? '—' : `${room.week.success_rate}%`} caption={`${room?.week.verified ?? 0} of ${room?.week.settled ?? 0} verified`} />
            <MiniStat label="Streak" value={String(room?.streak ?? 0)} caption="days" />
            <MiniStat label="Points" value={(room?.total_points ?? 0).toLocaleString('en-US')} caption={d?.me ? `#${d.me.rank} today` : 'total'} />
          </View>

          <View style={{ gap: 12 }}>
            <SectionHeader title="Today’s commitments" action="All commitments" onAction={() => router.navigate('/habits')} />
            {list.length === 0 ? (
              <T variant="bodySmall" tone="tertiary">Nothing scheduled today.</T>
            ) : (
              <Card padding={0} style={{ gap: 0 }}>
                {list.map((c, i) => (
                  <View key={c.target_id}>
                    {i > 0 && <Divider />}
                    <CommitmentRow title={c.title} state={c.state}
                      meta={`${categoryLabel(c.category, c.custom_category)} · due ${formatTime(c.due_at, tz)}${c.streak ? ` · ${c.streak}-day streak` : ''}`}
                      onPress={() => (c.state === 'in_progress' || c.state === 'needs_evidence' ? router.push({ pathname: '/proof/[targetId]', params: { targetId: c.target_id } })
                        : c.state === 'failed' ? router.push({ pathname: '/missed/[targetId]', params: { targetId: c.target_id } })
                        : router.push({ pathname: '/habit/[id]', params: { id: c.habit_id } }))} />
                  </View>
                ))}
              </Card>
            )}
          </View>

          <View style={{ gap: 12 }}>
            <SectionHeader title="Active challenges" action={room?.challenges.length ? 'All challenges' : 'Browse'} onAction={() => router.navigate('/challenges')} />
            {(room?.challenges.length ?? 0) === 0 ? (
              <Tap onPress={() => router.navigate('/challenges')} accessibilityLabel="Start a challenge">
                <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <T variant="bodyStrong">No active challenge</T>
                    <T variant="caption" tone="secondary">Put one commitment on the line for 7–30 days. Complete it for a bonus.</T>
                  </View>
                  <Icon name="ChevronRight" size={20} tint={color.icon.secondary} />
                </Card>
              </Tap>
            ) : (
              <Card padding={0} style={{ gap: 0 }}>
                {room!.challenges.map((c, i) => (
                  <View key={c.id}>
                    {i > 0 && <Divider />}
                    <ChallengeRow title={c.title} progress={c.progress} onPress={() => router.push({ pathname: '/challenge/[id]', params: { id: c.id } })} />
                  </View>
                ))}
              </Card>
            )}
          </View>

          {(room?.upcoming.length ?? 0) > 0 && (
            <View style={{ gap: 12 }}>
              <SectionHeader title="Upcoming deadlines" />
              <Card padding={0} style={{ gap: 0 }}>
                {room!.upcoming.map((u, i) => (
                  <View key={u.target_id}>
                    {i > 0 && <Divider />}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}>
                      <T variant="bodySmall" numberOfLines={1} style={{ flex: 1 }}>{u.title}</T>
                      <T variant="caption" tone="secondary">{dayLabel(u.due_at, tz, now)} · {formatTime(u.due_at, tz)}</T>
                    </View>
                  </View>
                ))}
              </Card>
            </View>
          )}

          <Tap onPress={() => router.navigate('/arena')} accessibilityLabel="Open the Arena">
            <Card tone="accent" style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 }}>
              <IconTile icon="Arena" bg={color.accent.primary} tint={color.text.onLight} />
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
            {(room?.recent.length ?? 0) === 0 ? (
              <T variant="bodySmall" tone="tertiary">Every point you earn or lose is recorded here.</T>
            ) : (
              <Card padding={0} style={{ gap: 0 }}>
                {room!.recent.map((e, i) => (
                  <View key={e.id}>
                    {i > 0 && <Divider />}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 }} accessible accessibilityLabel={`${e.title}, ${e.delta > 0 ? 'plus' : 'minus'} ${Math.abs(e.delta)} points`}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <T variant="bodySmall" numberOfLines={1}>{e.title} {REASON[e.reason]}</T>
                        <T variant="caption" tone="tertiary">{dayLabel(e.at, tz, now)} · {formatTime(e.at, tz)}</T>
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

function QuickLink({ icon, title, caption, onPress }: { icon: 'Sparkle' | 'Doc' | 'Profile'; title: string; caption: string; onPress: () => void }) {
  return (
    <Tap onPress={onPress} accessibilityLabel={`${title}. ${caption}`} style={{ flex: 1 }}>
      <Card style={{ padding: 14, gap: 6 }}>
        <Icon name={icon} size={20} tint={color.icon.primary} />
        <T variant="bodyStrong" numberOfLines={1}>{title}</T>
        <T variant="caption" tone="tertiary" numberOfLines={1}>{caption}</T>
      </Card>
    </Tap>
  );
}

const REASON: Record<string, string> = { verified: 'verified', rejected: '— rejected', expired: '— late', missed: '— window missed', challenge_bonus: '— challenge completed', appeal_reversal: '— appeal won' };

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
