import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { Avatar, SectionHeader, StatTile } from '@/components/Blocks';
import { Button } from '@/components/Button';
import { Card, Divider } from '@/components/Card';
import { Field } from '@/components/Field';
import { Icon, type IconName } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { MessagePanel } from '@/components/StatePanel';
import { Tap } from '@/components/Tap';
import { T } from '@/components/Text';
import { api } from '@/data';
import { config } from '@/lib/config';
import { confirmDestructive, notify } from '@/lib/dialog';
import { haptics } from '@/lib/haptics';
import { useLoad } from '@/lib/hooks';
import { manageSubscription, restore } from '@/lib/purchases';
import { disablePush, enablePush, pushPermissionGranted } from '@/lib/push';
import { dayLabel, deviceTimeZone, formatTime } from '@/lib/time';
import { useApp } from '@/providers/AppProvider';
import { color } from '@/theme/tokens';

function Row({ icon, label, value, onPress, danger }: { icon: IconName; label: string; value?: string; onPress: () => void; danger?: boolean }) {
  return (
    <Tap onPress={onPress} accessibilityLabel={value ? `${label}, ${value}` : label}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 }}>
        <Icon name={icon} size={20} tint={danger ? color.status.danger : color.icon.secondary} />
        <T tone={danger ? 'danger' : 'primary'} style={{ flex: 1 }}>{label}</T>
        {value ? <T variant="caption" tone="tertiary" numberOfLines={1} style={{ maxWidth: 160 }}>{value}</T> : null}
        {!danger && <Icon name="ChevronRight" size={16} tint={color.icon.secondary} />}
      </View>
    </Tap>
  );
}

export default function Profile() {
  const { profile, refreshProfile, refreshPremium, signOut } = useApp();
  const tz = profile?.timezone;
  const q = useLoad(async () => {
    const [stats, ent, events] = await Promise.all([api.getStats(), api.getEntitlement(), api.getRecentEvents(3)]);
    return { stats, ent, events };
  });
  const [push, setPush] = useState<boolean | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(profile?.display_name ?? '');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { pushPermissionGranted().then(setPush).catch(() => setPush(false)); }, []);

  async function togglePush() {
    setBusy('push');
    if (push) { await disablePush().catch(() => {}); setPush(false); }
    else {
      const r = await enablePush().catch(() => 'unavailable' as const);
      setPush(r === 'enabled');
      if (r === 'denied') notify('Notifications are off', 'Turn them on in Settings › NoExcuse › Notifications to get reminders before each window.');
    }
    setBusy(null);
  }

  async function saveName() {
    const n = name.trim();
    if (!n) return;
    await api.updateProfile({ display_name: n.slice(0, 40) }).then(() => haptics.success()).catch(() => haptics.error());
    setEditingName(false);
    void refreshProfile();
  }

  async function syncTimezone() {
    const tzNow = deviceTimeZone();
    await api.updateProfile({ timezone: tzNow }).then(() => haptics.success()).catch(() => haptics.error());
    void refreshProfile();
  }

  async function onRestore() {
    setBusy('restore');
    const r = await restore();
    if (r.ok) await api.refreshEntitlement().catch(() => null);
    await refreshPremium();
    void q.reload({ silent: true });
    setBusy(null);
    notify(r.ok && r.premium ? 'Subscription restored' : 'Nothing to restore', r.ok ? (r.premium ? 'Premium is active on this account.' : 'No active subscription was found for this Apple ID.') : r.message);
  }

  async function confirmDelete() {
    const ok = await confirmDestructive('Delete account?', 'This permanently deletes your habits, proofs, points and Arena history. Cancel your subscription separately in Settings › Apple ID › Subscriptions.', 'Delete');
    if (!ok) return;
    haptics.heavy();
    await api.deleteAccount().catch(() => notify('Couldn’t delete the account', 'Try again in a moment.'));
  }


  const s = q.data?.stats;
  const ent = q.data?.ent;
  const subLine = !ent?.is_active ? 'Inactive' : ent.period_type === 'trial' ? 'Premium · free trial' : 'Premium';
  const renew = ent?.expires_at ? `${ent.will_renew === false ? 'Ends' : 'Renews'} ${new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(ent.expires_at))}` : '';

  return (
    <Screen tabBar refreshing={q.refreshing} onRefresh={() => q.reload()}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <Avatar name={profile?.display_name ?? '?'} size={72} />
        <View style={{ flex: 1, gap: 4 }}>
          {editingName ? (
            <Field label="Display name" value={name} onChangeText={setName} autoFocus maxLength={40} returnKeyType="done" onSubmitEditing={saveName} onBlur={saveName} />
          ) : (
            <Tap onPress={() => { setName(profile?.display_name ?? ''); setEditingName(true); }} accessibilityLabel="Edit display name" accessibilityHint="Shown in the Arena">
              <T variant="h2" numberOfLines={1}>{profile?.display_name}</T>
            </Tap>
          )}
          <T variant="caption" tone="tertiary">{tz}</T>
        </View>
      </View>

      <Tap onPress={() => manageSubscription()} accessibilityLabel={`Subscription: ${subLine}. ${renew}`}>
        <Card tone="accent" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
          <Icon name="Shield" size={22} tint={color.accent.glow} />
          <View style={{ flex: 1, gap: 2 }}>
            <T variant="bodyStrong">{subLine}</T>
            {renew ? <T variant="caption" tone="secondary">{renew}</T> : null}
          </View>
          <Icon name="ChevronRight" size={18} tint={color.icon.secondary} />
        </Card>
      </Tap>

      {q.error && !q.data ? (
        <MessagePanel kind="error" icon="Alert" title="Stats didn’t load." body="Check your connection and try again." action="Try again" onAction={() => q.reload()} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <StatTile label="Total points" value={(s?.total_points ?? 0).toLocaleString('en-US')} caption="lifetime" icon="Bolt" />
            <StatTile label="Current streak" value={String(s?.current_streak ?? 0)} caption="days" icon="Flame" />
          </View>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <StatTile label="Longest streak" value={String(s?.longest_streak ?? 0)} caption="days" icon="Arena" />
            <StatTile label="Success rate" value={s?.success_rate == null ? '—' : `${s.success_rate}%`} caption={`${s?.habits_completed ?? 0} of ${s?.settled_targets ?? 0} targets`} icon="Target" />
          </View>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
            <Icon name="Check" size={22} tint={color.status.success} />
            <T variant="bodyStrong" style={{ flex: 1 }}>Habits completed</T>
            <T variant="h2">{s?.habits_completed ?? 0}</T>
          </Card>
          {(q.data?.events.length ?? 0) > 0 && (
            <View style={{ gap: 12 }}>
              <SectionHeader title="Recent activity" />
              <Card padding={0} style={{ gap: 0 }}>
                {q.data!.events.map((e, i) => (
                  <View key={e.id}>
                    {i > 0 && <Divider />}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 }}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <T variant="bodySmall" numberOfLines={1}>{e.habit.title}{e.reason === 'verified' ? ' verified' : e.reason === 'rejected' ? ' — rejected' : ' — missed'}</T>
                        <T variant="caption" tone="tertiary">{dayLabel(e.created_at, tz)} · {formatTime(e.created_at, tz)}</T>
                      </View>
                      <T variant="bodyStrong" tone={e.delta > 0 ? 'success' : 'danger'}>{e.delta > 0 ? `+${e.delta}` : `−${Math.abs(e.delta)}`}</T>
                    </View>
                  </View>
                ))}
              </Card>
            </View>
          )}
        </>
      )}

      <View style={{ gap: 12 }}>
        <SectionHeader title="Account" />
        <Card padding={0} style={{ gap: 0 }}>
          <Row icon="Bell" label="Notifications" value={push === null ? '' : push ? 'On' : 'Off'} onPress={togglePush} />
          <Divider />
          <Row icon="Globe" label="Timezone" value={tz === deviceTimeZone() ? tz : `${tz} → tap to use ${deviceTimeZone()}`} onPress={syncTimezone} />
          <Divider />
          <Row icon="Shield" label="Manage subscription" onPress={() => manageSubscription()} />
          <Divider />
          <Row icon="Retry" label={busy === 'restore' ? 'Restoring…' : 'Restore purchases'} onPress={onRestore} />
          <Divider />
          <Row icon="Doc" label="Terms of Use" onPress={() => WebBrowser.openBrowserAsync(config.termsUrl)} />
          {config.privacyUrl ? (<><Divider /><Row icon="Lock" label="Privacy Policy" onPress={() => WebBrowser.openBrowserAsync(config.privacyUrl)} /></>) : null}
          <Divider />
          <Row icon="Logout" label="Sign out" danger onPress={() => { void signOut(); }} />
        </Card>
        <Button kind="danger" label="Delete account" icon="Trash" onPress={confirmDelete} />
        {Platform.OS !== 'web' && config.demo && <T variant="caption" tone="warning" align="center">Demo mode — fixture data, nothing is saved.</T>}
      </View>
      <View style={{ height: 4 }} />
      <T variant="caption" tone="tertiary" align="center">NoExcuse · No excuses. Just execution.</T>
    </Screen>
  );
}
