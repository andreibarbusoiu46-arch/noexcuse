import { router } from 'expo-router';
import { View } from 'react-native';
import { Avatar, SectionHeader, StatTile } from '@/components/Blocks';
import { IconButton } from '@/components/Button';
import { Card, Divider } from '@/components/Card';
import { Icon, type IconName } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { MessagePanel } from '@/components/StatePanel';
import { Tap } from '@/components/Tap';
import { T } from '@/components/Text';
import { api } from '@/data';
import { fmtNumber, locale, t } from '@/i18n';
import { useLoad } from '@/lib/hooks';
import { dayLabel, formatTime } from '@/lib/time';
import { useApp } from '@/providers/AppProvider';
import { color } from '@/theme/tokens';

function Row({ icon, label, value, onPress }: { icon: IconName; label: string; value?: string; onPress: () => void }) {
  return (
    <Tap onPress={onPress} accessibilityLabel={value ? `${label}, ${value}` : label}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 }}>
        <Icon name={icon} size={20} tint={color.icon.secondary} />
        <T style={{ flex: 1 }}>{label}</T>
        {value ? <T variant="caption" tone="tertiary" numberOfLines={1} style={{ maxWidth: 160 }}>{value}</T> : null}
        <Icon name="ChevronRight" size={16} tint={color.icon.secondary} />
      </View>
    </Tap>
  );
}

export default function Profile() {
  const { profile, premium } = useApp();
  const tz = profile?.timezone;
  const q = useLoad(async () => {
    const [stats, ent, events] = await Promise.all([api.getStats(), api.getEntitlement(), api.getRecentEvents(3)]);
    return { stats, ent, events };
  });

  const s = q.data?.stats;
  const ent = q.data?.ent;
  const subLine = !premium ? t.profile.free : ent?.period_type === 'trial' ? t.profile.trial : t.profile.premium;
  const renew = !premium ? t.profile.upgradeLine
    : ent?.expires_at ? t.profile.renewLine(ent.will_renew === false, new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' }).format(new Date(ent.expires_at))) : '';

  return (
    <Screen tabBar refreshing={q.refreshing} onRefresh={() => q.reload()}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <Avatar name={profile?.display_name ?? '?'} size={72} />
        <View style={{ flex: 1, gap: 4 }}>
          <T variant="h2" numberOfLines={1}>{profile?.display_name}</T>
          <T variant="caption" tone="tertiary">{tz}</T>
        </View>
        <IconButton icon="Settings" label={t.profile.settings} onPress={() => router.push('/settings')} />
      </View>

      <Tap onPress={() => (premium ? router.push('/settings') : router.push('/paywall'))} accessibilityLabel={`${subLine}. ${renew}`}>
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
        <MessagePanel kind="error" icon="Alert" title={t.profile.statsFail} body={t.common.connection} action={t.common.tryAgain} onAction={() => q.reload()} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <StatTile label={t.profile.totalPoints} value={fmtNumber(s?.total_points ?? 0)} caption={t.profile.lifetime} icon="Bolt" />
            <StatTile label={t.profile.currentStreak} value={String(s?.current_streak ?? 0)} caption={t.profile.days} icon="Flame" />
          </View>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <StatTile label={t.profile.longestStreak} value={String(s?.longest_streak ?? 0)} caption={t.profile.days} icon="Arena" />
            <StatTile label={t.profile.successRate} value={s?.success_rate == null ? '—' : `${s.success_rate}%`} caption={t.profile.ofTargets(s?.habits_completed ?? 0, s?.settled_targets ?? 0)} icon="Target" />
          </View>
          {(q.data?.events.length ?? 0) > 0 && (
            <View style={{ gap: 12 }}>
              <SectionHeader title={t.profile.recent} />
              <Card padding={0} style={{ gap: 0 }}>
                {q.data!.events.map((e, i) => (
                  <View key={e.id}>
                    {i > 0 && <Divider />}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 }}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <T variant="bodySmall" numberOfLines={1}>{e.habit.title} {t.home.reason[e.reason] ?? ''}</T>
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
        <SectionHeader title={t.profile.coaching} />
        <Card padding={0} style={{ gap: 0 }}>
          <Row icon="Sparkle" label={t.profile.coach} value={premium ? '' : t.common.premium} onPress={() => router.push('/coach')} />
          <Divider />
          <Row icon="Doc" label={t.profile.report} value={premium ? '' : t.common.premium} onPress={() => router.push('/reports')} />
          <Divider />
          <Row icon="Profile" label={t.profile.partners} onPress={() => router.push('/partners')} />
          <Divider />
          <Row icon="Arena" label={t.profile.achievements} onPress={() => router.push('/achievements')} />
          <Divider />
          <Row icon="ArrowUp" label={t.profile.share} onPress={() => router.push('/share')} />
        </Card>
      </View>

      <View style={{ gap: 12 }}>
        <SectionHeader title={t.profile.account} />
        <Card padding={0} style={{ gap: 0 }}>
          <Row icon="Settings" label={t.profile.settings} value={t.profile.settingsValue} onPress={() => router.push('/settings')} />
        </Card>
      </View>
      <T variant="caption" tone="tertiary" align="center">{t.profile.tagline}</T>
    </Screen>
  );
}
