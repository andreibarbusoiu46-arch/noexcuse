// A challenge's progress: calendar, objectives, streak, time left and every piece of evidence.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { BackHeader } from '@/components/BackHeader';
import { Badge, type Tone } from '@/components/Badge';
import { SectionHeader } from '@/components/Blocks';
import { Button } from '@/components/Button';
import { Card, Divider } from '@/components/Card';
import { ChallengeCalendar, dayList, KindBadges } from '@/components/Challenge';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { LoadingPanel, MessagePanel } from '@/components/StatePanel';
import { Tap } from '@/components/Tap';
import { T } from '@/components/Text';
import { Bar, MiniStat } from '@/components/WarRoom';
import { api, type ChallengeDetail as Detail } from '@/data';
import { t } from '@/i18n';
import { challengeTitle } from '@/i18n/templates';
import { confirmDestructive, notify } from '@/lib/dialog';
import { errorText } from '@/lib/errors';
import { useLoad } from '@/lib/hooks';
import { level } from '@/lib/levels';
import { dayLabel, formatTime, shortDate } from '@/lib/time';
import { useApp } from '@/providers/AppProvider';
import { color } from '@/theme/tokens';

const STATUS_TONE: Record<Detail['status'], Tone> = { active: 'accent', completed: 'success', failed: 'danger', abandoned: 'neutral' };
const TARGET_TONE: Record<string, Tone> = { pending: 'neutral', verified: 'success', rejected: 'danger', missed: 'danger', excused: 'neutral' };

export default function ChallengeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile, premium } = useApp();
  const tz = profile?.timezone;
  const [busy, setBusy] = useState(false);
  const q = useLoad(() => api.getChallengeDetail(id), [id]);
  const c = q.data;

  async function abandon() {
    if (!c) return;
    const ok = await confirmDestructive(t.ch.abandonTitle, t.ch.abandonBody, t.ch.abandon);
    if (!ok) return;
    setBusy(true);
    try { await api.abandonChallenge(c.id); await q.reload(); } catch (e) { notify(t.ch.abandonFail, errorText(e)); } finally { setBusy(false); }
  }

  const title = c ? challengeTitle(c) : t.ch.challenge;
  return (
    <Screen refreshing={q.refreshing} onRefresh={() => q.reload()}>
      <BackHeader overline={c ? t.ch.range(shortDate(c.start_date), shortDate(c.end_date)) : t.ch.challenge} title={title} />
      {q.loading && !q.data ? <LoadingPanel label={t.common.loading} /> : q.error && !q.data ? (
        <MessagePanel kind="error" icon="Alert" title={t.ch.loadFail} body={t.common.connection} action={t.common.tryAgain} onAction={() => q.reload()} />
      ) : !c ? (
        <MessagePanel kind="empty" icon="Target" title={t.ch.notFound} body={t.ch.notYours} action={t.ch.all} onAction={() => router.navigate('/challenges')} />
      ) : (
        <>
          <Card style={{ padding: 20, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}><KindBadges kind={c.kind} difficulty={c.difficulty} /></View>
              <Badge tone={STATUS_TONE[c.status]} label={t.domain.challengeStatus[c.status]} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
              <T variant="numberXL">{c.progress.percent}%</T>
              <T variant="caption" tone="secondary" style={{ paddingBottom: 10 }}>{t.ch.daysDone(c.progress.done, c.progress.required)}</T>
            </View>
            <Bar value={c.progress.percent} />
            <T variant="caption" tone="secondary">
              {c.status === 'active' ? t.ch.bonusIfDone(c.bonus_points) : c.status === 'completed' ? t.ch.bonusPaid(c.bonus_points) : t.ch.noBonus}
            </T>
          </Card>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <MiniStat label={t.ch.streak} value={String(c.streak)} caption={t.ch.daysWord(c.streak)} />
            <MiniStat label={t.ch.missed} value={String(c.progress.lost)} caption={t.ch.ofAllowed(c.allowed_misses)} />
            <MiniStat label={t.ch.left} value={String(c.progress.days_remaining)} caption={t.ch.daysWord(c.progress.days_remaining)} />
          </View>

          {(!!c.description || !!c.rules) && (
            <Card style={{ gap: 8 }}>
              {!!c.description && <T tone="secondary">{c.description}</T>}
              {!!c.rules && <T variant="caption" tone="tertiary">{c.rules}</T>}
            </Card>
          )}

          <View style={{ gap: 12 }}>
            <SectionHeader title={t.ch.calendar} />
            <Card><ChallengeCalendar days={c.days} /></Card>
          </View>

          <View style={{ gap: 12 }}>
            <SectionHeader title={t.ch.objectivesN(c.objectives.length)} />
            <Card padding={0} style={{ gap: 0 }}>
              {c.objectives.map((o, i) => (
                <View key={o.habit_id}>
                  {i > 0 && <Divider />}
                  <Tap onPress={() => router.push({ pathname: '/habit/[id]', params: { id: o.habit_id } })} accessibilityLabel={t.ch.objA11y(o.title, o.verified, o.failed)}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
                      <View style={{ flex: 1, gap: 3 }}>
                        <T variant="bodyStrong">{o.title}</T>
                        <T variant="caption" tone="tertiary">{o.time} · {dayList(o.weekdays)} · {level(o.verification_level).label}{o.is_active ? '' : ` · ${t.ch.paused}`}</T>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 2 }}>
                        <T variant="caption" tone="secondary">✓ {o.verified}</T>
                        <T variant="caption" tone="tertiary">✕ {o.failed}</T>
                      </View>
                      <Icon name="ChevronRight" size={18} tint={color.icon.secondary} />
                    </View>
                  </Tap>
                </View>
              ))}
            </Card>
          </View>

          <View style={{ gap: 12 }}>
            <SectionHeader title={t.ch.evidenceHistory} />
            {c.evidence.length === 0 ? <T variant="bodySmall" tone="tertiary">{t.ch.noEvidence}</T> : (
              <Card padding={0} style={{ gap: 0 }}>
                {c.evidence.map((e, i) => {
                  const needs = e.status === 'pending' && e.outcome === 'insufficient';
                  const canAppeal = e.status === 'rejected' && !e.appeal;
                  return (
                    <View key={e.target_id}>
                      {i > 0 && <Divider />}
                      <View style={{ padding: 16, gap: 6 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <View style={{ flex: 1 }}>
                            <T variant="bodyStrong" numberOfLines={1}>{e.title}</T>
                            <T variant="caption" tone="tertiary">{dayLabel(e.due_at, tz)} · {formatTime(e.due_at, tz)}{e.level ? ` · ${level(e.level).label}` : ''}</T>
                          </View>
                          <Badge tone={needs ? 'warning' : TARGET_TONE[e.status]} label={needs ? t.domain.state.needs_evidence : t.domain.target[e.status]} />
                        </View>
                        {!!e.critique && <T variant="caption" tone="secondary" numberOfLines={3}>{e.critique}</T>}
                        {needs && !!e.requested_evidence && <T variant="caption" tone="warning">{t.ch.next(e.requested_evidence)}</T>}
                        {!!e.appeal && <T variant="caption" tone="tertiary">{t.domain.appealStatus[e.appeal]}</T>}
                        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                          {needs && <Button kind="glass" icon="Camera" label={t.ch.addEvidence} onPress={() => router.push({ pathname: '/proof/[targetId]', params: { targetId: e.target_id } })} />}
                          {(canAppeal || !!e.appeal) && (
                            <Button kind="ghost" label={canAppeal ? (premium ? t.ch.appeal : t.ch.appealPremium) : t.ch.seeAppeal}
                              onPress={() => (canAppeal && !premium ? router.push('/paywall') : router.push({ pathname: '/appeal/[targetId]', params: { targetId: e.target_id } }))} />
                          )}
                        </View>
                      </View>
                    </View>
                  );
                })}
              </Card>
            )}
            <T variant="caption" tone="tertiary">{t.ch.fairBody}</T>
          </View>

          {c.status === 'active' && <Button kind="danger" label={t.ch.abandon} loading={busy} onPress={abandon} />}
        </>
      )}
    </Screen>
  );
}
