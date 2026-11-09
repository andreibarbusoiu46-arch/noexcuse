import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { BackHeader } from '@/components/BackHeader';
import { Badge, type Tone } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, Divider } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { LoadingPanel, MessagePanel } from '@/components/StatePanel';
import { T } from '@/components/Text';
import { api } from '@/data';
import type { Entitlement } from '@/data/types';
import { locale, t } from '@/i18n';
import { errorText } from '@/lib/errors';
import { haptics } from '@/lib/haptics';
import { useLoad } from '@/lib/hooks';
import { manageSubscription, purchasesAvailable, stripeAvailable, syncStripe } from '@/lib/purchases';
import { useApp } from '@/providers/AppProvider';
import { color, radius } from '@/theme/tokens';

const day = (iso?: string | null) => (iso ? new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso)) : '—');

function statusOf(e: Entitlement | null): { key: string; tone: Tone } {
  if (!e) return { key: 'free', tone: 'neutral' };
  const s = e.status ?? (e.is_active ? 'active' : 'inactive');
  if (e.payment_failed || s === 'past_due' || s === 'unpaid') return { key: s === 'unpaid' ? 'unpaid' : 'past_due', tone: 'danger' };
  if (s === 'trialing') return { key: s, tone: 'accent' };
  if (s === 'active') return { key: s, tone: 'success' };
  return { key: s, tone: 'neutral' };
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 12, paddingHorizontal: 16 }}>
      <T variant="bodySmall" tone="secondary">{label}</T>
      <T variant="bodySmall" style={{ flexShrink: 1, textAlign: 'right' }}>{value}</T>
    </View>
  );
}

/** Subscription status and management: Stripe on the web, the App Store on iPhone. */
export default function Billing() {
  const { refreshPremium } = useApp();
  const { checkout } = useLocalSearchParams<{ checkout?: string }>();
  const q = useLoad(() => api.getEntitlement());
  const [busy, setBusy] = useState<'portal' | 'sync' | null>(null);
  const [note, setNote] = useState<{ tone: 'success' | 'secondary' | 'danger'; text: string } | null>(null);
  const confirmed = useRef(false);

  // Back from Stripe Checkout: read the subscription straight from Stripe (the webhook may still be on its way).
  useEffect(() => {
    if (checkout !== 'success' || !stripeAvailable() || confirmed.current) return;
    confirmed.current = true;
    let alive = true;
    (async () => {
      setNote({ tone: 'secondary', text: t.billing.confirming });
      for (let i = 0; i < 6 && alive; i++) {
        const ok = await syncStripe().catch(() => false);
        if (ok) { await refreshPremium(); await q.reload(); haptics.success(); setNote({ tone: 'success', text: t.billing.confirmed }); return; }
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (alive) { await q.reload(); setNote({ tone: 'secondary', text: t.billing.stillPending }); }
    })();
    return () => { alive = false; };
  }, [checkout, q, refreshPremium]);

  const e = q.data ?? null;
  const st = statusOf(e);
  const stripe = e?.source === 'stripe';
  const trialing = e?.status === 'trialing';

  async function portal() {
    if (busy) return;
    setBusy('portal'); setNote(null);
    try { await manageSubscription(); } catch (err) { setNote({ tone: 'danger', text: errorText(err) }); } finally { setBusy(null); }
  }
  async function refresh() {
    if (busy) return;
    setBusy('sync'); setNote(null);
    try { if (stripeAvailable()) await syncStripe(); await refreshPremium(); await q.reload(); } catch (err) { setNote({ tone: 'danger', text: errorText(err) }); } finally { setBusy(null); }
  }

  return (
    <Screen refreshing={q.refreshing} onRefresh={() => q.reload()}>
      <BackHeader overline={t.billing.overline} title={t.billing.title} />
      {note ? (
        <View style={{ padding: 14, borderRadius: radius.md, backgroundColor: note.tone === 'danger' ? color.status.dangerSoft : note.tone === 'success' ? color.status.successSoft : color.surface.glass }} accessibilityLiveRegion="polite">
          <T variant="bodySmall" tone={note.tone}>{note.text}</T>
        </View>
      ) : null}
      {q.loading && !q.data ? <LoadingPanel label={t.billing.loading} /> : q.error && !q.data ? (
        <MessagePanel kind="error" icon="Alert" title={t.billing.failTitle} body={errorText(q.error)} action={t.common.tryAgain} onAction={() => q.reload()} />
      ) : (
        <>
          <Card padding={0} style={{ gap: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 }}>
              <T variant="h3" style={{ flex: 1 }}>{t.billing.status[st.key] ?? st.key}</T>
              <Badge tone={st.tone} label={e?.cancel_at_period_end ? t.billing.cancels : t.billing.status[st.key] ?? st.key} />
            </View>
            {e ? (
              <>
                <Divider />
                <Row label={t.billing.plan} value={t.billing.planValue('€9.99')} />
                {trialing ? <><Divider /><Row label={t.billing.trialEnds} value={day(e.trial_end)} /></> : null}
                {e.is_active ? (<><Divider /><Row
                  label={e.will_renew === false ? t.billing.accessUntil : trialing ? t.billing.firstCharge : t.billing.renews}
                  value={day(trialing ? e.trial_end : e.current_period_end ?? e.expires_at)} /></>) : null}
                <Divider />
                <Row label={t.billing.billedBy} value={stripe ? t.billing.stripe : t.billing.appStore} />
              </>
            ) : (
              <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}><T variant="bodySmall" tone="secondary">{t.billing.freeBody}</T></View>
            )}
          </Card>

          {e?.payment_failed ? (
            <Card style={{ gap: 8, backgroundColor: color.status.dangerSoft }}>
              <T variant="bodyStrong" tone="danger">{t.billing.failedTitle}</T>
              <T variant="bodySmall" tone="secondary">{t.billing.failedBody}</T>
              {stripeAvailable() && stripe ? <Button label={t.billing.fixCard} onPress={portal} loading={busy === 'portal'} disabled={!!busy} /> : null}
            </Card>
          ) : null}

          {!e?.is_active ? <Button label={t.billing.start} icon="Sparkle" onPress={() => router.push('/paywall')} /> : null}

          {stripe && stripeAvailable() ? (
            <View style={{ gap: 8 }}>
              <Button kind="glass" label={t.billing.manage} onPress={portal} loading={busy === 'portal'} disabled={!!busy} />
              <T variant="caption" tone="tertiary">{t.billing.manageBody}</T>
            </View>
          ) : null}
          {!stripe && e && Platform.OS === 'web' ? <T variant="caption" tone="tertiary">{t.billing.manageOnIphone}</T> : null}
          {!stripe && e && purchasesAvailable() ? <Button kind="glass" label={t.billing.manage} onPress={portal} disabled={!!busy} /> : null}
          {stripe && Platform.OS !== 'web' ? <T variant="caption" tone="tertiary">{t.billing.iosWeb}</T> : null}

          <Button kind="ghost" label={t.billing.refresh} icon="Retry" onPress={refresh} loading={busy === 'sync'} disabled={!!busy} />
        </>
      )}
    </Screen>
  );
}
