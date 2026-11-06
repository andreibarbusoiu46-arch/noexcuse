// AI challenge generator: the user describes a goal, the server asks the model for a plan, the user
// reviews (and may adjust) it, and only an explicit approval starts it. Nothing here is simulated.
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { BackHeader } from '@/components/BackHeader';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ChoiceChips, PlanView } from '@/components/Challenge';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { Upsell } from '@/components/Upsell';
import { api } from '@/data';
import { DIFFICULTIES, type ChallengePlan, type Difficulty } from '@/data/types';
import { t } from '@/i18n';
import { errorText } from '@/lib/errors';
import { haptics } from '@/lib/haptics';
import { useLoad } from '@/lib/hooks';
import { useApp } from '@/providers/AppProvider';

const MINUTES = [15, 30, 45, 60, 90, 120];
const LENGTHS = [0, 1, 7, 14, 30] as const; // 0 = let the AI choose

export default function GenerateChallenge() {
  const { premium } = useApp();
  const q = useLoad(() => api.getChallenges());
  const [goal, setGoal] = useState('');
  const [minutes, setMinutes] = useState(30);
  const [difficulty, setDifficulty] = useState<Difficulty>('intermediate');
  const [length, setLength] = useState<(typeof LENGTHS)[number]>(0);
  const [plan, setPlan] = useState<ChallengePlan | null>(null);
  const [busy, setBusy] = useState<'gen' | 'start' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy('gen'); setError(null);
    try {
      const p = await api.generateChallenge({ goal: goal.trim(), minutes_per_day: minutes, difficulty, ...(length ? { duration_days: length } : {}) });
      setPlan(p);
      haptics.success();
    } catch (e) { setError(errorText(e)); haptics.error(); } finally { setBusy(null); }
  };

  const approve = async () => {
    if (!plan) return;
    setBusy('start'); setError(null);
    // The plan's progression is part of what the user approved; keep it with the description.
    const description = [plan.description, plan.progression].filter(Boolean).join('\n\n').slice(0, 600);
    try {
      const id = await api.startChallengePlan({ ...plan, description }, null, 'ai');
      haptics.success();
      router.replace({ pathname: '/challenge/[id]', params: { id } });
    } catch (e) { setError(errorText(e)); haptics.error(); } finally { setBusy(null); }
  };

  if (!premium) {
    return (
      <Screen>
        <BackHeader overline={t.ch.aiOverline} title={t.ch.aiTitle} />
        <Upsell title={t.ch.aiUpsellTitle} body={t.ch.aiUpsellBody} />
      </Screen>
    );
  }

  if (plan) {
    return (
      <Screen footer={
        <View style={{ gap: 8 }}>
          {error && <T variant="caption" tone="danger" align="center" accessibilityLiveRegion="polite">{error}</T>}
          <Button label={t.ch.approve} icon="Check" loading={busy === 'start'} disabled={!!busy || plan.objectives.some((o) => !o.weekdays.length)} onPress={approve} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button kind="glass" style={{ flex: 1 }} label={t.ch.regenerate} icon="Retry" loading={busy === 'gen'} disabled={!!busy} onPress={generate} />
            <Button kind="ghost" style={{ flex: 1 }} label={t.ch.changeGoal} disabled={!!busy} onPress={() => { setPlan(null); setError(null); }} />
          </View>
        </View>
      }>
        <BackHeader overline={t.ch.aiReview} title={plan.title} />
        <View style={{ flexDirection: 'row' }}><Badge tone="ai" label={t.ch.aiMade} /></View>
        <T variant="caption" tone="secondary">{t.ch.aiReviewBody}</T>
        <PlanView plan={plan} edit="schedule" onChange={setPlan} perDay={q.data?.bonus_per_day ?? 10} />
      </Screen>
    );
  }

  const tooShort = goal.trim().length < 5;
  return (
    <Screen footer={
      <View style={{ gap: 8 }}>
        {error && <T variant="caption" tone="danger" align="center" accessibilityLiveRegion="polite">{error}</T>}
        <Button label={busy === 'gen' ? t.ch.generating : t.ch.generate} icon="Sparkle" loading={busy === 'gen'} disabled={tooShort || !!busy} onPress={generate} />
        <T variant="caption" tone="tertiary" align="center">{t.ch.generateNote}</T>
      </View>
    }>
      <BackHeader overline={t.ch.aiOverline} title={t.ch.aiTitle} />
      <Card style={{ gap: 14 }}>
        <Field label={t.ch.goal} value={goal} onChangeText={setGoal} maxLength={500} multiline placeholder={t.ch.goalPlaceholder} />
        <ChoiceChips label={t.ch.minutes} value={minutes} options={MINUTES} name={(m) => t.ch.minutesN(m)} onChange={setMinutes} />
        <ChoiceChips label={t.ch.difficulty} value={difficulty} options={DIFFICULTIES} name={(d) => t.domain.difficulty[d]} onChange={setDifficulty} />
        <ChoiceChips label={t.ch.length} value={length} options={LENGTHS} name={(n) => (n ? t.common.days(n) : t.ch.aiChooses)} onChange={setLength} />
      </Card>
    </Screen>
  );
}
