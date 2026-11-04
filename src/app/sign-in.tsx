import * as AppleAuthentication from 'expo-apple-authentication';
import { lang, t } from '@/i18n';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, useWindowDimensions, View } from 'react-native';
import { Button, IconButton } from '@/components/Button';
import { Field } from '@/components/Field';
import { Emblem3D } from '@/components/emblem/Emblem3D';
import { Screen } from '@/components/Screen';
import { Tap } from '@/components/Tap';
import { T } from '@/components/Text';
import { config } from '@/lib/config';
import { haptics } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import { deviceTimeZone } from '@/lib/time';
import { color, radius } from '@/theme/tokens';

type Step = 'choose' | 'email' | 'code' | 'password';

export default function SignIn() {
  const { height } = useWindowDimensions();
  const [step, setStep] = useState<Step>('choose');
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS === 'ios') AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => {});
  }, []);

  const fail = (m: string) => { haptics.error(); setError(m); };

  async function signInWithApple() {
    setError(null);
    try {
      const rawNonce = Crypto.randomUUID();
      const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
        nonce: hashed,
      });
      if (!cred.identityToken) return fail(t.signin.appleNoToken);
      setBusy(true);
      const { data, error: e } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: cred.identityToken, nonce: rawNonce });
      if (e) return fail(e.message);
      // Apple only shares the name on the very first sign-in.
      const given = [cred.fullName?.givenName, cred.fullName?.familyName?.[0] ? `${cred.fullName.familyName[0]}.` : null].filter(Boolean).join(' ');
      if (given && data.user) await supabase.from('profiles').update({ display_name: given.slice(0, 40) }).eq('id', data.user.id);
      haptics.success();
    } catch (e) {
      if ((e as { code?: string }).code !== 'ERR_REQUEST_CANCELED') fail(t.signin.appleFailed);
    } finally {
      setBusy(false);
    }
  }

  async function sendCode() {
    const addr = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(addr)) return fail(t.signin.invalidEmail);
    setBusy(true); setError(null);
    const { error: e } = await supabase.auth.signInWithOtp({
      email: addr,
      options: {
        shouldCreateUser: true,
        data: { display_name: name.trim() || undefined, timezone: deviceTimeZone(), language: lang() },
        // Web: the email's link signs you in on this site. The app uses the 6-digit code.
        emailRedirectTo: Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : undefined,
      },
    });
    setBusy(false);
    if (e) return fail(e.message);
    haptics.success();
    setStep('code');
  }

  async function verifyCode() {
    if (code.trim().length < 6) return fail(t.signin.enterCode);
    setBusy(true); setError(null);
    const { error: e } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (e) return fail(t.signin.badCode);
    haptics.success();
  }

  async function signInWithPassword() {
    const addr = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(addr)) return fail(t.signin.invalidEmail);
    if (!password) return fail(t.signin.enterPassword);
    setBusy(true); setError(null);
    const { error: e } = await supabase.auth.signInWithPassword({ email: addr, password });
    setBusy(false);
    if (e) return fail(t.signin.wrongPassword);
    haptics.success();
  }

  const legal = (
    <T variant="caption" tone="tertiary" align="center">
      {t.signin.agree}{' '}
      <T variant="caption" tone="secondary" onPress={() => { haptics.light(); WebBrowser.openBrowserAsync(config.termsUrl); }} accessibilityRole="link">{t.signin.terms}</T>
      {config.privacyUrl ? <>{' '}{t.signin.and}{' '}<T variant="caption" tone="secondary" onPress={() => { haptics.light(); WebBrowser.openBrowserAsync(config.privacyUrl); }} accessibilityRole="link">{t.signin.privacy}</T></> : null}.
    </T>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        glow="violet"
        footer={
          step === 'choose' ? (
            <>
              {appleAvailable && (
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                  cornerRadius={28}
                  style={{ height: 56 }}
                  onPress={() => { haptics.medium(); void signInWithApple(); }}
                />
              )}
              <Button kind={appleAvailable ? 'glass' : 'primary'} label={t.signin.withEmail} icon="Doc" onPress={() => { setError(null); setStep('email'); }} loading={busy && !appleAvailable} />
              {legal}
            </>
          ) : step === 'email' ? (
            <>
              <Button label={t.signin.sendCode} onPress={sendCode} loading={busy} />
              <Button kind="ghost" label={t.signin.havePassword} onPress={() => { setError(null); setStep('password'); }} disabled={busy} />
              {legal}
            </>
          ) : step === 'password' ? (
            <>
              <Button label={t.signin.signIn} onPress={signInWithPassword} loading={busy} />
              <Button kind="ghost" label={t.signin.useCode} onPress={() => { setError(null); setStep('email'); }} disabled={busy} />
            </>
          ) : (
            <>
              <Button label={t.signin.verify} onPress={verifyCode} loading={busy} />
              <Button kind="ghost" label={t.signin.newCode} onPress={sendCode} disabled={busy} />
            </>
          )
        }
      >
        <View style={{ flexDirection: 'row' }}>
          <IconButton icon="ChevronLeft" label={t.common.back} onPress={() => (step === 'choose' ? (router.canGoBack() ? router.back() : router.replace('/onboarding')) : setStep(step === 'code' || step === 'password' ? 'email' : 'choose'))} />
        </View>
        {step === 'choose' && (
          <View style={{ alignItems: 'center', gap: 18, marginTop: height < 700 ? 0 : 24 }}>
            <Emblem3D size={height < 700 ? 112 : 168} />
            <T variant="h1" align="center" accessibilityRole="header">{t.signin.createTitle}</T>
            <T tone="secondary" align="center">{t.signin.createBody}</T>
          </View>
        )}
        {step === 'email' && (
          <View style={{ gap: 18 }}>
            <T variant="h1" accessibilityRole="header">{t.signin.emailTitle}</T>
            <T tone="secondary">{t.signin.emailBody}</T>
            <Field label={t.signin.email} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" placeholder="you@example.com" returnKeyType="next" />
            <Field label={t.signin.displayName} value={name} onChangeText={setName} autoComplete="name" textContentType="givenName" placeholder={t.signin.namePlaceholder} maxLength={40} returnKeyType="send" onSubmitEditing={sendCode} />
          </View>
        )}
        {step === 'password' && (
          <View style={{ gap: 18 }}>
            <T variant="h1" accessibilityRole="header">{t.signin.signIn}</T>
            <Field label={t.signin.email} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" placeholder="you@example.com" returnKeyType="next" />
            <Field label={t.signin.password} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="current-password" textContentType="password" placeholder="••••••••" returnKeyType="go" onSubmitEditing={signInWithPassword} />
          </View>
        )}
        {step === 'code' && (
          <View style={{ gap: 18 }}>
            <T variant="h1" accessibilityRole="header">{t.signin.inboxTitle}</T>
            <T tone="secondary">{Platform.OS === 'web' ? t.signin.inboxWeb(email.trim()) : t.signin.inboxApp(email.trim())}</T>
            <Field label={t.signin.code} value={code} onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 8))} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" placeholder="123456" style={{ fontSize: 28, letterSpacing: 8 }} onSubmitEditing={verifyCode} />
          </View>
        )}
        {error && (
          <Tap onPress={() => setError(null)} accessibilityLabel={t.signin.errorA11y(error)} dim={false}>
            <View style={{ padding: 14, borderRadius: radius.md, backgroundColor: color.status.dangerSoft }} accessibilityLiveRegion="assertive">
              <T variant="bodySmall" tone="danger">{error}</T>
            </View>
          </Tap>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}
