import * as AppleAuthentication from 'expo-apple-authentication';
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
      if (!cred.identityToken) return fail('Apple didn’t return a sign-in token. Try again.');
      setBusy(true);
      const { data, error: e } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: cred.identityToken, nonce: rawNonce });
      if (e) return fail(e.message);
      // Apple only shares the name on the very first sign-in.
      const given = [cred.fullName?.givenName, cred.fullName?.familyName?.[0] ? `${cred.fullName.familyName[0]}.` : null].filter(Boolean).join(' ');
      if (given && data.user) await supabase.from('profiles').update({ display_name: given.slice(0, 40) }).eq('id', data.user.id);
      haptics.success();
    } catch (e) {
      if ((e as { code?: string }).code !== 'ERR_REQUEST_CANCELED') fail('Sign in with Apple failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function sendCode() {
    const addr = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(addr)) return fail('Enter a valid email address.');
    setBusy(true); setError(null);
    const { error: e } = await supabase.auth.signInWithOtp({
      email: addr,
      options: {
        shouldCreateUser: true,
        data: { display_name: name.trim() || undefined, timezone: deviceTimeZone() },
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
    if (code.trim().length < 6) return fail('Enter the code from the email.');
    setBusy(true); setError(null);
    const { error: e } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (e) return fail('That code didn’t work. Check it or request a new one.');
    haptics.success();
  }

  async function signInWithPassword() {
    const addr = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(addr)) return fail('Enter a valid email address.');
    if (!password) return fail('Enter your password.');
    setBusy(true); setError(null);
    const { error: e } = await supabase.auth.signInWithPassword({ email: addr, password });
    setBusy(false);
    if (e) return fail('Email or password is wrong.');
    haptics.success();
  }

  const legal = (
    <T variant="caption" tone="tertiary" align="center">
      By continuing you agree to the{' '}
      <T variant="caption" tone="secondary" onPress={() => { haptics.light(); WebBrowser.openBrowserAsync(config.termsUrl); }} accessibilityRole="link">Terms of Use</T>
      {config.privacyUrl ? <>{' '}and{' '}<T variant="caption" tone="secondary" onPress={() => { haptics.light(); WebBrowser.openBrowserAsync(config.privacyUrl); }} accessibilityRole="link">Privacy Policy</T></> : null}.
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
              <Button kind={appleAvailable ? 'glass' : 'primary'} label="Continue with email" icon="Doc" onPress={() => { setError(null); setStep('email'); }} loading={busy && !appleAvailable} />
              {legal}
            </>
          ) : step === 'email' ? (
            <>
              <Button label="Send code" onPress={sendCode} loading={busy} />
              <Button kind="ghost" label="I have a password" onPress={() => { setError(null); setStep('password'); }} disabled={busy} />
              {legal}
            </>
          ) : step === 'password' ? (
            <>
              <Button label="Sign in" onPress={signInWithPassword} loading={busy} />
              <Button kind="ghost" label="Use an email code instead" onPress={() => { setError(null); setStep('email'); }} disabled={busy} />
            </>
          ) : (
            <>
              <Button label="Verify and continue" onPress={verifyCode} loading={busy} />
              <Button kind="ghost" label="Send a new code" onPress={sendCode} disabled={busy} />
            </>
          )
        }
      >
        <View style={{ flexDirection: 'row' }}>
          <IconButton icon="ChevronLeft" label="Back" onPress={() => (step === 'choose' ? (router.canGoBack() ? router.back() : router.replace('/onboarding')) : setStep(step === 'code' || step === 'password' ? 'email' : 'choose'))} />
        </View>
        {step === 'choose' && (
          <View style={{ alignItems: 'center', gap: 18, marginTop: height < 700 ? 0 : 24 }}>
            <Emblem3D size={height < 700 ? 112 : 168} />
            <T variant="h1" align="center" accessibilityRole="header">Create your account</T>
            <T tone="secondary" align="center">Your streak, points and Arena rank live on your account — not on your phone. Switch devices, keep your record.</T>
          </View>
        )}
        {step === 'email' && (
          <View style={{ gap: 18 }}>
            <T variant="h1" accessibilityRole="header">Continue with email</T>
            <T tone="secondary">We’ll send a 6-digit code. No password to remember.</T>
            <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" placeholder="you@example.com" returnKeyType="next" />
            <Field label="Display name (shown in the Arena)" value={name} onChangeText={setName} autoComplete="name" textContentType="givenName" placeholder="e.g. Andrei B." maxLength={40} returnKeyType="send" onSubmitEditing={sendCode} />
          </View>
        )}
        {step === 'password' && (
          <View style={{ gap: 18 }}>
            <T variant="h1" accessibilityRole="header">Sign in</T>
            <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" placeholder="you@example.com" returnKeyType="next" />
            <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="current-password" textContentType="password" placeholder="••••••••" returnKeyType="go" onSubmitEditing={signInWithPassword} />
          </View>
        )}
        {step === 'code' && (
          <View style={{ gap: 18 }}>
            <T variant="h1" accessibilityRole="header">Check your inbox</T>
            <T tone="secondary">{Platform.OS === 'web' ? `Open the link we sent to ${email.trim()} in this browser — you’ll be signed in here. If the email shows a 6-digit code, enter it below.` : `Enter the code we sent to ${email.trim()}.`}</T>
            <Field label="Code" value={code} onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 8))} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" placeholder="123456" style={{ fontSize: 28, letterSpacing: 8 }} onSubmitEditing={verifyCode} />
          </View>
        )}
        {error && (
          <Tap onPress={() => setError(null)} accessibilityLabel={`Error: ${error}. Tap to dismiss.`} dim={false}>
            <View style={{ padding: 14, borderRadius: radius.md, backgroundColor: color.status.dangerSoft }} accessibilityLiveRegion="assertive">
              <T variant="bodySmall" tone="danger">{error}</T>
            </View>
          </Tap>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}
