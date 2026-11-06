// Preview a template before starting it. Times and days can be changed; the rules can't.
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { BackHeader } from '@/components/BackHeader';
import { Button } from '@/components/Button';
import { PlanView } from '@/components/Challenge';
import { Screen } from '@/components/Screen';
import { LoadingPanel, MessagePanel } from '@/components/StatePanel';
import { T } from '@/components/Text';
import { api } from '@/data';
import type { ChallengePlan, ChallengeTemplate } from '@/data/types';
import { t } from '@/i18n';
import { templateText } from '@/i18n/templates';
import { errorText } from '@/lib/errors';
import { useLoad } from '@/lib/hooks';
import { haptics } from '@/lib/haptics';
import { useApp } from '@/providers/AppProvider';

function toPlan(tpl: ChallengeTemplate): ChallengePlan {
  const x = templateText(tpl);
  return {
    title: x.title, description: x.description, rules: x.rules, evidence: x.evidence, kind: tpl.kind, difficulty: tpl.difficulty,
    duration_days: tpl.duration_days, allowed_misses: tpl.allowed_misses, objectives: x.objectives,
  };
}

export default function ChallengePreview() {
  const { template } = useLocalSearchParams<{ template: string }>();
  const { premium } = useApp();
  const q = useLoad(() => api.getChallenges());
  const tpl = q.data?.templates.find((x) => x.id === template);
  const [edited, setEdited] = useState<ChallengePlan | null>(null);
  const plan = edited ?? (tpl ? toPlan(tpl) : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (!tpl || !plan) return;
    setBusy(true); setError(null);
    try {
      const id = await api.startChallengePlan({ objectives: plan.objectives.map((o) => ({ title: o.title, proof_hint: o.proof_hint, time: o.time, weekdays: o.weekdays })) }, tpl.id, 'template');
      haptics.success();
      router.replace({ pathname: '/challenge/[id]', params: { id } });
    } catch (e) {
      setError(errorText(e));
      haptics.error();
    } finally { setBusy(false); }
  };

  const onCommitment = tpl && !tpl.objectives?.length;
  return (
    <Screen footer={plan && (
      <View style={{ gap: 8 }}>
        {error && <T variant="caption" tone="danger" align="center" accessibilityLiveRegion="polite">{error}</T>}
        {!premium ? <Button label={t.common.seePremium} icon="Lock" onPress={() => router.push('/paywall')} />
          : onCommitment ? <Button label={t.ch.chooseCommitment} onPress={() => router.push({ pathname: '/challenge/start', params: { template: tpl.id } })} />
          : <Button label={t.ch.startNow} icon="Flame" loading={busy} disabled={plan.objectives.some((o) => !o.weekdays.length)} onPress={start} />}
        <T variant="caption" tone="tertiary" align="center">{onCommitment ? t.ch.commitmentNote : t.ch.startNote}</T>
      </View>
    )}>
      <BackHeader overline={t.ch.preview} title={plan?.title ?? t.ch.tabTitle} />
      {q.loading && !q.data ? <LoadingPanel label={t.ch.loading} /> : !tpl || !plan ? (
        <MessagePanel kind="error" icon="Alert" title={t.ch.notFound} body={q.error ? t.common.connection : t.ch.notFoundBody} action={t.common.back} onAction={() => router.back()} />
      ) : (
        <>
          <T variant="h3" tone="secondary">{templateText(tpl).tagline}</T>
          <PlanView plan={plan} edit={onCommitment ? 'none' : 'schedule'} onChange={setEdited} perDay={q.data?.bonus_per_day ?? 10} />
        </>
      )}
    </Screen>
  );
}
