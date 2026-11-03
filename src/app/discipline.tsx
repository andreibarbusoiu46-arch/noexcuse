import { View } from 'react-native';
import { BackHeader } from '@/components/BackHeader';
import { SectionHeader } from '@/components/Blocks';
import { Card, Divider } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { LoadingPanel, MessagePanel } from '@/components/StatePanel';
import { T } from '@/components/Text';
import { Bar } from '@/components/WarRoom';
import { api, type DisciplineScore } from '@/data';
import { useLoad } from '@/lib/hooks';
import { color, radius } from '@/theme/tokens';

type Key = keyof DisciplineScore['weights'];
const PARTS: { key: Key; label: string; explain: (c: DisciplineScore['counts']) => string; improve: string }[] = [
  { key: 'completion', label: 'Completion', explain: (c) => `${c.verified_28} of ${c.settled_28} targets verified in the last 28 days`, improve: 'Verify more of your scheduled targets. Every miss in the last 28 days weighs on this.' },
  { key: 'recent', label: 'Recent form', explain: (c) => `${c.verified_7} of ${c.settled_7} verified in the last 7 days`, improve: 'This week counts double. A clean run of 7 days moves the score fastest.' },
  { key: 'consistency', label: 'Consistency', explain: (c) => `${c.clean_days_14} of ${c.days_14} scheduled days without a miss (last 14)`, improve: 'A day counts as clean only if nothing scheduled was missed. Fewer commitments done every time beats many done sometimes.' },
  { key: 'streak', label: 'Streak', explain: (c) => `${c.streak}-day streak (full marks at 21)`, improve: 'Keep the streak alive. It reaches full marks at 21 days in a row.' },
];

export default function DisciplineScreen() {
  const q = useLoad(() => api.getDiscipline());
  const d = q.data;
  const cur = d?.current ?? null;
  const weakest = cur?.components ? [...PARTS].sort((a, b) => cur.components![a.key] - cur.components![b.key])[0] : null;
  const hist = d?.history ?? [];

  return (
    <Screen refreshing={q.refreshing} onRefresh={() => q.reload()}>
      <BackHeader overline="Last 28 days" title="Discipline Score" />
      {q.loading && !d ? <LoadingPanel label="Calculating…" /> : q.error && !d ? (
        <MessagePanel kind="error" icon="Alert" title="Couldn’t load your score." body="Check your connection and try again." action="Try again" onAction={() => q.reload()} />
      ) : !cur || cur.score === null ? (
        <MessagePanel kind="empty" icon="Target" title="No score yet." body="Your Discipline Score appears once your first target settles — verified or missed." />
      ) : (
        <>
          <Card style={{ padding: 20, gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
              <T variant="numberXL" accessibilityLabel={`Score ${cur.score} out of 100`}>{cur.score}</T>
              <T variant="bodySmall" tone="tertiary" style={{ marginBottom: 12 }}>/ 100</T>
            </View>
            <Bar value={cur.score} muted={cur.provisional} />
            <T variant="caption" tone="secondary">
              {cur.provisional ? `Calibrating: ${cur.counts.settled_28} of 5 settled targets so far. The number becomes stable after 5.` : 'Recalculated every few minutes from settled targets only.'}
            </T>
          </Card>

          <View style={{ gap: 12 }}>
            <SectionHeader title="What it’s made of" />
            <Card padding={0} style={{ gap: 0 }}>
              {PARTS.map((p, i) => {
                const v = cur.components?.[p.key] ?? 0;
                return (
                  <View key={p.key}>
                    {i > 0 && <Divider />}
                    <View style={{ padding: 16, gap: 8 }} accessible accessibilityLabel={`${p.label}, weight ${cur.weights[p.key]} percent, ${v} out of 100. ${p.explain(cur.counts)}`}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <T variant="bodyStrong" style={{ flex: 1 }}>{p.label}</T>
                        <T variant="caption" tone="tertiary">{cur.weights[p.key]}% weight</T>
                        <T variant="bodyStrong" style={{ minWidth: 32, textAlign: 'right' }}>{v}</T>
                      </View>
                      <Bar value={v} height={4} />
                      <T variant="caption" tone="secondary">{p.explain(cur.counts)}</T>
                    </View>
                  </View>
                );
              })}
            </Card>
            <T variant="caption" tone="tertiary">Score = 45% completion + 25% recent form + 20% consistency + 10% streak. Excused targets don’t count either way.</T>
          </View>

          {weakest && cur.components![weakest.key] < 100 && (
            <Card tone="accent" style={{ padding: 16, gap: 6 }}>
              <T variant="overline" tone="tertiary">How to raise it</T>
              <T variant="bodyStrong">{weakest.label} is your weakest part.</T>
              <T variant="bodySmall" tone="secondary">{weakest.improve}</T>
            </Card>
          )}

          <View style={{ gap: 12 }}>
            <SectionHeader title="Last 90 days" />
            {hist.length < 2 ? (
              <T variant="bodySmall" tone="tertiary">The trend appears after two days of history.</T>
            ) : (
              <Card style={{ padding: 16 }}>
                <View style={{ height: 120, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }} accessible
                  accessibilityLabel={`Daily score history, ${hist.length} days, from ${hist[0].score} to ${hist[hist.length - 1].score}`}>
                  {hist.map((h) => (
                    <View key={h.day} style={{ flex: 1, height: `${Math.max(2, h.score)}%`, borderRadius: 2, backgroundColor: h.provisional ? color.text.tertiary : color.text.primary }} />
                  ))}
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <T variant="caption" tone="tertiary">{fmtDay(hist[0].day)}</T>
                  <T variant="caption" tone="tertiary">{fmtDay(hist[hist.length - 1].day)}</T>
                </View>
              </Card>
            )}
          </View>

          <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
            <Averages title="Weekly average" rows={(d!.weekly ?? []).slice(-6).reverse().map((w) => ({ k: w.week, label: `Week of ${fmtDay(w.week)}`, v: w.avg }))} />
            <Averages title="Monthly average" rows={(d!.monthly ?? []).slice(-6).reverse().map((m) => ({ k: m.month, label: fmtMonth(m.month), v: m.avg }))} />
          </View>
        </>
      )}
    </Screen>
  );
}

function Averages({ title, rows }: { title: string; rows: { k: string; label: string; v: number }[] }) {
  return (
    <View style={{ flex: 1, minWidth: 220, gap: 8 }}>
      <T variant="overline" tone="tertiary">{title}</T>
      <View style={{ backgroundColor: color.surface.card, borderColor: color.border.hairline, borderWidth: 1, borderRadius: radius.lg }}>
        {rows.length === 0 ? <T variant="bodySmall" tone="tertiary" style={{ padding: 14 }}>No data yet.</T> : rows.map((r, i) => (
          <View key={r.k}>
            {i > 0 && <Divider />}
            <View style={{ flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 10 }}>
              <T variant="bodySmall" tone="secondary" style={{ flex: 1 }}>{r.label}</T>
              <T variant="bodyStrong">{Math.round(r.v)}</T>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const fmtDay = (d: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d.slice(0, 10)}T00:00:00Z`));
const fmtMonth = (d: string) => new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d.slice(0, 7)}-01T00:00:00Z`));
