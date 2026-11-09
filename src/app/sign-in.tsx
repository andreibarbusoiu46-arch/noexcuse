import * as AppleAuthentication from 'expo-apple-authentication';
import { lang, t } from '@/i18n';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, useWindowDimensions, View } from 'react-native';
import { ToggleRow } from '@/components/Blocks';
import { Button, IconButton } from '@/components/Button';
import { Field } from '@/components/Field';
import { Emblem3D } from '@/components/emblem/Emblem3D';
import { PasswordField } from '@/components/PasswordField';
import { Screen } from '@/components/Screen';
import { Tap } from '@/components/Tap';
import { T } from '@/components/Text';
import { authError, authProviders, authUrl, isEmail, passwordStrength, remembering, setRemember } from '@/lib/auth';
import { config } from '@/lib/config';
import { haptics } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import { deviceTimeZone } from '@/lib/time';
import { color, radius } from '@/theme/tokens';

type Step = 'choose' | 'signup' | 'sent' | 'signin' | 'forgot' | 'forgotSent' | 'email' | 'code';
const BACK: Record<Step, Step | null> = { choose: null, signup: 'choose', sent: 'signup', signin: 'choose', forgot: 'signin', forgotSent: 'signin', email: 'signin', code: 'email' };

/** Re-send cool-down, so the inbox (and Supabase's e-mail limit) isn't flooded. */
function useCooldown() {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= now) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [until, now]);
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  return { left, start: () => { const n = Date.now(); setNow(n); setUntil(n + 60_000); } };
}

export default function SignIn() {
  const { height } = useWindowDimensions();
  const [step, setStep] = useState<Step>('choose');
  const [providers, setProviders] = useState({ google: false, apple: false });
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [remember, setRem] = useState(remembering());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const cool = useCooldown();

  useEffect(() => {
    authProviders().then((p) => setProviders({ google: p.google, apple: p.apple }));
    if (Platform.OS === 'ios') AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => {});
  }, []);

  const go = (s: Step) => { setError(null); setNote(null); setNeedsConfirm(false); setStep(s); };
  const fail = (m: string) => { haptics.error(); setError(m); };
  const addr = () => email.trim().toLowerCase();

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
      if (e) return fail(authError(e));
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

  // Google (web): the browser goes to Google and comes back to /auth/callback signed in.
  async function signInWithGoogle() {
    setBusy(true); setError(null);
    setRemember(remember);
    const { error: e } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: authUrl('/auth/callback') } });
    if (e) { setBusy(false); fail(authError(e)); }
  }

  async function signUp() {
    if (!name.trim()) return fail(t.auth.nameNeeded);
    if (!isEmail(addr())) return fail(t.auth.err.badEmail);
    const s = passwordStrength(password, addr());
    if (!s.ok) return fail(`${t.auth.err.weak} ${s.problems.join(' · ')}`);
    if (password !== confirm) return fail(t.auth.mismatch);
    setBusy(true); setError(null);
    const { data, error: e } = await supabase.auth.signUp({
      email: addr(), password,
      options: { emailRedirectTo: authUrl('/auth/callback'), data: { display_name: name.trim().slice(0, 40), timezone: deviceTimeZone(), language: lang(), has_password: true } },
    });
    setBusy(false);
    if (e) return fail(authError(e));
    haptics.success();
    // Confirmation off on the server → signed in already. Otherwise (and for an e-mail that already has an
    // account, which Supabase answers the same way on purpose) show "check your inbox".
    if (data.session) return;
    setPassword(''); setConfirm('');
    cool.start();
    go('sent');
  }

  async function resendConfirmation() {
    if (cool.left > 0 || !isEmail(addr())) return;
    setBusy(true); setError(null);
    const { error: e } = await supabase.auth.resend({ type: 'signup', email: addr(), options: { emailRedirectTo: authUrl('/auth/callback') } });
    setBusy(false);
    if (e) return fail(authError(e));
    cool.start(); setNote(t.auth.resent);
  }

  async function signInWithPassword() {
    if (!isEmail(addr())) return fail(t.auth.err.badEmail);
    if (!password) return fail(t.signin.enterPassword);
    setBusy(true); setError(null); setNeedsConfirm(false);
    setRemember(remember);
    const { error: e } = await supabase.auth.signInWithPassword({ email: addr(), password });
    setBusy(false);
    if (e) {
      if (e.code === 'email_not_confirmed' || /not confirmed/i.test(e.message)) setNeedsConfirm(true);
      return fail(authError(e));
    }
    haptics.success();
  }

  async function sendReset() {
    if (!isEmail(addr())) return fail(t.auth.err.badEmail);
    setBusy(true); setError(null);
    const { error: e } = await supabase.auth.resetPasswordForEmail(addr(), { redirectTo: authUrl('/reset-password') });
    setBusy(false);
    // Same answer whether or not the account exists; only real problems (limits, bad address) are shown.
    if (e && (e.status === 429 || e.code === 'email_address_invalid' || e.code === 'over_email_send_rate_limit')) return fail(authError(e));
    cool.start();
    go('forgotSent');
  }

  async function sendCode() {
    if (!isEmail(addr())) return fail(t.auth.err.badEmail);
    setBusy(true); setError(null);
    setRemember(remember);
    const { error: e } = await supabase.auth.signInWithOtp({
      email: addr(),
      options: {
        shouldCreateUser: false, // codes sign existing accounts in; new accounts go through sign-up + verification
        emailRedirectTo: authUrl('/auth/callback'),
      },
    });
    setBusy(false);
    if (e && !/signups not allowed|user not found/i.test(e.message)) return fail(authError(e));
    haptics.success();
    cool.start();
    go('code');
  }

  async function verifyCode() {
    if (code.trim().length < 6) return fail(t.signin.enterCode);
    setBusy(true); setError(null);
    const { error: e } = await supabase.auth.verifyOtp({ email: addr(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (e) return fail(e.code === 'otp_expired' ? t.auth.err.expired : t.signin.badCode);
    haptics.success();
  }

  const open = (u: string) => { haptics.light(); void WebBrowser.openBrowserAsync(u); };
  const legal = (
    <T variant="caption" tone="tertiary" align="center">
      {t.signin.agree}{' '}
      <T variant="caption" tone="secondary" onPress={() => open(config.termsUrl)} accessibilityRole="link">{t.signin.terms}</T>
      {config.privacyUrl ? <>{' '}{t.signin.and}{' '}<T variant="caption" tone="secondary" onPress={() => open(config.privacyUrl)} accessibilityRole="link">{t.signin.privacy}</T></> : null}.
    </T>
  );
  const rememberRow = Platform.OS === 'web' ? <ToggleRow title={t.auth.remember} value={remember} onChange={setRem} /> : null;

  let footer: React.ReactNode;
  if (step === 'choose') {
    footer = (
      <>
        {appleAvailable && providers.apple && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
            cornerRadius={28} style={{ height: 56 }}
            onPress={() => { haptics.medium(); void signInWithApple(); }}
          />
        )}
        {providers.google && Platform.OS === 'web' && <Button kind="glass" label={t.auth.google} icon="Globe" onPress={signInWithGoogle} loading={busy} />}
        <Button label={t.auth.signUpEmail} onPress={() => go('signup')} disabled={busy} />
        <Button kind="ghost" label={t.auth.haveAccount} onPress={() => go('signin')} disabled={busy} />
        {legal}
      </>
    );
  } else if (step === 'signup') {
    footer = (<><Button label={t.auth.create} onPress={signUp} loading={busy} /><Button kind="ghost" label={t.auth.haveAccount} onPress={() => go('signin')} disabled={busy} />{legal}</>);
  } else if (step === 'sent') {
    footer = (
      <>
        <Button kind="glass" label={cool.left ? t.auth.resendIn(cool.left) : t.auth.resend} onPress={resendConfirmation} loading={busy} disabled={cool.left > 0} />
        <Button label={t.auth.goSignIn} onPress={() => go('signin')} disabled={busy} />
        <Button kind="ghost" label={t.auth.otherEmail} onPress={() => go('signup')} disabled={busy} />
      </>
    );
  } else if (step === 'signin') {
    footer = (
      <>
        <Button label={t.signin.signIn} onPress={signInWithPassword} loading={busy} />
        {needsConfirm && <Button kind="glass" label={cool.left ? t.auth.resendIn(cool.left) : t.auth.resendConfirm} onPress={resendConfirmation} disabled={busy || cool.left > 0} />}
        <Button kind="ghost" label={t.auth.codeInstead} onPress={() => go('email')} disabled={busy} />
      </>
    );
  } else if (step === 'forgot') {
    footer = (<><Button label={t.auth.sendLink} onPress={sendReset} loading={busy} /><Button kind="ghost" label={t.auth.backToSignIn} onPress={() => go('signin')} disabled={busy} /></>);
  } else if (step === 'forgotSent') {
    footer = (<><Button kind="glass" label={cool.left ? t.auth.resendIn(cool.left) : t.auth.sendLink} onPress={sendReset} loading={busy} disabled={cool.left > 0} /><Button label={t.auth.backToSignIn} onPress={() => go('signin')} /></>);
  } else if (step === 'email') {
    footer = (<><Button label={t.signin.sendCode} onPress={sendCode} loading={busy} /><Button kind="ghost" label={t.auth.backToSignIn} onPress={() => go('signin')} disabled={busy} /></>);
  } else {
    footer = (<><Button label={t.signin.verify} onPress={verifyCode} loading={busy} /><Button kind="ghost" label={cool.left ? t.auth.resendIn(cool.left) : t.signin.newCode} onPress={sendCode} disabled={busy || cool.left > 0} /></>);
  }

  const back = BACK[step];
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen glow="violet" footer={footer}>
        <View style={{ flexDirection: 'row' }}>
          <IconButton icon="ChevronLeft" label={t.common.back} onPress={() => (back ? go(back) : router.canGoBack() ? router.back() : router.replace('/onboarding'))} />
        </View>
        {step === 'choose' && (
          <View style={{ alignItems: 'center', gap: 18, marginTop: height < 700 ? 0 : 24 }}>
            <Emblem3D size={height < 700 ? 112 : 168} />
            <T variant="h1" align="center" accessibilityRole="header">{t.signin.createTitle}</T>
            <T tone="secondary" align="center">{t.signin.createBody}</T>
          </View>
        )}
        {step === 'signup' && (
          <View style={{ gap: 16 }}>
            <T variant="h1" accessibilityRole="header">{t.auth.signUpTitle}</T>
            <T tone="secondary">{t.auth.signUpBody}</T>
            <Field label={t.auth.name} value={name} onChangeText={setName} autoComplete="name" textContentType="name" placeholder={t.auth.namePh} maxLength={40} returnKeyType="next" />
            <Field label={t.signin.email} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" placeholder="you@example.com" returnKeyType="next" />
            <PasswordField label={t.signin.password} value={password} onChangeText={setPassword} mode="new" email={email} returnKeyType="next" />
            <PasswordField label={t.auth.confirm} value={confirm} onChangeText={setConfirm} mode="confirm" returnKeyType="go" onSubmitEditing={signUp} />
            {confirm.length > 0 && confirm !== password ? <T variant="caption" tone="warning">{t.auth.mismatch}</T> : null}
          </View>
        )}
        {step === 'sent' && (
          <View style={{ gap: 16 }}>
            <T variant="h1" accessibilityRole="header">{t.auth.sentTitle}</T>
            <T tone="secondary">{t.auth.sentBody(addr())}</T>
          </View>
        )}
        {step === 'signin' && (
          <View style={{ gap: 16 }}>
            <T variant="h1" accessibilityRole="header">{t.auth.signInTitle}</T>
            <T tone="secondary">{t.auth.signInBody}</T>
            <Field label={t.signin.email} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" placeholder="you@example.com" returnKeyType="next" />
            <PasswordField label={t.signin.password} value={password} onChangeText={setPassword} mode="current" returnKeyType="go" onSubmitEditing={signInWithPassword} />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <Tap onPress={() => go('forgot')} accessibilityRole="link" accessibilityLabel={t.auth.forgot} style={{ paddingVertical: 8 }}>
                <T variant="bodySmall" tone="secondary">{t.auth.forgot}</T>
              </Tap>
            </View>
            {rememberRow}
          </View>
        )}
        {(step === 'forgot' || step === 'forgotSent') && (
          <View style={{ gap: 16 }}>
            <T variant="h1" accessibilityRole="header">{t.auth.forgotTitle}</T>
            <T tone="secondary">{step === 'forgot' ? t.auth.forgotBody : t.auth.forgotSent(addr())}</T>
            {step === 'forgot' && <Field label={t.signin.email} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" placeholder="you@example.com" returnKeyType="send" onSubmitEditing={sendReset} />}
          </View>
        )}
        {step === 'email' && (
          <View style={{ gap: 16 }}>
            <T variant="h1" accessibilityRole="header">{t.signin.emailTitle}</T>
            <T tone="secondary">{t.signin.emailBody}</T>
            <Field label={t.signin.email} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" placeholder="you@example.com" returnKeyType="send" onSubmitEditing={sendCode} />
            {rememberRow}
          </View>
        )}
        {step === 'code' && (
          <View style={{ gap: 16 }}>
            <T variant="h1" accessibilityRole="header">{t.signin.inboxTitle}</T>
            <T tone="secondary">{t.signin.inboxApp(addr())}</T>
            <Field label={t.signin.code} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 8))} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" placeholder="123456" style={{ fontSize: 28, letterSpacing: 8 }} onSubmitEditing={verifyCode} />
          </View>
        )}
        {note && (
          <View style={{ padding: 14, borderRadius: radius.md, backgroundColor: color.status.successSoft }} accessibilityLiveRegion="polite">
            <T variant="bodySmall" tone="success">{note}</T>
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
