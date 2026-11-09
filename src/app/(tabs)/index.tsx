import { router } from 'expo-router';
import { fmtNumber, t } from '@/i18n';
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
import { countdown, dayLabel, formatTime, localDay, longDate, nextActionable, phaseOf, windowOf } from '@/lib/time';
import { useApp } from '@/providers/AppProvider';
import { Avatar } from '@/components/Avatar';
import { WarRoomIntel } from '@/components/Intel';
import { levelOf } from '@/lib/level';
import { color, radius } from '@/theme/tokens';

function greeting(now: number, tz?: string) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: tz }).format(new Date(now)));
  return t.home.greeting(h);
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
          <T variant="overline" tone="tertiary">{t.home.overline(longDate(now, tz))}</T>
          <T variant="h2" accessibilityRole="header">{greeting(now, tz)} <T variant="h2" tone="accent">{firstName}.</T></T>
        </View>
        <Tap onPress={() => router.push('/profile')} accessibilityLabel={t.home.you} haptic="selection">
          <Avatar name={profile?.display_name ?? '?'} path={profile?.avatar_path} size={44} />
        </Tap>
      </View>

      {q.loading && !d ? (
        <LoadingPanel label={t.home.loading} />
      ) : q.error && !d ? (
        <MessagePanel kind="error" icon="Alert" title={t.home.failTitle} body={t.home.failBody} action={t.common.tryAgain} onAction={() => q.reload()} />
      ) : (
        <>
          <WarRoomIntel room={room} dayKey={`${profile?.id ?? ''}:${localDay(now, tz)}`} />

          <DayProgress done={done} total={list.length} failed={failed} />

          <NextTarget target={next} now={now} tz={tz} anyHabits={(d?.targets.length ?? 0) > 0} />

          <ScoreCard score={room?.score ?? null} onPress={() => router.push('/discipline')} />

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <QuickLink icon="Sparkle" title={t.home.coach} caption={t.home.coachCaption} onPress={() => router.push('/coach')} />
            <QuickLink icon="Doc" title={t.home.report} caption={t.home.reportCaption} onPress={() => router.push('/reports')} />
            <QuickLink icon="Profile" title={t.home.partners} caption={t.home.partnersCaption} onPress={() => router.push('/partners')} />
          </View>

          <View style={{ flexDirection: 'row', gap: 12 }}>
            <MiniStat label={t.home.today} value={`${done}/${list.length}`} caption={failed ? t.home.failedOpen(failed, open) : t.home.openN(open)} />
            <MiniStat label={t.home.thisWeek} value={room?.week.success_rate == null ? '—' : `${room.week.success_rate}%`} caption={t.home.verifiedOf(room?.week.verified ?? 0, room?.week.settled ?? 0)} />
          </View>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <MiniStat label={t.home.streak} value={String(room?.streak ?? 0)} caption={t.home.days} />
            <MiniStat label={t.home.points} value={fmtNumber(room?.total_points ?? 0)} caption={`${t.home.level(levelOf(room?.total_points ?? 0).level)}${d?.me ? ` · ${t.home.rankToday(d.me.rank)}` : ''}`} />
          </View>

          <View style={{ gap: 12 }}>
            <SectionHeader title={t.home.todaysCommitments} action={t.home.allCommitments} onAction={() => router.navigate('/habits')} />
            {list.length === 0 ? (
              <T variant="bodySmall" tone="tertiary">{t.home.nothingToday}</T>
            ) : (
              <Card padding={0} style={{ gap: 0 }}>
                {list.map((c, i) => (
                  <View key={c.target_id}>
                    {i > 0 && <Divider />}
                    <CommitmentRow title={c.title} state={c.state}
                      meta={t.home.meta(categoryLabel(c.category, c.custom_category), formatTime(c.due_at, tz), c.streak)}
                      onPress={() => (c.state === 'in_progress' || c.state === 'needs_evidence' ? router.push({ pathname: '/proof/[targetId]', params: { targetId: c.target_id } })
                        : c.state === 'failed' ? router.push({ pathname: '/missed/[targetId]', params: { targetId: c.target_id } })
                        : router.push({ pathname: '/habit/[id]', params: { id: c.habit_id } }))} />
                  </View>
                ))}
              </Card>
            )}
          </View>

          <View style={{ gap: 12 }}>
            <SectionHeader title={t.home.activeChallenges} action={room?.challenges.length ? t.home.allChallenges : t.home.browse} onAction={() => router.navigate('/challenges')} />
            {(room?.challenges.length ?? 0) === 0 ? (
              <Tap onPress={() => router.navigate('/challenges')} accessibilityLabel={t.home.startChallenge}>
                <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <T variant="bodyStrong">{t.home.noChallenge}</T>
                    <T variant="caption" tone="secondary">{t.home.noChallengeBody}</T>
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
              <SectionHeader title={t.home.upcoming} />
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

          <Tap onPress={() => router.navigate('/arena')} accessibilityLabel={t.home.openArena}>
            <Card tone="accent" style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 }}>
              <IconTile icon="Arena" bg={color.accent.primary} tint={color.text.onLight} />
              <View style={{ flex: 1, gap: 2 }}>
                <T variant="bodyStrong">{d?.me ? t.home.arenaRank(d.me.rank) : t.home.arenaNone}</T>
                {d?.me ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Delta change={d.me.rank_change} />
                    <T variant="caption" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
                      {d.leader && d.leader.user_id !== d.me.user_id ? t.home.behind(fmtNumber(d.leader.points - d.me.points)) : t.home.lead}
                    </T>
                  </View>
                ) : (
                  <T variant="caption" tone="secondary">{t.home.arenaJoin}</T>
                )}
              </View>
              <Icon name="ChevronRight" size={20} tint={color.icon.secondary} />
            </Card>
          </Tap>

          <View style={{ gap: 12 }}>
            <SectionHeader title={t.home.recent} />
            {(room?.recent.length ?? 0) === 0 ? (
              <T variant="bodySmall" tone="tertiary">{t.home.recentEmpty}</T>
            ) : (
              <Card padding={0} style={{ gap: 0 }}>
                {room!.recent.map((e, i) => (
                  <View key={e.id}>
                    {i > 0 && <Divider />}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 }} accessible accessibilityLabel={`${e.title}, ${e.delta > 0 ? t.home.plus : t.home.minus} ${Math.abs(e.delta)} ${t.home.pointsWord}`}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <T variant="bodySmall" numberOfLines={1}>{e.title} {t.home.reason[e.reason]}</T>
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


/** The one thing to do next. Open window → countdown to close + camera. Otherwise → countdown to open. */
function NextTarget({ target, now, tz, anyHabits }: { target: Target | null; now: number; tz?: string; anyHabits: boolean }) {
  if (!target) {
    return (
      <Card tone="accent" style={{ padding: 20, gap: 12 }}>
        <T variant="overline" tone="accent">{anyHabits ? t.home.clear : t.home.startHere}</T>
        <T variant="h2">{anyHabits ? t.home.clearTitle : t.home.startTitle}</T>
        <T variant="bodySmall" tone="secondary">{anyHabits ? t.home.clearBody : t.home.startBody}</T>
        <Button label={anyHabits ? t.home.add : t.home.createFirst} icon="Plus" onPress={() => router.push('/habit/new')} />
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
        <T variant="overline" tone="accent">{t.home.nextTarget(dayLabel(target.due_at, tz, now).toLowerCase(), formatTime(target.due_at, tz))}</T>
        {open ? <Badge tone="accent" label={t.home.windowOpen} /> : <Badge tone="neutral" label={t.home.upcomingBadge} />}
      </View>
      <T variant="h2" numberOfLines={2}>{target.habit.title}</T>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }} accessible accessibilityLabel={`${countdown(open ? w.closesAt - now : w.opensAt - now)} ${open ? t.home.leftToSubmit : t.home.untilOpens}`}>
        <T variant={open || w.opensAt - now < 3600_000 ? 'numberXL' : 'numberL'} adjustsFontSizeToFit numberOfLines={1}>{countdown(open ? w.closesAt - now : w.opensAt - now)}</T>
        <T variant="caption" tone="secondary">{open ? t.home.leftToSubmit : t.home.untilOpens}</T>
      </View>
      {open && (
        <>
          <WindowBar fraction={fraction} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <T variant="caption" tone="tertiary">{formatTime(w.opensAt, tz)}</T>
            <T variant="caption" tone="tertiary">{t.home.window15}</T>
            <T variant="caption" tone="tertiary">{formatTime(w.closesAt, tz)}</T>
          </View>
        </>
      )}
      {open ? (
        <Button label={t.home.submit} icon="Camera" onPress={() => router.push({ pathname: '/proof/[targetId]', params: { targetId: target.id } })} />
      ) : (
        <Button kind="glass" label={t.home.cameraOpensAt(formatTime(w.opensAt, tz))} icon="Lock" disabled />
      )}
    </Glass>
  );
}

/** What was committed today, what is done, what is left — one line and a bar. */
function DayProgress({ done, total, failed }: { done: number; total: number; failed: number }) {
  const left = Math.max(0, total - done - failed);
  return (
    <Card style={{ gap: 12, padding: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <T variant="overline" tone="tertiary">{t.home.progress}</T>
        <T variant="caption" tone="secondary">{total === 0 ? t.home.nothingYet : left === 0 ? t.home.allDone : t.home.remaining(left)}</T>
      </View>
      <T variant="h3">{total === 0 ? '—' : t.home.doneOf(done, total)}</T>
      <View style={{ flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: color.surface.control, gap: 2 }}
        accessible accessibilityLabel={total ? t.home.doneOf(done, total) : t.home.nothingYet}>
        {total > 0 ? (
          <>
            <View style={{ flex: done, backgroundColor: color.text.primary }} />
            <View style={{ flex: failed, backgroundColor: color.text.tertiary }} />
            <View style={{ flex: left }} />
          </>
        ) : null}
      </View>
    </Card>
  );
}
