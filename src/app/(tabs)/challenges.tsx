import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Badge } from '@/components/Badge';
import { SectionHeader } from '@/components/Blocks';
import { Card, Divider } from '@/components/Card';
import { KindBadges } from '@/components/Challenge';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { LoadingPanel, MessagePanel } from '@/components/StatePanel';
import { Tap } from '@/components/Tap';
import { T } from '@/components/Text';
import { Upsell } from '@/components/Upsell';
import { ChallengeRow, MiniStat } from '@/components/WarRoom';
import { api } from '@/data';
import { CHALLENGE_KINDS, type ChallengeKind, type ChallengeTemplate } from '@/data/types';
import { fmtNumber, t } from '@/i18n';
import { challengeTitle, templateText } from '@/i18n/templates';
import { useLoad } from '@/lib/hooks';
import { useApp } from '@/providers/AppProvider';
import { color } from '@/theme/tokens';

const ENDED_TONE = { completed: 'success', failed: 'danger', abandoned: 'neutral' } as const;

export default function ChallengesTab() {
  const { premium } = useApp();
  const q = useLoad(() => api.getChallenges());
  const [kind, setKind] = useState<ChallengeKind | 'all'>('all');
  const d = q.data;
  const active = (d?.mine ?? []).filter((c) => c.status === 'active');
  const ended = (d?.mine ?? []).filter((c) => c.status !== 'active');
  const templates = (d?.templates ?? []).filter((x) => kind === 'all' || x.kind === kind);
  const go = (path: () => void) => (premium ? path() : router.push('/paywall'));
  const s = d?.stats;

  return (
    <Screen tabBar refreshing={q.refreshing} onRefresh={() => q.reload()}>
      <View style={{ gap: 4 }}>
        <T variant="overline" tone="tertiary">{t.ch.tabOverline}</T>
        <T variant="h1" accessibilityRole="header">{t.ch.tabTitle}</T>
      </View>

      {q.loading && !d ? <LoadingPanel label={t.ch.loading} /> : q.error && !d ? (
        <MessagePanel kind="error" icon="Alert" title={t.ch.failTitle} body={t.common.connection} action={t.common.tryAgain} onAction={() => q.reload()} />
      ) : (
        <>
          {!premium && <Upsell title={t.ch.upsellTitle} body={t.ch.upsellBody} />}

          {s && (s.completed + s.failed + s.abandoned + s.active > 0) && (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <MiniStat label={t.ch.statActive} value={String(s.active)} />
              <MiniStat label={t.ch.statDone} value={String(s.completed)} caption={s.completion_rate == null ? undefined : t.ch.rate(s.completion_rate)} />
              <MiniStat label={t.ch.statBonus} value={`+${fmtNumber(s.bonus_earned)}`} caption={t.ch.pts} />
            </View>
          )}

          {active.length > 0 && (
            <View style={{ gap: 12 }}>
              <SectionHeader title={t.ch.active} />
              <Card padding={0} style={{ gap: 0 }}>
                {active.map((c, i) => (
                  <View key={c.id}>
                    {i > 0 && <Divider />}
                    <ChallengeRow title={challengeTitle(c)} progress={c.progress} onPress={() => router.push({ pathname: '/challenge/[id]', params: { id: c.id } })} />
                  </View>
                ))}
              </Card>
            </View>
          )}

          <View style={{ gap: 12 }}>
            <SectionHeader title={t.ch.build} />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <BuildTile icon="Sparkle" title={t.ch.aiTitle} body={t.ch.aiBody} onPress={() => go(() => router.push('/challenge/generate'))} />
              <BuildTile icon="Plus" title={t.ch.customTitle} body={t.ch.customBody} onPress={() => go(() => router.push('/challenge/custom'))} />
            </View>
          </View>

          <View style={{ gap: 12 }}>
            <SectionHeader title={t.ch.library} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
              {(['all', ...CHALLENGE_KINDS] as const).map((k) => {
                const on = k === kind;
                return (
                  <Tap key={k} haptic="selection" dim={false} onPress={() => setKind(k)} accessibilityRole="tab" accessibilityState={{ selected: on }}
                    style={{ paddingHorizontal: 14, height: 34, borderRadius: 17, justifyContent: 'center', backgroundColor: on ? color.accent.primary : color.surface.glass, borderWidth: 1, borderColor: on ? color.border.strong : color.border.hairline }}>
                    <T variant="caption" tone={on ? 'onLight' : 'secondary'}>{k === 'all' ? t.ch.all : t.domain.kind[k]}</T>
                  </Tap>
                );
              })}
            </ScrollView>
            {templates.length === 0 ? (
              <T variant="caption" tone="tertiary">{t.ch.noneInKind}</T>
            ) : (
              <Card padding={0} style={{ gap: 0 }}>
                {templates.map((x, i) => (
                  <View key={x.id}>
                    {i > 0 && <Divider />}
                    <TemplateRow tpl={x} />
                  </View>
                ))}
              </Card>
            )}
            <T variant="caption" tone="tertiary">{t.ch.bonusNote(d?.bonus_per_day ?? 10)}</T>
          </View>

          {ended.length > 0 && (
            <View style={{ gap: 12 }}>
              <SectionHeader title={t.ch.history} />
              <Card padding={0} style={{ gap: 0 }}>
                {ended.map((c, i) => {
                  const st = c.status as keyof typeof ENDED_TONE;
                  return (
                    <View key={c.id}>
                      {i > 0 && <Divider />}
                      <Tap onPress={() => router.push({ pathname: '/challenge/[id]', params: { id: c.id } })} accessibilityLabel={`${challengeTitle(c)}, ${t.domain.challengeStatus[st]}`}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
                          <View style={{ flex: 1, gap: 3 }}>
                            <T variant="bodyStrong" numberOfLines={1}>{challengeTitle(c)}</T>
                            <T variant="caption" tone="tertiary" numberOfLines={1}>{t.ch.endedMeta(c.progress.done, c.progress.required, st === 'completed' ? c.bonus_points : 0)}</T>
                          </View>
                          <Badge tone={ENDED_TONE[st]} label={t.domain.challengeStatus[st]} />
                        </View>
                      </Tap>
                    </View>
                  );
                })}
              </Card>
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

function BuildTile({ icon, title, body, onPress }: { icon: 'Sparkle' | 'Plus'; title: string; body: string; onPress: () => void }) {
  return (
    <Tap onPress={onPress} style={{ flex: 1 }} accessibilityLabel={`${title}. ${body}`}>
      <Card style={{ gap: 8, flex: 1 }}>
        <Icon name={icon} size={20} />
        <T variant="bodyStrong">{title}</T>
        <T variant="caption" tone="secondary">{body}</T>
      </Card>
    </Tap>
  );
}

function TemplateRow({ tpl }: { tpl: ChallengeTemplate }) {
  const x = templateText(tpl);
  const n = tpl.objectives?.length ?? 0;
  return (
    <Tap onPress={() => router.push({ pathname: '/challenge/preview', params: { template: tpl.id } })} accessibilityLabel={`${x.title}. ${x.tagline}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
        <View style={{ flex: 1, gap: 6 }}>
          <T variant="bodyStrong">{x.title}</T>
          <T variant="caption" tone="secondary">{x.tagline}</T>
          <KindBadges kind={tpl.kind} difficulty={tpl.difficulty} />
          <T variant="caption" tone="tertiary">
            {t.common.days(tpl.duration_days)} · {n ? t.ch.objectivesN(n) : t.ch.yourCommitment} · {tpl.allowed_misses === 0 ? t.ch.noMisses : t.ch.missesAllowed(tpl.allowed_misses)}
          </T>
        </View>
        <Icon name="ChevronRight" size={20} tint={color.icon.secondary} />
      </View>
    </Tap>
  );
}
