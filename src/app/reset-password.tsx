import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { PasswordField } from '@/components/PasswordField';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { t } from '@/i18n';
import { authError, authUrl, isEmail, passwordStrength } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { authParamsFromUrl, supabase } from '@/lib/supabase';
import { useApp } from '@/providers/AppProvider';
import { color, radius } from '@/theme/tokens';

/**
 * The password-reset link lands here. The link signs the user in for this purpose only (Supabase recovery
 * session); they choose a new password, then every other device is signed out.
 */
export default function ResetPassword() {
  const { session } = useApp();
  const params = useMemo(() => authParamsFromUrl(), []);
  const linkFailed = !!(params.error || params.error_code);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  async function save() {
    const s = passwordStrength(pw, session?.user.email ?? '');
    if (!s.ok) return setMsg({ tone: 'danger', text: `${t.auth.err.weak} ${s.problems.join(' · ')}` });
    if (pw !== pw2) return setMsg({ tone: 'danger', text: t.auth.mismatch });
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) { setBusy(false); haptics.error(); return setMsg({ tone: 'danger', text: authError(error) }); }
    await supabase.auth.signOut({ scope: 'others' }).catch(() => null);
    setBusy(false); haptics.success(); setSaved(true); setPw(''); setPw2('');
    setMsg({ tone: 'success', text: t.auth.resetDone });
  }

  async function sendLink() {
    const a = email.trim().toLowerCase();
    if (!isEmail(a)) return setMsg({ tone: 'danger', text: t.auth.err.badEmail });
    setBusy(true); setMsg(null);
    const { error } = await supabase.auth.resetPasswordForEmail(a, { redirectTo: authUrl('/reset-password') });
    setBusy(false);
    setMsg(error && error.status === 429 ? { tone: 'danger', text: authError(error) } : { tone: 'success', text: t.auth.forgotSent(a) });
  }

  const canSet = !!session && !linkFailed && !saved;
  return (
    <Screen glow="violet" footer={
      saved ? <Button label={t.auth.continue} onPress={() => router.replace('/')} />
        : canSet ? <Button label={t.auth.save} onPress={save} loading={busy} />
        : <><Button label={t.auth.sendLink} onPress={sendLink} loading={busy} /><Button kind="ghost" label={t.auth.goSignIn} onPress={() => router.replace('/sign-in')} /></>
    }>
      <View style={{ gap: 16, marginTop: 40 }}>
        <T variant="h1" accessibilityRole="header">{linkFailed ? t.auth.linkExpired : t.auth.resetTitle}</T>
        {canSet ? (
          <>
            <T tone="secondary">{t.auth.resetBody}</T>
            <T variant="caption" tone="tertiary">{session?.user.email}</T>
            <PasswordField label={t.auth.newPw} value={pw} onChangeText={setPw} mode="new" email={session?.user.email ?? ''} returnKeyType="next" />
            <PasswordField label={t.auth.confirm} value={pw2} onChangeText={setPw2} mode="confirm" returnKeyType="go" onSubmitEditing={save} />
          </>
        ) : !saved ? (
          <>
            <T tone="secondary">{linkFailed ? t.auth.linkExpiredBody : t.auth.resetNoSession}</T>
            <Field label={t.signin.email} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="you@example.com" onSubmitEditing={sendLink} />
          </>
        ) : null}
        {msg && (
          <View style={{ padding: 14, borderRadius: radius.md, backgroundColor: msg.tone === 'danger' ? color.status.dangerSoft : color.status.successSoft }} accessibilityLiveRegion="polite">
            <T variant="bodySmall" tone={msg.tone}>{msg.text}</T>
          </View>
        )}
      </View>
    </Screen>
  );
}
