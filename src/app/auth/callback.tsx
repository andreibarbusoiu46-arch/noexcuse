import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { t } from '@/i18n';
import { authError, authUrl, isEmail } from '@/lib/auth';
import { authParamsFromUrl, supabase } from '@/lib/supabase';
import { useApp } from '@/providers/AppProvider';
import { color, radius } from '@/theme/tokens';

/**
 * Where e-mail links (confirm sign-up, confirm a new e-mail, magic link) and Google sign-in land on the web.
 * The Supabase client reads the session from the URL on load; this page reports the outcome, and handles
 * expired or already-used links with a "send a new link" form.
 */
export default function AuthCallback() {
  const { session, ready } = useApp();
  const params = useMemo(() => authParamsFromUrl(), []);
  const failed = !!(params.error || params.error_code);
  const [waited, setWaited] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  useEffect(() => { const id = setTimeout(() => setWaited(true), 6000); return () => clearTimeout(id); }, []);
  // A recovery link that arrives here still goes to the password form.
  useEffect(() => { if (session && params.type === 'recovery') router.replace('/reset-password'); }, [session, params.type]);

  async function resend() {
    const a = email.trim().toLowerCase();
    if (!isEmail(a)) return setMsg({ tone: 'danger', text: t.auth.err.badEmail });
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.resend({ type: 'signup', email: a, options: { emailRedirectTo: authUrl('/auth/callback') } });
    setBusy(false);
    setMsg(error && error.status === 429 ? { tone: 'danger', text: authError(error) } : { tone: 'success', text: t.auth.sentNew });
  }

  const done = !failed && session;
  return (
    <Screen glow="violet" footer={
      done ? <Button label={t.auth.continue} onPress={() => router.replace('/')} />
        : failed ? <><Button label={t.auth.sendNew} onPress={resend} loading={busy} /><Button kind="ghost" label={t.auth.goSignIn} onPress={() => router.replace('/sign-in')} /></>
        : waited && ready ? <Button label={t.auth.goSignIn} onPress={() => router.replace('/sign-in')} /> : null
    }>
      <View style={{ gap: 16, marginTop: 40 }}>
        {failed ? (
          <>
            <T variant="h1" accessibilityRole="header">{t.auth.linkExpired}</T>
            <T tone="secondary">{t.auth.linkExpiredBody}</T>
            <Field label={t.signin.email} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="you@example.com" onSubmitEditing={resend} />
          </>
        ) : done ? (
          <>
            <T variant="h1" accessibilityRole="header">{params.type === 'email_change' ? t.auth.emailChanged : t.auth.verified}</T>
            <T tone="secondary">{session?.user.email}</T>
          </>
        ) : waited && ready ? (
          <>
            <T variant="h1" accessibilityRole="header">{t.auth.linkExpired}</T>
            <T tone="secondary">{t.auth.goSignIn}</T>
          </>
        ) : (
          <View style={{ alignItems: 'center', gap: 12, marginTop: 40 }} accessibilityLiveRegion="polite">
            <ActivityIndicator color={color.text.secondary} />
            <T tone="secondary">{t.auth.verifying}</T>
          </View>
        )}
        {msg && (
          <View style={{ padding: 14, borderRadius: radius.md, backgroundColor: msg.tone === 'danger' ? color.status.dangerSoft : color.status.successSoft }} accessibilityLiveRegion="polite">
            <T variant="bodySmall" tone={msg.tone}>{msg.text}</T>
          </View>
        )}
      </View>
    </Screen>
  );
}
