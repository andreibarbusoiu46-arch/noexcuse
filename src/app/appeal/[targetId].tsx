import { router, useLocalSearchParams } from 'expo-router';
import { t } from '@/i18n';
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
import { errorText } from '@/lib/errors';
import { countdown, dayLabel, formatTime } from '@/lib/time';
import { useApp } from '@/providers/AppProvider';
import { color, radius } from '@/theme/tokens';

const TONE: Record<AppealStatus, Tone> = { pending: 'ai', upheld: 'danger', overturned: 'success', unavailable: 'neutral' };
const statusInfo = (s: AppealStatus) => ({ tone: TONE[s], ...t.appeal.status[s] });

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
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const status: AppealStatus | null = result?.status ?? appeal?.status ?? null;
  const decisionText = result?.critique ?? appeal?.critique ?? null;

  return (
    <Screen glow="none">
      <BackHeader overline={d?.target ? `${d.target.habit.title} · ${dayLabel(d.target.due_at, tz, now)} ${formatTime(d.target.due_at, tz)}` : t.appeal.title} title={t.appeal.title} />
      {q.loading && !d ? <LoadingPanel label={t.common.loading} /> : q.error && !d ? (
        <MessagePanel kind="error" icon="Alert" title={t.appeal.failTitle} body={t.common.connection} action={t.common.tryAgain} onAction={() => q.reload()} />
      ) : !proof || (proof.outcome !== 'rejected' && !appeal) ? (
        <MessagePanel kind="empty" icon="Shield" title={t.appeal.nothing} body={t.appeal.nothingBody} action={t.common.close} onAction={() => router.back()} />
      ) : (
        <>
          <Card style={{ padding: 18, gap: 8 }}>
            <T variant="overline" tone="tertiary">{t.appeal.first}</T>
            <T variant="bodySmall">{proof.critique ?? t.appeal.noReason}</T>
          </Card>

          {status ? (
            <Card style={{ padding: 18, gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <T variant="overline" tone="tertiary" style={{ flex: 1 }}>{t.appeal.second}</T>
                <Badge tone={statusInfo(status).tone} label={statusInfo(status).label} />
              </View>
              {decisionText && status !== 'pending' ? <T variant="bodySmall">{decisionText}</T> : null}
              <T variant="caption" tone="secondary">{statusInfo(status).body}</T>
              {result?.status === 'overturned' ? <T variant="h2" tone="success">+{result.points_delta}</T> : null}
            </Card>
          ) : !premium ? (
            <Card tone="accent" style={{ padding: 18, gap: 10 }}>
              <T variant="bodyStrong">{t.appeal.premiumTitle}</T>
              <T variant="caption" tone="secondary">{t.appeal.premiumBody}</T>
              <Button label={t.common.seePremium} onPress={() => router.push('/paywall')} />
            </Card>
          ) : canAppeal ? (
            <>
              <View style={{ gap: 6 }}>
                <T variant="bodySmall" tone="secondary">
                  {t.appeal.explain}
                </T>
                <T variant="caption" tone="tertiary">{until ? t.appeal.oneLeft(countdown(until - now)) : ''}</T>
              </View>
              <Field label={t.appeal.note} value={note} onChangeText={setNote} maxLength={500} multiline
                placeholder={t.appeal.notePlaceholder} style={{ minHeight: 96, textAlignVertical: 'top' }} />
              {error && <View style={{ padding: 14, borderRadius: radius.md, backgroundColor: color.status.dangerSoft }} accessibilityLiveRegion="assertive"><T variant="bodySmall" tone="danger">{error}</T></View>}
              <Button label={t.appeal.file} icon="Shield" loading={busy} onPress={submit} />
            </>
          ) : (
            <T variant="bodySmall" tone="tertiary">{t.appeal.closed}</T>
          )}
        </>
      )}
    </Screen>
  );
}
