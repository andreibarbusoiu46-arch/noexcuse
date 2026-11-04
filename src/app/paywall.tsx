import { router } from 'expo-router';
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
import { buy, loadPlan, paywallAvailable, restore, type Plan } from '@/lib/purchases';
import { useApp } from '@/providers/AppProvider';
import { color, radius } from '@/theme/tokens';

const FREE = ['2 active commitments', 'Live proof + AI verification (Standard)', 'Points, streaks, Discipline Score and the Arena'];
const BENEFITS = ['Unlimited commitments', 'Strict and Elite verification', 'Challenges with bonus points', 'Appeals: a second AI review', 'AI coach and weekly reports', 'Smart reminders and partner invites'];

export default function Paywall() {
  const { refreshPremium, premium } = useApp();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const [plan, setPlan] = useState<Plan | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable' | 'error'>(() => (paywallAvailable() ? 'loading' : 'unavailable'));
  const [busy, setBusy] = useState<'buy' | 'restore' | null>(null);
  const [message, setMessage] = useState<{ tone: 'danger' | 'secondary'; text: string } | null>(null);

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
      setMessage({ tone: 'secondary', text: 'No active subscription found for this Apple ID.' });
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
    else if (!r.cancelled) { haptics.error(); setMessage({ tone: 'danger', text: r.message }); }
    setBusy(null);
  }

  async function onRestore() {
    setBusy('restore'); setMessage(null);
    const r = await restore();
    if (r.ok) await finish(r.premium);
    else { haptics.error(); setMessage({ tone: 'danger', text: r.message }); }
    setBusy(null);
  }

  const { height } = useWindowDimensions();
  const compact = height < 700;
  const price = plan?.priceString ?? '€9.99';
  const trial = plan?.trialDays ?? null;
  const cta = trial ? `Start ${trial}-day free trial` : `Subscribe for ${price}/month`;
  const terms = trial
    ? `${trial} days free, then ${price}/month. Auto-renews monthly until cancelled. Cancel anytime in Settings › Apple ID › Subscriptions at least 24 hours before the trial ends to avoid being charged.`
    : `${price}/month, billed to your Apple ID. Auto-renews monthly until cancelled. Cancel anytime in Settings › Apple ID › Subscriptions at least 24 hours before renewal.`;

  const legalBlock = (
    <>
      {state === 'ready' && <T variant="caption" tone="tertiary" align="center">{terms}</T>}
      <View style={{ flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', columnGap: 18, rowGap: 6 }}>
        <Tap onPress={onRestore} disabled={busy !== null || !paywallAvailable()} accessibilityLabel="Restore purchases">
          <T variant="caption" tone="secondary">{busy === 'restore' ? 'Restoring…' : 'Restore purchases'}</T>
        </Tap>
        <Tap onPress={() => WebBrowser.openBrowserAsync(config.termsUrl)} accessibilityRole="link" accessibilityLabel="Terms of Use"><T variant="caption" tone="secondary">Terms of Use</T></Tap>
        {config.privacyUrl ? <Tap onPress={() => WebBrowser.openBrowserAsync(config.privacyUrl)} accessibilityRole="link" accessibilityLabel="Privacy Policy"><T variant="caption" tone="secondary">Privacy Policy</T></Tap> : null}
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
          {state === 'error' && <Button kind="glass" label="Couldn’t load the plan — retry" icon="Retry" onPress={() => { setState('loading'); setAttempt((n) => n + 1); }} />}
          {state === 'unavailable' && (
            <>
              <T variant="bodySmall" tone="secondary" align="center">{Platform.OS === 'web' ? 'Subscriptions are bought in the iPhone app. On the website, Premium is turned on for test accounts.' : 'Subscriptions aren’t available in this build. Install the TestFlight or App Store version to subscribe.'}</T>
              <Button kind="glass" label="Check again" icon="Retry" onPress={async () => { const ok = await refreshPremium(); if (!ok) setMessage({ tone: 'secondary', text: 'Premium isn’t active on this account yet.' }); }} />
            </>
          )}
          {compact && state === 'ready' && <T variant="caption" tone="secondary" align="center">{trial ? `${trial} days free, then ${price}/month · cancel anytime` : `${price}/month · cancel anytime`}</T>}
          {!compact && legalBlock}
        </>
      }
    >
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginBottom: compact ? 0 : 20 }}>
        <IconButton icon="Close" label="Close" onPress={close} />
      </View>
      <Mark />
      <View style={{ gap: 6 }}>
        <T variant="overline" tone="accent">NoExcuse Premium</T>
        <T variant="h1" accessibilityRole="header">Unlock Your Discipline</T>
      </View>
      {premium && (
        <View style={{ padding: 14, borderRadius: radius.md, backgroundColor: color.surface.glass }}>
          <T variant="bodyStrong">Premium is active on this account.</T>
        </View>
      )}
      <T variant="caption" tone="tertiary">Free keeps: {FREE.join(' · ')}.</T>
      <View style={{ gap: 10 }}>
        {BENEFITS.map((b) => (
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
            <T variant="bodyStrong">Monthly</T>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
              <T variant="h2">{price}</T>
              <T variant="caption" tone="secondary">/ month</T>
            </View>
          </View>
          {trial ? <Badge tone="accent" label={`${trial} days free`} /> : null}
        </View>
        {trial ? (
          <>
            <Divider />
            {[['Today', 'Full access. You pay nothing today.'], [`Day ${trial + 1}`, `${price}/month begins unless you cancel before then.`]].map(([d, t]) => (
              <View key={d} style={{ flexDirection: 'row', gap: 10 }}>
                <T variant="caption" tone="accent" style={{ width: 48 }}>{d}</T>
                <T variant="caption" tone="secondary" style={{ flex: 1 }}>{t}</T>
              </View>
            ))}
          </>
        ) : null}
      </Glass>
      {compact && <View style={{ gap: 10 }}>{legalBlock}</View>}
      {message && (
        <View style={{ padding: 14, borderRadius: radius.md, backgroundColor: message.tone === 'danger' ? color.status.dangerSoft : color.surface.glass }} accessibilityLiveRegion="assertive">
          <T variant="bodySmall" tone={message.tone}>{message.text}</T>
        </View>
      )}
    </Screen>
  );
}
