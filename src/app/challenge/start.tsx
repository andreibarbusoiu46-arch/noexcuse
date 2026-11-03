import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { BackHeader } from '@/components/BackHeader';
import { SectionHeader } from '@/components/Blocks';
import { Button } from '@/components/Button';
import { Card, Divider } from '@/components/Card';
import { Field } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { LoadingPanel, MessagePanel } from '@/components/StatePanel';
import { Tap } from '@/components/Tap';
import { T } from '@/components/Text';
import { api, type CustomChallenge } from '@/data';
import { categoryLabel } from '@/lib/categories';
import { haptics } from '@/lib/haptics';
import { useLoad } from '@/lib/hooks';
import { formatTime } from '@/lib/time';
import { color, radius } from '@/theme/tokens';

const toDate = (hhmmss: string) => { const [h, m] = hhmmss.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d; };

export default function StartChallenge() {
  const { template } = useLocalSearchParams<{ template: string }>();
  const custom = template === 'custom';
  const q = useLoad(async () => {
    const [ch, habits] = await Promise.all([api.getChallenges(), api.getHabits()]);
    const busyHabits = new Set(ch.mine.filter((c) => c.status === 'active').map((c) => c.habit_id));
    return { t: ch.templates.find((x) => x.id === template) ?? null, bonus: ch.bonus_per_day, eligible: habits.filter((h) => h.is_active && !h.archived_at && !busyHabits.has(h.id)) };
  }, [template]);
  const [pick, setPick] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [days, setDays] = useState('14');
  const [misses, setMisses] = useState('1');
  const [busy, setBusy] = useState<'start' | 'create' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const t = q.data?.t;
  const def: CustomChallenge = { title: title.trim(), days: Number(days), allowedMisses: Number(misses) };

  function check(): string | null {
    if (!custom) return null;
    if (!def.title) return 'Name the challenge.';
    if (!Number.isInteger(def.days) || def.days < 3 || def.days > 90) return 'Length must be 3–90 days.';
    if (!Number.isInteger(def.allowedMisses) || def.allowedMisses < 0 || def.allowedMisses > Math.floor(def.days / 3)) return `Allowed misses must be 0–${Math.floor(def.days / 3)}.`;
    return null;
  }

  async function start(habitId: string, kind: 'start' | 'create') {
    const bad = check();
    if (bad) { haptics.error(); setError(bad); return; }
    setBusy(kind); setError(null);
    try {
      const id = await api.startChallenge(habitId, custom ? def : template);
      haptics.success();
      router.replace({ pathname: '/challenge/[id]', params: { id } });
    } catch (e) {
      haptics.error(); setError((e as Error).message || 'Couldn’t start the challenge.'); setBusy(null);
    }
  }

  async function createAndStart() {
    if (!t?.habit_title) return;
    setBusy('create'); setError(null);
    try {
      const h = await api.createHabit({
        title: t.habit_title, proof_hint: t.proof_hint, target_time: t.habit_time ?? '07:00:00', weekdays: t.habit_weekdays ?? [1, 2, 3, 4, 5, 6, 7],
        is_active: true, reminder_minutes: 10, category: t.category, custom_category: null, description: null, notes: null,
      });
      await start(h.id, 'create');
    } catch (e) {
      haptics.error(); setError((e as Error).message || 'Couldn’t create the commitment.'); setBusy(null);
    }
  }

  return (
    <Screen>
      <BackHeader overline={custom ? 'Your rules' : t ? `${t.duration_days} days · ${categoryLabel(t.category, null)}` : 'Challenge'} title={custom ? 'Custom challenge' : t?.title ?? 'Challenge'} />
      {q.loading && !q.data ? <LoadingPanel label="Loading…" /> : q.error && !q.data ? (
        <MessagePanel kind="error" icon="Alert" title="Couldn’t load." body="Check your connection and try again." action="Try again" onAction={() => q.reload()} />
      ) : !custom && !t ? (
        <MessagePanel kind="empty" icon="Target" title="Challenge not found." body="Pick one from the list." action="All challenges" onAction={() => router.navigate('/challenges')} />
      ) : (
        <>
          {t && (
            <Card style={{ padding: 18, gap: 8 }}>
              <T variant="bodySmall" tone="secondary">{t.description}</T>
              <T variant="caption" tone="tertiary">
                {t.allowed_misses === 0 ? 'No misses allowed.' : `${t.allowed_misses} miss${t.allowed_misses === 1 ? '' : 'es'} allowed.`} Bonus: +{q.data!.bonus} points per required day, paid once on completion.
              </T>
            </Card>
          )}
          {custom && (
            <View style={{ gap: 14 }}>
              <Field label="Challenge name" value={title} onChangeText={setTitle} placeholder="e.g. 21 days of 6 am starts" maxLength={60} />
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 1 }}><Field label="Days (3–90)" value={days} onChangeText={(v) => setDays(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={2} /></View>
                <View style={{ flex: 1 }}><Field label="Misses allowed" value={misses} onChangeText={(v) => setMisses(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={2} /></View>
              </View>
              <T variant="caption" tone="tertiary">Misses can be at most a third of the days. Bonus: +{q.data!.bonus} points per required day.</T>
            </View>
          )}

          <View style={{ gap: 12 }}>
            <SectionHeader title="On which commitment?" />
            {q.data!.eligible.length === 0 ? (
              <T variant="bodySmall" tone="tertiary">No active commitment is free. Each commitment can carry one challenge at a time.</T>
            ) : (
              <Card padding={0} style={{ gap: 0 }}>
                {q.data!.eligible.map((h, i) => {
                  const on = pick === h.id;
                  return (
                    <View key={h.id}>
                      {i > 0 && <Divider />}
                      <Tap haptic="selection" onPress={() => setPick(h.id)} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${h.title}, ${formatTime(toDate(h.target_time))}`}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
                          <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: on ? color.text.primary : color.border.strong, alignItems: 'center', justifyContent: 'center' }}>
                            {on && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color.text.primary }} />}
                          </View>
                          <View style={{ flex: 1, gap: 2 }}>
                            <T variant="bodyStrong" numberOfLines={1}>{h.title}</T>
                            <T variant="caption" tone="tertiary">{categoryLabel(h.category, h.custom_category)} · {formatTime(toDate(h.target_time))} · {h.weekdays.length === 7 ? 'every day' : `${h.weekdays.length} days a week`}</T>
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
          {q.data!.eligible.length > 0 && <Button label="Start challenge" disabled={!pick || !!busy} loading={busy === 'start'} onPress={() => pick && start(pick, 'start')} />}
          {t?.habit_title && (
            <Tap onPress={createAndStart} disabled={!!busy} accessibilityLabel={`Create the commitment ${t.habit_title} and start`}>
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <T variant="bodyStrong">{busy === 'create' ? 'Creating…' : `Create “${t.habit_title}” and start`}</T>
                  <T variant="caption" tone="secondary">{formatTime(toDate(t.habit_time ?? '07:00:00'))} · {(t.habit_weekdays?.length ?? 7) === 7 ? 'every day' : `${t.habit_weekdays!.length} days a week`} · editable later</T>
                </View>
                <Icon name="Plus" size={20} tint={color.icon.secondary} />
              </Card>
            </Tap>
          )}
          <T variant="caption" tone="tertiary">The challenge starts today if today’s window hasn’t closed, otherwise tomorrow. Scheduled days are taken from the commitment.</T>
        </>
      )}
    </Screen>
  );
}
