import { router } from 'expo-router';
import { locale, t } from '@/i18n';
import { useState } from 'react';
import { View } from 'react-native';
import { BackHeader } from '@/components/BackHeader';
import { SectionHeader } from '@/components/Blocks';
import { Button } from '@/components/Button';
import { Card, Divider } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { LoadingPanel, MessagePanel } from '@/components/StatePanel';
import { Tap } from '@/components/Tap';
import { T } from '@/components/Text';
import { Upsell } from '@/components/Upsell';
import { Bar, MiniStat } from '@/components/WarRoom';
import { api, type WeeklyReportData } from '@/data';
import { useLoad } from '@/lib/hooks';
import { useApp } from '@/providers/AppProvider';

// The server names days in English (Postgres to_char); show them in the user's language.
const EN_DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const dayName = (s: string | null) => (s ? t.common.weekdayLong[EN_DAYS.indexOf(s)] || s : '—');
const fmt = (d: string) => new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d.slice(0, 10)}T00:00:00Z`));
const weekLabel = (start: string) => {
  const end = new Date(`${start.slice(0, 10)}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 6);
  return `${fmt(start)} – ${fmt(end.toISOString())}`;
};

/** Weekly reports: computed on the server every Monday morning from your settled targets and ledger. */
export default function Reports() {
  const { premium } = useApp();
  const q = useLoad(() => api.getWeeklyReports(), [premium]);
  const [sel, setSel] = useState(0);
  const d = q.data;
  const r = d?.reports[sel];

  return (
    <Screen refreshing={q.refreshing} onRefresh={() => q.reload()}>
      <BackHeader overline={t.reports.overline} title={t.reports.title} />
      {q.loading && !d ? <LoadingPanel label={t.reports.loading} /> : q.error && !d ? (
        <MessagePanel kind="error" icon="Alert" title={t.reports.failTitle} body={t.common.connection} action={t.common.tryAgain} onAction={() => q.reload()} />
      ) : d?.locked ? (
        <Upsell title={d.count ? t.reports.waiting(d.count) : t.reports.measured}
          body={t.reports.upsellBody} />
      ) : !r ? (
        <MessagePanel kind="empty" icon="Doc" title={t.reports.empty} body={t.reports.emptyBody} />
      ) : (
        <>
          <ReportView data={r.data} />
          <Button kind="glass" icon="Sparkle" label={t.reports.ask}
            onPress={() => router.push({ pathname: '/coach', params: { prompt: t.coach.weekPrompt(weekLabel(r.week_start)) } })} />
          {d!.reports.length > 1 && (
            <View style={{ gap: 12 }}>
              <SectionHeader title={t.reports.earlier} />
              <Card padding={0} style={{ gap: 0 }}>
                {d!.reports.map((x, i) => (
                  <View key={x.id}>
                    {i > 0 && <Divider />}
                    <Tap onPress={() => setSel(i)} accessibilityState={{ selected: i === sel }} accessibilityLabel={t.reports.weekOf(weekLabel(x.week_start))}>
                      <View style={{ flexDirection: 'row', padding: 14, gap: 12 }}>
                        <T variant="bodySmall" tone={i === sel ? 'primary' : 'secondary'} style={{ flex: 1 }}>{weekLabel(x.week_start)}</T>
                        <T variant="bodyStrong">{x.data.success_rate == null ? '—' : `${x.data.success_rate}%`}</T>
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

function ReportView({ data: x }: { data: WeeklyReportData }) {
  const diff = x.success_rate != null && x.previous_success_rate != null ? x.success_rate - x.previous_success_rate : null;
  const scoreDiff = x.score_start != null && x.score_end != null ? x.score_end - x.score_start : null;
  return (
    <>
      <Card style={{ padding: 20, gap: 12 }}>
        <T variant="overline" tone="tertiary">{weekLabel(x.week_start)}</T>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
          <T variant="numberXL">{x.success_rate == null ? '—' : `${x.success_rate}%`}</T>
        </View>
        <Bar value={x.success_rate ?? 0} />
        <T variant="caption" tone="secondary">
          {t.reports.verifiedOf(x.verified, x.settled)}{diff == null ? '' : t.reports.vsPrev(diff >= 0, x.previous_success_rate ?? 0)}
        </T>
      </Card>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <MiniStat label={t.reports.points} value={`${x.points > 0 ? '+' : x.points < 0 ? '−' : ''}${Math.abs(x.points)}`} caption={t.reports.thisWeek} />
        <MiniStat label={t.reports.score} value={x.score_end == null ? '—' : String(x.score_end)} caption={scoreDiff == null ? t.reports.discipline : t.reports.scoreMove(scoreDiff)} />
        <MiniStat label={t.reports.missed} value={String(x.missed + x.rejected)} caption={x.rejected ? t.reports.rejectedN(x.rejected) : t.reports.targets} />
        <MiniStat label={t.reports.streak} value={String(x.longest_streak)} caption={t.reports.bestCurrent} />
      </View>
      <Card padding={0} style={{ gap: 0 }}>
        {[
          [t.reports.strongest, x.best ? `${x.best.title} · ${x.best.verified}/${x.best.settled}` : '—'],
          [t.reports.needsWork, x.worst ? `${x.worst.title} · ${x.worst.verified}/${x.worst.settled}` : t.reports.nothingSlipped],
          [t.reports.bestDay, dayName(x.best_day)],
          [t.reports.hardestDay, dayName(x.hardest_day)],
          [t.reports.challenges, t.reports.challengesLine(x.challenges_completed, x.challenges_failed)],
        ].map(([k, v], i) => (
          <View key={k}>
            {i > 0 && <Divider />}
            <View style={{ flexDirection: 'row', gap: 12, padding: 14 }}>
              <T variant="bodySmall" tone="secondary" style={{ flex: 1 }}>{k}</T>
              <T variant="bodySmall" style={{ flexShrink: 1, textAlign: 'right' }}>{v}</T>
            </View>
          </View>
        ))}
      </Card>
      {x.commitments.length > 0 && (
        <View style={{ gap: 10 }}>
          <SectionHeader title={t.reports.byCommitment} />
          {x.commitments.map((c) => (
            <View key={c.title} style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row' }}>
                <T variant="bodySmall" style={{ flex: 1 }} numberOfLines={1}>{c.title}</T>
                <T variant="caption" tone="secondary">{c.verified}/{c.settled}</T>
              </View>
              <Bar value={c.settled ? (100 * c.verified) / c.settled : 0} height={4} />
            </View>
          ))}
        </View>
      )}
    </>
  );
}
