import { router, useLocalSearchParams } from 'expo-router';
import { t } from '@/i18n';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, useWindowDimensions, View } from 'react-native';
import { Badge } from '@/components/Badge';
import { Mark } from '@/components/Brand';
import { Button, IconButton } from '@/components/Button';
import { Divider } from '@/components/Card';
import { Glass } from '@/components/Glass';
import { Icon } from '@/components/Icon';
import { Screen, Summit } from '@/components/Screen';
import { Tap } from '@/components/Tap';
import { T } from '@/components/Text';
import { api } from '@/data';
import { config } from '@/lib/config';
import { haptics } from '@/lib/haptics';
import { buy, loadPlan, paywallAvailable, restore, stripeAvailable, type Plan } from '@/lib/purchases';
import { useApp } from '@/providers/AppProvider';
import { color, radius } from '@/theme/tokens';


export default function Paywall() {
  const { refreshPremium, premium } = useApp();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const [plan, setPlan] = useState<Plan | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'error'>(() => (paywallAvailable() ? 'loading' : 'unavailable'));
  const [busy, setBusy] = useState<'buy' | 'restore' | null>(null);
  const [message, setMessage] = useState<{ tone: 'danger' | 'secondary'; text: string } | null>(null);
  const { checkout } = useLocalSearchParams<{ checkout?: string }>();
  // Back from Stripe Checkout without paying.
  const shown = message ?? (checkout === 'cancelled' ? { tone: 'secondary' as const, text: t.paywall.checkoutCancelled } : null);

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!paywallAvailable()) return;
    let alive = true;
    loadPlan()
      .then((p) => { if (alive) { setPlan(p); setState(p ? 'ready' : 'unavailable'); } })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, [attempt]);

  /** After the store says yes, make the server agree before entering the app. */
  async function finish(premiumOnDevice: boolean) {
    if (!premiumOnDevice) {
      haptics.warning();
      setMessage({ tone: 'secondary', text: t.paywall.noSub });
      return;
    }
    await api.refreshEntitlement().catch(() => null);
    const ok = await refreshPremium();
    if (ok) { haptics.success(); close(); }
  }

  async function onBuy() {
    if (!plan) return;
    setBusy('buy'); setMessage(null);
    const r = await buy(plan);
    if (r.ok) await finish(r.premium);
    else if (!r.cancelled) { haptics.error(); setMessage({ tone: 'danger', text: r.message || t.paywall.buyFailed }); }
    setBusy(null);
  }

  async function onRestore() {
    setBusy('restore'); setMessage(null);
    const r = await restore();
    if (r.ok) await finish(r.premium);
    else { haptics.error(); setMessage({ tone: 'danger', text: r.message || t.paywall.restoreFailed }); }
    setBusy(null);
  }

  const { height } = useWindowDimensions();
  const compact = height < 700;
  const price = plan?.priceString ?? '€9.99';
  const trial = plan?.trialDays ?? null;
  const cta = trial ? t.paywall.ctaTrial(trial) : t.paywall.cta(price);
  const web = stripeAvailable();
  const terms = web ? (trial ? t.paywall.webTermsTrial(trial, price) : t.paywall.webTerms(price))
    : trial ? t.paywall.termsTrial(trial, price) : t.paywall.terms(price);

  const legalBlock = (
    <>
      {state === 'ready' && <T variant="caption" tone="tertiary" align="center">{terms}</T>}
      {state === 'ready' && plan?.stripeMode === 'test' && <T variant="caption" tone="warning" align="center">{t.paywall.testMode}</T>}
      <View style={{ flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', columnGap: 18, rowGap: 6 }}>
        <Tap onPress={onRestore} disabled={busy !== null || !paywallAvailable()} accessibilityLabel={web ? t.paywall.refresh : t.paywall.restore}>
          <T variant="caption" tone="secondary">{busy === 'restore' ? t.paywall.restoring : web ? t.paywall.refresh : t.paywall.restore}</T>
        </Tap>
        <Tap onPress={() => WebBrowser.openBrowserAsync(config.termsUrl)} accessibilityRole="link" accessibilityLabel={t.settings.terms}><T variant="caption" tone="secondary">{t.settings.terms}</T></Tap>
        {config.privacyUrl ? <Tap onPress={() => WebBrowser.openBrowserAsync(config.privacyUrl)} accessibilityRole="link" accessibilityLabel={t.settings.privacyPolicy}><T variant="caption" tone="secondary">{t.settings.privacyPolicy}</T></Tap> : null}
      </View>
    </>
  );

  return (
    <Screen
      glow="violet"
      background={<Summit top={40} height={260} />}
      footer={
        <>
          {state === 'ready' && !premium && <Button label={cta} onPress={onBuy} loading={busy === 'buy'} disabled={busy === 'restore'} />}
          {state === 'loading' && <View style={{ height: 56, justifyContent: 'center' }}><ActivityIndicator color={color.text.secondary} /></View>}
          {state === 'error' && <Button kind="glass" label={t.paywall.loadFail} icon="Retry" onPress={() => { setState('loading'); setAttempt((n) => n + 1); }} />}
          {state === 'unavailable' && (
            <>
              <T variant="bodySmall" tone="secondary" align="center">{Platform.OS === 'web' ? t.paywall.web : t.paywall.noStore}</T>
              <Button kind="glass" label={t.paywall.checkAgain} icon="Retry" onPress={async () => { const ok = await refreshPremium(); if (!ok) setMessage({ tone: 'secondary', text: t.paywall.notYet }); }} />
            </>
          )}
          {compact && state === 'ready' && <T variant="caption" tone="secondary" align="center">{trial ? t.paywall.shortTrial(trial, price) : t.paywall.short(price)}</T>}
          {!compact && legalBlock}
        </>
      }
    >
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: compact ? 0 : 20 }}>
        <IconButton icon="Close" label={t.common.close} onPress={close} />
      </View>
      <Mark />
      <View style={{ gap: 6 }}>
        <T variant="overline" tone="accent">NoExcuse Premium</T>
        <T variant="h1" accessibilityRole="header">{t.paywall.title}</T>
      </View>
      {premium && (
        <View style={{ padding: 14, borderRadius: radius.md, backgroundColor: color.surface.glass }}>
          <T variant="bodyStrong">{t.paywall.active}</T>
        </View>
      )}
      <T variant="caption" tone="tertiary">{t.paywall.freeKeeps(t.paywall.free.join(' · '))}</T>
      <View style={{ gap: 10 }}>
        {t.paywall.benefits.map((b) => (
          <View key={b} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: color.accent.soft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="Check" size={14} tint={color.accent.glow} />
            </View>
            <T style={{ flex: 1 }}>{b}</T>
          </View>
        ))}
      </View>
      <Glass variant="regular" fallback={color.surface.card} border={color.border.accent} style={{ borderRadius: radius.xl, padding: 18, gap: 12, overflow: 'hidden' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ gap: 2 }}>
            <T variant="bodyStrong">{t.paywall.monthly}</T>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
              <T variant="h2">{price}</T>
              <T variant="caption" tone="secondary">{t.paywall.perMonth}</T>
            </View>
          </View>
          {trial ? <Badge tone="accent" label={t.paywall.daysFree(trial)} /> : null}
        </View>
        {trial ? (
          <>
            <Divider />
            {[[t.paywall.today, t.paywall.todayBody], [t.paywall.dayN(trial + 1), t.paywall.dayNBody(price)]].map(([d, body]) => (
              <View key={d} style={{ flexDirection: 'row', gap: 10 }}>
                <T variant="caption" tone="accent" style={{ width: 56 }}>{d}</T>
                <T variant="caption" tone="secondary" style={{ flex: 1 }}>{body}</T>
              </View>
            ))}
          </>
        ) : null}
      </Glass>
      {compact && <View style={{ gap: 10 }}>{legalBlock}</View>}
      {shown && (
        <View style={{ padding: 14, borderRadius: radius.md, backgroundColor: shown.tone === 'danger' ? color.status.dangerSoft : color.surface.glass }} accessibilityLiveRegion="assertive">
          <T variant="bodySmall" tone={shown.tone}>{shown.text}</T>
        </View>
      )}
    </Screen>
  );
}
