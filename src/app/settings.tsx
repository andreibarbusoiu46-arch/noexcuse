// Settings: account, preferences (language, appearance, notifications), privacy & security, subscription.
import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { BackHeader } from '@/components/BackHeader';
import { SectionHeader, Segmented, ToggleRow } from '@/components/Blocks';
import { Button } from '@/components/Button';
import { Card, Divider } from '@/components/Card';
import { Field } from '@/components/Field';
import { Icon, type IconName } from '@/components/Icon';
import { PhotoEditor } from '@/components/PhotoEditor';
import { Screen } from '@/components/Screen';
import { Tap } from '@/components/Tap';
import { T } from '@/components/Text';
import { api, type NotifyPrefs } from '@/data';
import { LANGS, locale, t } from '@/i18n';
import { config } from '@/lib/config';
import { confirmDestructive, notify } from '@/lib/dialog';
import { errorText } from '@/lib/errors';
import { haptics } from '@/lib/haptics';
import { useLoad } from '@/lib/hooks';
import { manageSubscription, purchasesAvailable, restore } from '@/lib/purchases';
import { disablePush, enablePush, pushPermissionGranted } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import { deviceTimeZone } from '@/lib/time';
import { useApp } from '@/providers/AppProvider';
import { usePrefs, type ThemePref } from '@/providers/PrefsProvider';
import { color } from '@/theme/tokens';

function SettingsRow({ icon, label, value, onPress, danger, chevron = true }: { icon: IconName; label: string; value?: string; onPress: () => void; danger?: boolean; chevron?: boolean }) {
  return (
    <Tap onPress={onPress} accessibilityLabel={value ? `${label}, ${value}` : label}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 }}>
        <Icon name={icon} size={20} tint={danger ? color.status.danger : color.icon.secondary} />
        <T tone={danger ? 'danger' : 'primary'} style={{ flex: 1 }}>{label}</T>
        {value ? <T variant="caption" tone="tertiary" numberOfLines={1} style={{ maxWidth: 170 }}>{value}</T> : null}
        {chevron && !danger && <Icon name="ChevronRight" size={16} tint={color.icon.secondary} />}
      </View>
    </Tap>
  );
}

async function saveJson(name: string, data: unknown) {
  const text = JSON.stringify(data, null, 2);
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const { File, Paths } = await import('expo-file-system');
  const f = new File(Paths.cache, name);
  if (f.exists) f.delete();
  f.create();
  f.write(text);
  await Sharing.shareAsync(f.uri, { mimeType: 'application/json', dialogTitle: name });
}

export default function Settings() {
  const { profile, session, premium, refreshProfile, refreshPremium, signOut } = useApp();
  const prefs = usePrefs();
  const ent = useLoad(() => api.getEntitlement());
  const admin = useLoad(() => api.isAdmin().catch(() => false));
  const [push, setPush] = useState<boolean | null>(null);
  const [name, setName] = useState(profile?.display_name ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [pw, setPw] = useState({ open: false, a: '', b: '' });
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { pushPermissionGranted().then(setPush).catch(() => setPush(false)); }, []);

  const email = session?.user.email ?? '';
  const tz = profile?.timezone;
  const run = async (key: string, f: () => Promise<void>) => {
    setBusy(key);
    try { await f(); } catch (e) { haptics.error(); notify(t.settings.failed, errorText(e)); } finally { setBusy(null); }
  };

  const saveName = () => run('name', async () => {
    const n = name.trim().slice(0, 40);
    if (!n || n === profile?.display_name) return;
    await api.updateProfile({ display_name: n });
    haptics.success();
    await refreshProfile();
  });

  const usernameProblem = username && !/^[a-z0-9_]{3,20}$/.test(username) ? t.domain.errors.usernameFormat : null;
  const saveUsername = () => run('username', async () => {
    const u = username.trim().toLowerCase();
    if ((u || null) === (profile?.username ?? null) || (u && !/^[a-z0-9_]{3,20}$/.test(u))) return;
    await api.updateProfile({ username: u || null });
    haptics.success();
    await refreshProfile();
  });
  const setPublic = (key: 'arena_visible' | 'show_streak' | 'show_challenge', v: boolean) => run(key, async () => {
    await api.updateProfile({ [key]: v });
    haptics.selection();
    await refreshProfile();
  });

  const pwProblem = pw.a.length < 8 ? t.settings.pwShort : pw.a !== pw.b ? t.settings.pwMismatch : null;
  const savePassword = () => run('pw', async () => {
    const { error } = await supabase.auth.updateUser({ password: pw.a });
    if (error) throw new Error(error.message);
    haptics.success();
    setPw({ open: false, a: '', b: '' });
    notify(t.settings.pwDone, t.settings.pwDoneBody);
  });

  const signOutAll = () => run('all', async () => {
    const ok = await confirmDestructive(t.settings.signOutAllTitle, t.settings.signOutAllBody, t.settings.signOutAll);
    if (!ok) return;
    if (!config.demo) await supabase.auth.signOut({ scope: 'global' });
    await signOut();
  });

  async function togglePush() {
    setBusy('push');
    if (push) { await disablePush().catch(() => {}); setPush(false); }
    else {
      const r = await enablePush().catch(() => 'unavailable' as const);
      setPush(r === 'enabled');
      if (r === 'denied') notify(t.settings.pushOffTitle, t.settings.pushOffBody);
      if (r === 'unavailable') notify(t.settings.pushUnavailableTitle, t.settings.pushUnavailableBody);
    }
    setBusy(null);
  }

  const setPref = (k: keyof NotifyPrefs, on: boolean) => run(`n-${k}`, async () => {
    if (!profile) return;
    await api.updateProfile({ notify_prefs: { ...profile.notify_prefs, [k]: on } });
    haptics.selection();
    await refreshProfile();
  });

  const setRetention = (v: 'keep' | '30d') => run('ret', async () => {
    await api.updateProfile({ evidence_retention: v });
    haptics.selection();
    await refreshProfile();
  });

  const deleteEvidence = () => run('ev', async () => {
    const ok = await confirmDestructive(t.settings.delEvidenceTitle, t.settings.delEvidenceBody, t.settings.delete);
    if (!ok) return;
    const n = await api.deleteEvidence();
    haptics.success();
    notify(t.settings.delEvidenceDone, t.settings.delEvidenceDoneBody(n));
  });

  const exportData = () => run('export', async () => {
    const data = await api.exportMyData();
    await saveJson(`noexcuse-${new Date().toISOString().slice(0, 10)}.json`, data);
  });

  const deleteAccount = () => run('del', async () => {
    const ok = await confirmDestructive(t.settings.delAccountTitle, t.settings.delAccountBody, t.settings.delete);
    if (!ok) return;
    haptics.heavy();
    await api.deleteAccount();
  });

  const onRestore = () => run('restore', async () => {
    const r = await restore();
    if (r.ok) await api.refreshEntitlement().catch(() => null);
    await refreshPremium();
    void ent.reload({ silent: true });
    notify(r.ok && r.premium ? t.settings.restored : t.settings.nothingToRestore, r.ok ? (r.premium ? t.settings.restoredBody : t.settings.nothingToRestoreBody) : r.message || t.settings.restoreFailed);
  });

  const e = ent.data;
  const plan = !premium ? t.settings.free : e?.period_type === 'trial' ? t.settings.trial : t.settings.premium;
  const until = e?.expires_at ? new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(e.expires_at)) : null;

  return (
    <Screen>
      <BackHeader overline={email || undefined} title={t.settings.title} />

      {/* Account */}
      <View style={{ gap: 12 }}>
        <SectionHeader title={t.settings.account} />
        <Card style={{ gap: 14 }}>
          <Field label={t.settings.name} value={name} onChangeText={setName} maxLength={40} returnKeyType="done" onSubmitEditing={saveName} onBlur={saveName} />
          <View style={{ gap: 2 }}>
            <T variant="overline" tone="tertiary">{t.settings.email}</T>
            <T selectable>{email || '—'}</T>
          </View>
          <T variant="caption" tone="tertiary">{t.settings.nameNote}</T>
        </Card>
        <Card padding={0} style={{ gap: 0 }}>
          <SettingsRow icon="Lock" label={t.settings.password} value={pw.open ? '' : t.settings.change} onPress={() => setPw((x) => ({ ...x, open: !x.open }))} />
          {pw.open && (
            <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 10 }}>
              <T variant="caption" tone="tertiary">{t.settings.pwNote}</T>
              <Field label={t.settings.newPassword} value={pw.a} onChangeText={(a) => setPw((x) => ({ ...x, a }))} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
              <Field label={t.settings.repeatPassword} value={pw.b} onChangeText={(b) => setPw((x) => ({ ...x, b }))} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
              {!!pw.a && pwProblem && <T variant="caption" tone="danger">{pwProblem}</T>}
              <Button label={t.settings.savePassword} loading={busy === 'pw'} disabled={!!pwProblem || config.demo} onPress={savePassword} />
            </View>
          )}
          <Divider />
          <SettingsRow icon="Globe" label={t.settings.timezone} value={tz === deviceTimeZone() ? tz : t.settings.useTz(deviceTimeZone())}
            chevron={tz !== deviceTimeZone()} onPress={() => run('tz', async () => { if (tz === deviceTimeZone()) return; await api.updateProfile({ timezone: deviceTimeZone() }); haptics.success(); await refreshProfile(); })} />
        </Card>
      </View>

      {/* Public profile */}
      <View style={{ gap: 12 }}>
        <SectionHeader title={t.settings.publicProfile} />
        <PhotoEditor name={profile?.display_name ?? '?'} path={profile?.avatar_path} onChanged={refreshProfile} />
        <Card style={{ gap: 10 }}>
          <Field label={t.settings.username} value={username} onChangeText={(x) => setUsername(x.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
            placeholder={t.settings.usernamePlaceholder} autoCapitalize="none" autoCorrect={false} maxLength={20} returnKeyType="done"
            onSubmitEditing={saveUsername} onBlur={saveUsername} />
          <T variant="caption" tone={usernameProblem ? 'danger' : 'tertiary'}>{usernameProblem ?? t.settings.usernameNote}</T>
        </Card>
        <Card style={{ gap: 4 }}>
          <ToggleRow title={t.settings.arenaVisible} subtitle={t.settings.arenaVisibleSub} value={profile?.arena_visible ?? true}
            disabled={busy === 'arena_visible'} onChange={(v) => setPublic('arena_visible', v)} />
          <ToggleRow title={t.settings.showStreak} subtitle={t.settings.showStreakSub} value={profile?.show_streak ?? true}
            disabled={busy === 'show_streak'} onChange={(v) => setPublic('show_streak', v)} />
          <ToggleRow title={t.settings.showChallenge} subtitle={t.settings.showChallengeSub} value={profile?.show_challenge ?? true}
            disabled={busy === 'show_challenge'} onChange={(v) => setPublic('show_challenge', v)} />
        </Card>
        <T variant="caption" tone="tertiary">{t.settings.publicNote}</T>
      </View>

      {/* Preferences */}
      <View style={{ gap: 12 }}>
        <SectionHeader title={t.settings.preferences} />
        <Card style={{ gap: 12 }}>
          <T variant="overline" tone="tertiary">{t.settings.language}</T>
          <View style={{ gap: 8 }}>
            {LANGS.map((l) => {
              const on = prefs.lang === l.id;
              return (
                <Tap key={l.id} haptic="selection" onPress={() => void prefs.setLanguage(l.id)} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={l.native}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, backgroundColor: on ? color.surface.glassStrong : color.surface.glass, borderWidth: 1, borderColor: on ? color.border.strong : color.border.hairline }}>
                  <View style={{ width: 34, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.border.strong }}>
                    <T variant="tab" tone="secondary">{l.mark}</T>
                  </View>
                  <View style={{ flex: 1 }}>
                    <T variant="bodyStrong">{l.native}</T>
                    {l.native !== l.english && <T variant="caption" tone="tertiary">{l.english}</T>}
                  </View>
                  {on && <Icon name="Check" size={18} />}
                </Tap>
              );
            })}
          </View>
          <T variant="caption" tone="tertiary">{t.settings.languageNote}</T>
        </Card>
        <Card style={{ gap: 12 }}>
          <T variant="overline" tone="tertiary">{t.settings.appearance}</T>
          <Segmented<ThemePref> value={prefs.theme} onChange={(v) => void prefs.setTheme(v)}
            options={[{ key: 'dark', label: t.settings.dark }, { key: 'light', label: t.settings.light }, { key: 'system', label: t.settings.system }]} />
          <T variant="caption" tone="tertiary">{prefs.theme === 'system' ? t.settings.systemNote(prefs.scheme === 'dark' ? t.settings.dark : t.settings.light) : t.settings.appearanceNote}</T>
        </Card>
        <Card padding={0} style={{ gap: 0 }}>
          <SettingsRow icon="Bell" label={t.settings.notifications} value={push === null ? '' : busy === 'push' ? '…' : push ? t.settings.on : t.settings.off} onPress={togglePush} />
          {push && profile && (
            <View style={{ paddingHorizontal: 0, paddingBottom: 8 }}>
              <Divider />
              <View style={{ paddingHorizontal: 18, paddingTop: 4 }}>
                <ToggleRow title={t.settings.nReminders} subtitle={t.settings.nRemindersSub} value={profile.notify_prefs.reminders} onChange={(v) => setPref('reminders', v)} />
                <ToggleRow title={t.settings.nHeadsUp} subtitle={premium ? t.settings.nHeadsUpSub : t.common.premium} value={premium && profile.notify_prefs.heads_up} disabled={!premium} onChange={(v) => setPref('heads_up', v)} />
                <ToggleRow title={t.settings.nLastCall} subtitle={premium ? t.settings.nLastCallSub : t.common.premium} value={premium && profile.notify_prefs.last_call} disabled={!premium} onChange={(v) => setPref('last_call', v)} />
                <ToggleRow title={t.settings.nWeekly} subtitle={t.settings.nWeeklySub} value={profile.notify_prefs.weekly_report} onChange={(v) => setPref('weekly_report', v)} />
                <ToggleRow title={t.settings.nPartners} subtitle={t.settings.nPartnersSub} value={profile.notify_prefs.partners} onChange={(v) => setPref('partners', v)} />
              </View>
            </View>
          )}
        </Card>
      </View>

      {/* Privacy & security */}
      <View style={{ gap: 12 }}>
        <SectionHeader title={t.settings.privacy} />
        <Card style={{ gap: 12 }}>
          <T variant="overline" tone="tertiary">{t.settings.evidence}</T>
          <Segmented<'keep' | '30d'> value={profile?.evidence_retention ?? 'keep'} onChange={setRetention}
            options={[{ key: 'keep', label: t.settings.keep }, { key: '30d', label: t.settings.days30 }]} />
          <T variant="caption" tone="tertiary">{t.settings.evidenceNote}</T>
        </Card>
        <Card padding={0} style={{ gap: 0 }}>
          <SettingsRow icon="EyeOff" label={busy === 'ev' ? t.settings.deleting : t.settings.delEvidence} chevron={false} onPress={deleteEvidence} />
          <Divider />
          <SettingsRow icon="Doc" label={busy === 'export' ? t.settings.preparing : t.settings.export} chevron={false} onPress={exportData} />
          <Divider />
          <SettingsRow icon="Shield" label={busy === 'all' ? t.settings.signingOut : t.settings.signOutAll} chevron={false} onPress={signOutAll} />
          <Divider />
          <SettingsRow icon="Doc" label={t.settings.terms} onPress={() => WebBrowser.openBrowserAsync(config.termsUrl)} />
          {config.privacyUrl ? (<><Divider /><SettingsRow icon="Lock" label={t.settings.privacyPolicy} onPress={() => WebBrowser.openBrowserAsync(config.privacyUrl)} /></>) : null}
        </Card>
        <T variant="caption" tone="tertiary">{t.settings.privacyNote}</T>
      </View>

      {admin.data ? (
        <Card padding={0} style={{ gap: 0 }}>
          <SettingsRow icon="Sparkle" label={t.aiUsage.settingsRow} onPress={() => router.push('/ai-usage')} />
        </Card>
      ) : null}

      {/* Subscription */}
      <View style={{ gap: 12 }}>
        <SectionHeader title={t.settings.subscription} />
        <Card tone={premium ? 'accent' : 'default'} style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="Shield" size={20} tint={color.accent.glow} />
            <T variant="bodyStrong" style={{ flex: 1 }}>{plan}</T>
          </View>
          <T variant="caption" tone="secondary">
            {!premium ? t.settings.freeBody : until ? (e?.will_renew === false ? t.settings.ends(until) : t.settings.renews(until)) : t.settings.activeBody}
          </T>
          {premium && <T variant="caption" tone="tertiary">{t.settings.billing}</T>}
        </Card>
        {!premium && <Button label={t.settings.upgrade} icon="Sparkle" onPress={() => router.push('/paywall')} />}
        {purchasesAvailable() ? (
          <Card padding={0} style={{ gap: 0 }}>
            {premium && (<><SettingsRow icon="Shield" label={t.settings.manage} onPress={() => void manageSubscription()} /><Divider /></>)}
            <SettingsRow icon="Retry" label={busy === 'restore' ? t.settings.restoring : t.settings.restore} chevron={false} onPress={onRestore} />
          </Card>
        ) : (
          <T variant="caption" tone="tertiary">{t.settings.manageOnIphone}</T>
        )}
      </View>

      <View style={{ gap: 12 }}>
        <Button kind="ghost" label={t.settings.signOut} icon="Logout" onPress={() => { void signOut(); }} />
        <Button kind="danger" label={t.settings.delAccount} icon="Trash" loading={busy === 'del'} onPress={deleteAccount} />
        {config.demo && <T variant="caption" tone="warning" align="center">{t.settings.demo}</T>}
      </View>
    </Screen>
  );
}
