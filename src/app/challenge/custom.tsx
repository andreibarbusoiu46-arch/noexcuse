// Build a challenge by hand: name, category, difficulty, length, misses, 1–5 objectives.
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { BackHeader } from '@/components/BackHeader';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ChoiceChips, NumberStepper, PlanView } from '@/components/Challenge';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { api } from '@/data';
import { CHALLENGE_KINDS, DIFFICULTIES, type ChallengeKind, type ChallengePlan, type Difficulty } from '@/data/types';
import { t } from '@/i18n';
import { errorText } from '@/lib/errors';
import { haptics } from '@/lib/haptics';
import { useLoad } from '@/lib/hooks';

/** Category → fixed length (the server enforces the same). */
const FIXED: Partial<Record<ChallengeKind, number>> = { daily: 1, weekly: 7, seven_day: 7, thirty_day: 30 };
/** The most misses the server accepts for this length and category. */
const maxMisses = (kind: ChallengeKind, days: number) => (kind === 'elite' ? 0 : Math.max(Math.floor(days / 3), kind === 'weekly' ? 3 : 0));

const newObjective = () => ({ title: '', time: '07:00', weekdays: [1, 2, 3, 4, 5, 6, 7], proof_hint: '', verification_level: 'standard' as const });

export default function CustomChallenge() {
  const q = useLoad(() => api.getChallenges());
  const [plan, setPlan] = useState<ChallengePlan>({
    title: '', description: '', rules: '', kind: 'custom', difficulty: 'intermediate', duration_days: 14, allowed_misses: 1, objectives: [newObjective()],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<ChallengePlan>) => setPlan((x) => {
    const n = { ...x, ...p };
    if (FIXED[n.kind]) n.duration_days = FIXED[n.kind]!;
    if (n.kind === 'elite') n.difficulty = 'elite';
    n.allowed_misses = Math.min(n.allowed_misses, maxMisses(n.kind, n.duration_days));
    return n;
  });

  const problem = !plan.title.trim() ? t.ch.needTitle
    : plan.objectives.some((o) => !o.title.trim()) ? t.ch.needObjTitle
    : plan.objectives.some((o) => !o.weekdays.length) ? t.ch.needDays : null;

  const start = async () => {
    setBusy(true); setError(null);
    try {
      const id = await api.startChallengePlan({ ...plan, title: plan.title.trim(), objectives: plan.objectives.map((o) => ({ ...o, title: o.title.trim(), proof_hint: o.proof_hint?.trim() || null })) }, null, 'custom');
      haptics.success();
      router.replace({ pathname: '/challenge/[id]', params: { id } });
    } catch (e) { setError(errorText(e)); haptics.error(); } finally { setBusy(false); }
  };

  return (
    <Screen footer={
      <View style={{ gap: 8 }}>
        {(error || problem) && <T variant="caption" tone={error ? 'danger' : 'tertiary'} align="center" accessibilityLiveRegion="polite">{error ?? problem}</T>}
        <Button label={t.ch.startNow} icon="Flame" loading={busy} disabled={!!problem} onPress={start} />
      </View>
    }>
      <BackHeader overline={t.ch.customOverline} title={t.ch.customTitle} />

      <Card style={{ gap: 14 }}>
        <Field label={t.ch.name} value={plan.title} maxLength={60} onChangeText={(v) => set({ title: v })} placeholder={t.ch.namePlaceholder} />
        <Field label={t.ch.description} value={plan.description} maxLength={600} multiline onChangeText={(v) => set({ description: v })} placeholder={t.ch.descriptionPlaceholder} />
        <Field label={t.ch.rulesLabel} value={plan.rules} maxLength={600} multiline onChangeText={(v) => set({ rules: v })} placeholder={t.ch.rulesPlaceholder} />
      </Card>

      <Card style={{ gap: 14 }}>
        <ChoiceChips label={t.ch.category} value={plan.kind} options={CHALLENGE_KINDS} name={(k) => t.domain.kind[k]} onChange={(k) => set({ kind: k })} />
        <ChoiceChips label={t.ch.difficulty} value={plan.difficulty} options={plan.kind === 'elite' ? ['elite'] : DIFFICULTIES} name={(k: Difficulty) => t.domain.difficulty[k]} onChange={(k) => set({ difficulty: k })} />
        {!FIXED[plan.kind] && (
          <NumberStepper label={t.ch.length} value={plan.duration_days} min={3} max={90} format={(n) => t.common.days(n)} onChange={(n) => set({ duration_days: n })} />
        )}
        <NumberStepper label={t.ch.misses} value={plan.allowed_misses} min={0} max={maxMisses(plan.kind, plan.duration_days)} onChange={(n) => set({ allowed_misses: n })} />
      </Card>

      <PlanView plan={plan} edit="all" onChange={(p) => set({ objectives: p.objectives })} perDay={q.data?.bonus_per_day ?? 10} />
      {plan.objectives.length < 5 && (
        <Button kind="glass" icon="Plus" label={t.ch.addObjective} onPress={() => set({ objectives: [...plan.objectives, newObjective()] })} />
      )}
    </Screen>
  );
}
