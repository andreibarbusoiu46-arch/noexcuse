import { router } from 'expo-router';
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

const fmt = (d: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d.slice(0, 10)}T00:00:00Z`));
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
      <BackHeader overline="Every Monday, 06:00 your time" title="Weekly report" />
      {q.loading && !d ? <LoadingPanel label="Loading reports…" /> : q.error && !d ? (
        <MessagePanel kind="error" icon="Alert" title="Couldn’t load your reports." body="Check your connection and try again." action="Try again" onAction={() => q.reload()} />
      ) : d?.locked ? (
        <Upsell title={d.count ? `${d.count} report${d.count === 1 ? ' is' : 's are'} waiting for you.` : 'Your week, measured.'}
          body="What you kept, what slipped, your best and hardest day, and how your Discipline Score moved — every Monday." />
      ) : !r ? (
        <MessagePanel kind="empty" icon="Doc" title="No report yet." body="Your first report arrives the Monday after your first full week." />
      ) : (
        <>
          <ReportView data={r.data} />
          <Button kind="glass" icon="Sparkle" label="Ask the coach about this week"
            onPress={() => router.push({ pathname: '/coach', params: { prompt: `Review my week of ${weekLabel(r.week_start)}: what should I change this week?` } })} />
          {d!.reports.length > 1 && (
            <View style={{ gap: 12 }}>
              <SectionHeader title="Earlier weeks" />
              <Card padding={0} style={{ gap: 0 }}>
                {d!.reports.map((x, i) => (
                  <View key={x.id}>
                    {i > 0 && <Divider />}
                    <Tap onPress={() => setSel(i)} accessibilityState={{ selected: i === sel }} accessibilityLabel={`Week of ${weekLabel(x.week_start)}`}>
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
          {x.verified} of {x.settled} targets verified{diff == null ? '' : ` · ${diff >= 0 ? 'up' : 'down'} from ${x.previous_success_rate}% the week before`}
        </T>
      </Card>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        <MiniStat label="Points" value={`${x.points > 0 ? '+' : x.points < 0 ? '−' : ''}${Math.abs(x.points)}`} caption="this week" />
        <MiniStat label="Score" value={x.score_end == null ? '—' : String(x.score_end)} caption={scoreDiff == null ? 'Discipline' : `${scoreDiff >= 0 ? '+' : '−'}${Math.abs(scoreDiff)} this week`} />
        <MiniStat label="Missed" value={String(x.missed + x.rejected)} caption={x.rejected ? `${x.rejected} rejected` : 'targets'} />
        <MiniStat label="Streak" value={String(x.longest_streak)} caption="best current" />
      </View>
      <Card padding={0} style={{ gap: 0 }}>
        {[
          ['Strongest commitment', x.best ? `${x.best.title} · ${x.best.verified}/${x.best.settled}` : '—'],
          ['Needs work', x.worst ? `${x.worst.title} · ${x.worst.verified}/${x.worst.settled}` : 'Nothing slipped'],
          ['Best day', x.best_day ?? '—'],
          ['Hardest day', x.hardest_day ?? '—'],
          ['Challenges', `${x.challenges_completed} completed · ${x.challenges_failed} failed`],
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
          <SectionHeader title="By commitment" />
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
