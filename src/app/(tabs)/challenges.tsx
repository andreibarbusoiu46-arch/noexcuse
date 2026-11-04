import { router } from 'expo-router';
import { View } from 'react-native';
import { Badge } from '@/components/Badge';
import { SectionHeader } from '@/components/Blocks';
import { Card, Divider } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { LoadingPanel, MessagePanel } from '@/components/StatePanel';
import { Tap } from '@/components/Tap';
import { T } from '@/components/Text';
import { ChallengeRow } from '@/components/WarRoom';
import { api } from '@/data';
import { useLoad } from '@/lib/hooks';
import { useApp } from '@/providers/AppProvider';
import { Upsell } from '@/components/Upsell';
import { color } from '@/theme/tokens';

const ENDED = { completed: { label: 'Completed', tone: 'success' }, failed: { label: 'Failed', tone: 'danger' }, abandoned: { label: 'Abandoned', tone: 'neutral' } } as const;

export default function ChallengesTab() {
  const { premium } = useApp();
  const q = useLoad(() => api.getChallenges());
  const d = q.data;
  const active = (d?.mine ?? []).filter((c) => c.status === 'active');
  const ended = (d?.mine ?? []).filter((c) => c.status !== 'active');

  return (
    <Screen tabBar refreshing={q.refreshing} onRefresh={() => q.reload()}>
      <View style={{ gap: 4 }}>
        <T variant="overline" tone="tertiary">Put a commitment on the line</T>
        <T variant="h1" accessibilityRole="header">Challenges</T>
      </View>

      {q.loading && !d ? <LoadingPanel label="Loading challenges…" /> : q.error && !d ? (
        <MessagePanel kind="error" icon="Alert" title="Challenges didn’t load." body="Check your connection and try again." action="Try again" onAction={() => q.reload()} />
      ) : (
        <>
          {!premium && <Upsell title="Challenges are part of Premium." body="Put one commitment on the line for 7–30 days. Finish it for a one-time bonus of 10 points per required day." />}
          {active.length > 0 && (
            <View style={{ gap: 12 }}>
              <SectionHeader title="Active" />
              <Card padding={0} style={{ gap: 0 }}>
                {active.map((c, i) => (
                  <View key={c.id}>
                    {i > 0 && <Divider />}
                    <ChallengeRow title={`${c.title} · ${c.habit_title}`} progress={c.progress} onPress={() => router.push({ pathname: '/challenge/[id]', params: { id: c.id } })} />
                  </View>
                ))}
              </Card>
            </View>
          )}

          <View style={{ gap: 12 }}>
            <SectionHeader title="Start a challenge" />
            <T variant="caption" tone="secondary">
              Each scheduled day of the challenge must be verified. Miss more than the allowance and it fails. Complete it for +{d?.bonus_per_day ?? 10} points per required day, paid once.
            </T>
            <Card padding={0} style={{ gap: 0 }}>
              {(d?.templates ?? []).map((t, i) => (
                <View key={t.id}>
                  {i > 0 && <Divider />}
                  <Tap onPress={() => (premium ? router.push({ pathname: '/challenge/start', params: { template: t.id } }) : router.push('/paywall'))} accessibilityLabel={`${t.title}, ${t.duration_days} days. ${t.tagline}`}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
                      <View style={{ flex: 1, gap: 3 }}>
                        <T variant="bodyStrong">{t.title}</T>
                        <T variant="caption" tone="secondary">{t.tagline}</T>
                        <T variant="caption" tone="tertiary">{t.duration_days} days · {t.allowed_misses === 0 ? 'no misses allowed' : `${t.allowed_misses} miss${t.allowed_misses === 1 ? '' : 'es'} allowed`}</T>
                      </View>
                      <Icon name="ChevronRight" size={20} tint={color.icon.secondary} />
                    </View>
                  </Tap>
                </View>
              ))}
              <Divider />
              <Tap onPress={() => (premium ? router.push({ pathname: '/challenge/start', params: { template: 'custom' } }) : router.push('/paywall'))} accessibilityLabel="Custom challenge: choose the name, length and misses">
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
                  <View style={{ flex: 1, gap: 3 }}>
                    <T variant="bodyStrong">Custom challenge</T>
                    <T variant="caption" tone="secondary">Your name, 3–90 days, your miss allowance.</T>
                  </View>
                  <Icon name="Plus" size={20} tint={color.icon.secondary} />
                </View>
              </Tap>
            </Card>
          </View>

          {ended.length > 0 && (
            <View style={{ gap: 12 }}>
              <SectionHeader title="History" />
              <Card padding={0} style={{ gap: 0 }}>
                {ended.map((c, i) => (
                  <View key={c.id}>
                    {i > 0 && <Divider />}
                    <Tap onPress={() => router.push({ pathname: '/challenge/[id]', params: { id: c.id } })} accessibilityLabel={`${c.title}, ${ENDED[c.status as keyof typeof ENDED].label}`}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
                        <View style={{ flex: 1, gap: 3 }}>
                          <T variant="bodyStrong" numberOfLines={1}>{c.title}</T>
                          <T variant="caption" tone="tertiary" numberOfLines={1}>{c.habit_title} · {c.progress.done}/{c.progress.required} days</T>
                        </View>
                        <Badge {...ENDED[c.status as keyof typeof ENDED]} />
                      </View>
                    </Tap>
                  </View>
                ))}
              </Card>
            </View>
          )}
        </>
      )}
    </Screen>
  );
}
