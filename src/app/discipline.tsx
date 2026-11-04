import { View } from 'react-native';
import { locale, t } from '@/i18n';
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
const parts = (): { key: Key; label: string; explain: (c: DisciplineScore['counts']) => string; improve: string }[] => [
  { key: 'completion', label: t.discipline.completion, explain: (c) => t.discipline.completionExplain(c.verified_28, c.settled_28), improve: t.discipline.completionImprove },
  { key: 'recent', label: t.discipline.recent, explain: (c) => t.discipline.recentExplain(c.verified_7, c.settled_7), improve: t.discipline.recentImprove },
  { key: 'consistency', label: t.discipline.consistency, explain: (c) => t.discipline.consistencyExplain(c.clean_days_14, c.days_14), improve: t.discipline.consistencyImprove },
  { key: 'streak', label: t.discipline.streak, explain: (c) => t.discipline.streakExplain(c.streak), improve: t.discipline.streakImprove },
];

export default function DisciplineScreen() {
  const q = useLoad(() => api.getDiscipline());
  const d = q.data;
  const cur = d?.current ?? null;
  const PARTS = parts();
  const weakest = cur?.components ? [...PARTS].sort((a, b) => cur.components![a.key] - cur.components![b.key])[0] : null;
  const hist = d?.history ?? [];

  return (
    <Screen refreshing={q.refreshing} onRefresh={() => q.reload()}>
      <BackHeader overline={t.discipline.overline} title={t.discipline.title} />
      {q.loading && !d ? <LoadingPanel label={t.discipline.loading} /> : q.error && !d ? (
        <MessagePanel kind="error" icon="Alert" title={t.discipline.failTitle} body={t.common.connection} action={t.common.tryAgain} onAction={() => q.reload()} />
      ) : !cur || cur.score === null ? (
        <MessagePanel kind="empty" icon="Target" title={t.discipline.emptyTitle} body={t.discipline.emptyBody} />
      ) : (
        <>
          <Card style={{ padding: 20, gap: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
              <T variant="numberXL" accessibilityLabel={t.discipline.outOf(cur.score)}>{cur.score}</T>
              <T variant="bodySmall" tone="tertiary" style={{ marginBottom: 12 }}>/ 100</T>
            </View>
            <Bar value={cur.score} muted={cur.provisional} />
            <T variant="caption" tone="secondary">
              {cur.provisional ? t.discipline.calibrating(cur.counts.settled_28) : t.discipline.recalculated}
            </T>
          </Card>

          <View style={{ gap: 12 }}>
            <SectionHeader title={t.discipline.parts} />
            <Card padding={0} style={{ gap: 0 }}>
              {PARTS.map((p, i) => {
                const v = cur.components?.[p.key] ?? 0;
                return (
                  <View key={p.key}>
                    {i > 0 && <Divider />}
                    <View style={{ padding: 16, gap: 8 }} accessible accessibilityLabel={t.discipline.partA11y(p.label, cur.weights[p.key], v, p.explain(cur.counts))}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <T variant="bodyStrong" style={{ flex: 1 }}>{p.label}</T>
                        <T variant="caption" tone="tertiary">{t.discipline.weight(cur.weights[p.key])}</T>
                        <T variant="bodyStrong" style={{ minWidth: 32, textAlign: 'right' }}>{v}</T>
                      </View>
                      <Bar value={v} height={4} />
                      <T variant="caption" tone="secondary">{p.explain(cur.counts)}</T>
                    </View>
                  </View>
                );
              })}
            </Card>
            <T variant="caption" tone="tertiary">{t.discipline.formula}</T>
          </View>

          {weakest && cur.components![weakest.key] < 100 && (
            <Card tone="accent" style={{ padding: 16, gap: 6 }}>
              <T variant="overline" tone="tertiary">{t.discipline.raise}</T>
              <T variant="bodyStrong">{t.discipline.weakest(weakest.label)}</T>
              <T variant="bodySmall" tone="secondary">{weakest.improve}</T>
            </Card>
          )}

          <View style={{ gap: 12 }}>
            <SectionHeader title={t.discipline.last90} />
            {hist.length < 2 ? (
              <T variant="bodySmall" tone="tertiary">{t.discipline.trendLater}</T>
            ) : (
              <Card style={{ padding: 16 }}>
                <View style={{ height: 120, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }} accessible
                  accessibilityLabel={t.discipline.historyA11y(hist.length, hist[0].score, hist[hist.length - 1].score)}>
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
            <Averages title={t.discipline.weekly} rows={(d!.weekly ?? []).slice(-6).reverse().map((w) => ({ k: w.week, label: t.discipline.weekOf(fmtDay(w.week)), v: w.avg }))} />
            <Averages title={t.discipline.monthly} rows={(d!.monthly ?? []).slice(-6).reverse().map((m) => ({ k: m.month, label: fmtMonth(m.month), v: m.avg }))} />
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
        {rows.length === 0 ? <T variant="bodySmall" tone="tertiary" style={{ padding: 14 }}>{t.discipline.noData}</T> : rows.map((r, i) => (
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

const fmtDay = (d: string) => new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d.slice(0, 10)}T00:00:00Z`));
const fmtMonth = (d: string) => new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d.slice(0, 7)}-01T00:00:00Z`));
