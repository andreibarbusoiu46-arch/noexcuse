import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { BackHeader } from '@/components/BackHeader';
import { Badge, type Tone } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { LoadingPanel, MessagePanel } from '@/components/StatePanel';
import { T } from '@/components/Text';
import { api, type AppealResult, type AppealStatus } from '@/data';
import { haptics } from '@/lib/haptics';
import { useLoad, useNow } from '@/lib/hooks';
import { ApiError } from '@/lib/supabase';
import { countdown, dayLabel, formatTime } from '@/lib/time';
import { useApp } from '@/providers/AppProvider';
import { color, radius } from '@/theme/tokens';

const STATUS: Record<AppealStatus, { label: string; tone: Tone; body: string }> = {
  pending: { label: 'Under review', tone: 'ai', body: 'The second review is running. You’ll get a notification with the decision.' },
  upheld: { label: 'Verdict stands', tone: 'danger', body: 'The second review reached the same decision. The penalty stays.' },
  overturned: { label: 'Overturned', tone: 'success', body: 'The second review verified your proof. The penalty was reversed, the points were paid and your streak was restored.' },
  unavailable: { label: 'Couldn’t be reviewed', tone: 'neutral', body: 'The AI review was unavailable, so the original verdict stands.' },
};

/** One appeal per rejected proof: an independent AI re-review of the same evidence. */
export default function AppealScreen() {
  const { targetId } = useLocalSearchParams<{ targetId: string }>();
  const { profile, premium, refreshProfile } = useApp();
  const tz = profile?.timezone;
  const now = useNow(30_000);
  const q = useLoad(async () => {
    const [target, review] = await Promise.all([api.getTarget(targetId), api.getTargetReview(targetId)]);
    return { target, review };
  }, [targetId]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AppealResult | null>(null);

  const d = q.data;
  const proof = d?.review.proof;
  const appeal = d?.review.appeal;
  const until = d?.review.appealUntil ? new Date(d.review.appealUntil).getTime() : null;
  const canAppeal = !!proof && proof.outcome === 'rejected' && !appeal && !result && until !== null && until > now;

  async function submit() {
    if (!proof) return;
    setBusy(true); setError(null);
    try {
      const r = await api.appealProof(proof.id, note.trim() || null);
      setResult(r);
      if (r.status === 'overturned') haptics.success(); else haptics.warning();
      void refreshProfile();
    } catch (e) {
      haptics.error();
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'Couldn’t file the appeal.');
    } finally {
      setBusy(false);
    }
  }

  const status: AppealStatus | null = result?.status ?? appeal?.status ?? null;
  const decisionText = result?.critique ?? appeal?.critique ?? null;

  return (
    <Screen glow="none">
      <BackHeader overline={d?.target ? `${d.target.habit.title} · ${dayLabel(d.target.due_at, tz, now)} ${formatTime(d.target.due_at, tz)}` : 'Appeal'} title="Appeal" />
      {q.loading && !d ? <LoadingPanel label="Loading…" /> : q.error && !d ? (
        <MessagePanel kind="error" icon="Alert" title="Couldn’t load this proof." body="Check your connection and try again." action="Try again" onAction={() => q.reload()} />
      ) : !proof || (proof.outcome !== 'rejected' && !appeal) ? (
        <MessagePanel kind="empty" icon="Shield" title="Nothing to appeal." body="Only a rejected proof can be appealed." action="Close" onAction={() => router.back()} />
      ) : (
        <>
          <Card style={{ padding: 18, gap: 8 }}>
            <T variant="overline" tone="tertiary">First review · rejected</T>
            <T variant="bodySmall">{proof.critique ?? 'No reason recorded.'}</T>
          </Card>

          {status ? (
            <Card style={{ padding: 18, gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <T variant="overline" tone="tertiary" style={{ flex: 1 }}>Second review</T>
                <Badge tone={STATUS[status].tone} label={STATUS[status].label} />
              </View>
              {decisionText && status !== 'pending' ? <T variant="bodySmall">{decisionText}</T> : null}
              <T variant="caption" tone="secondary">{STATUS[status].body}</T>
              {result?.status === 'overturned' ? <T variant="h2" tone="success">+{result.points_delta}</T> : null}
            </Card>
          ) : !premium ? (
            <Card tone="accent" style={{ padding: 18, gap: 10 }}>
              <T variant="bodyStrong">Appeals are part of Premium.</T>
              <T variant="caption" tone="secondary">A second, independent AI review of the same evidence. One per rejected proof.</T>
              <Button label="See Premium" onPress={() => router.push('/paywall')} />
            </Card>
          ) : canAppeal ? (
            <>
              <View style={{ gap: 6 }}>
                <T variant="bodySmall" tone="secondary">
                  A second AI reviewer looks at the same evidence with fresh eyes. Your note tells it where to look — it can’t add new evidence.
                  If it verifies the proof, the −100 is reversed and you get the +50 (one new ledger entry of +150), and your streak is restored.
                </T>
                <T variant="caption" tone="tertiary">One appeal per rejection · {until ? `${countdown(until - now)} left to file` : ''}</T>
              </View>
              <Field label="What should the reviewer look at? (optional)" value={note} onChangeText={setNote} maxLength={500} multiline
                placeholder="e.g. The treadmill display in the second photo shows 5.1 km." style={{ minHeight: 96, textAlignVertical: 'top' }} />
              {error && <View style={{ padding: 14, borderRadius: radius.md, backgroundColor: color.status.dangerSoft }} accessibilityLiveRegion="assertive"><T variant="bodySmall" tone="danger">{error}</T></View>}
              <Button label="File appeal" icon="Shield" loading={busy} onPress={submit} />
            </>
          ) : (
            <T variant="bodySmall" tone="tertiary">The appeal window (48 hours after the verdict) has closed.</T>
          )}
        </>
      )}
    </Screen>
  );
}
