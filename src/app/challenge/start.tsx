// Start a template that runs on a commitment the user already has (e.g. 30 Days of Discipline).
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { BackHeader } from '@/components/BackHeader';
import { SectionHeader } from '@/components/Blocks';
import { Button } from '@/components/Button';
import { Card, Divider } from '@/components/Card';
import { dayList } from '@/components/Challenge';
import { Screen } from '@/components/Screen';
import { LoadingPanel, MessagePanel } from '@/components/StatePanel';
import { Tap } from '@/components/Tap';
import { T } from '@/components/Text';
import { Upsell } from '@/components/Upsell';
import { api } from '@/data';
import { t } from '@/i18n';
import { templateText } from '@/i18n/templates';
import { categoryLabel } from '@/lib/categories';
import { errorText } from '@/lib/errors';
import { haptics } from '@/lib/haptics';
import { useLoad } from '@/lib/hooks';
import { useApp } from '@/providers/AppProvider';
import { color, radius } from '@/theme/tokens';

export default function StartChallenge() {
  const { template } = useLocalSearchParams<{ template: string }>();
  const { premium } = useApp();
  const q = useLoad(async () => {
    const [ch, habits] = await Promise.all([api.getChallenges(), api.getHabits()]);
    const taken = new Set(ch.mine.filter((c) => c.status === 'active').map((c) => c.habit_id));
    return { tpl: ch.templates.find((x) => x.id === template) ?? null, eligible: habits.filter((h) => h.is_active && !h.archived_at && !h.challenge_id && !taken.has(h.id)) };
  }, [template]);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tpl = q.data?.tpl;

  async function start() {
    if (!pick || !tpl) return;
    setBusy(true); setError(null);
    try {
      const id = await api.startChallenge(pick, tpl.id);
      haptics.success();
      router.replace({ pathname: '/challenge/[id]', params: { id } });
    } catch (e) { haptics.error(); setError(errorText(e)); setBusy(false); }
  }

  return (
    <Screen>
      <BackHeader overline={t.ch.onCommitment} title={tpl ? templateText(tpl).title : t.ch.challenge} />
      {!premium ? <Upsell title={t.ch.upsellTitle} body={t.ch.upsellBody} /> : q.loading && !q.data ? <LoadingPanel label={t.common.loading} /> : q.error && !q.data ? (
        <MessagePanel kind="error" icon="Alert" title={t.ch.loadFail} body={t.common.connection} action={t.common.tryAgain} onAction={() => q.reload()} />
      ) : !tpl ? (
        <MessagePanel kind="empty" icon="Target" title={t.ch.notFound} body={t.ch.notFoundBody} action={t.ch.all} onAction={() => router.navigate('/challenges')} />
      ) : (
        <>
          <View style={{ gap: 12 }}>
            <SectionHeader title={t.ch.whichCommitment} />
            {q.data!.eligible.length === 0 ? (
              <View style={{ gap: 12 }}>
                <T variant="bodySmall" tone="tertiary">{t.ch.noneFree}</T>
                <Button kind="glass" icon="Plus" label={t.ch.newCommitment} onPress={() => router.push('/habit/new')} />
              </View>
            ) : (
              <Card padding={0} style={{ gap: 0 }}>
                {q.data!.eligible.map((h, i) => {
                  const on = pick === h.id;
                  return (
                    <View key={h.id}>
                      {i > 0 && <Divider />}
                      <Tap haptic="selection" onPress={() => setPick(h.id)} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${h.title}, ${h.target_time.slice(0, 5)}`}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
                          <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: on ? color.text.primary : color.border.strong, alignItems: 'center', justifyContent: 'center' }}>
                            {on && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color.text.primary }} />}
                          </View>
                          <View style={{ flex: 1, gap: 2 }}>
                            <T variant="bodyStrong" numberOfLines={1}>{h.title}</T>
                            <T variant="caption" tone="tertiary">{categoryLabel(h.category, h.custom_category)} · {h.target_time.slice(0, 5)} · {dayList(h.weekdays)}</T>
                          </View>
                        </View>
                      </Tap>
                    </View>
                  );
                })}
              </Card>
            )}
          </View>
          {error && <View style={{ padding: 14, borderRadius: radius.md, backgroundColor: color.status.dangerSoft }} accessibilityLiveRegion="assertive"><T variant="bodySmall" tone="danger">{error}</T></View>}
          {q.data!.eligible.length > 0 && <Button label={t.ch.startNow} icon="Flame" disabled={!pick || busy} loading={busy} onPress={start} />}
          <T variant="caption" tone="tertiary">{t.ch.commitmentNote}</T>
        </>
      )}
    </Screen>
  );
}
