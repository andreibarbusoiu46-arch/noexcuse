import { useState } from 'react';
import { View } from 'react-native';
import { BackHeader } from '@/components/BackHeader';
import { SectionHeader, Segmented } from '@/components/Blocks';
import { Card, Divider } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { LoadingPanel, MessagePanel } from '@/components/StatePanel';
import { T } from '@/components/Text';
import { api } from '@/data';
import { fmtNumber, locale, t } from '@/i18n';
import { errorText } from '@/lib/errors';
import { useLoad } from '@/lib/hooks';

const usd = (n: number) => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(n);
const day = (d: string) => new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d.slice(0, 10)}T00:00:00Z`));

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexBasis: '45%', flexGrow: 1, gap: 2 }}>
      <T variant="overline" tone="tertiary">{label}</T>
      <T variant="h3">{value}</T>
    </View>
  );
}

function Line({ left, right, sub }: { left: string; right: string; sub?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="bodySmall" numberOfLines={1}>{left}</T>
        {sub ? <T variant="caption" tone="tertiary">{sub}</T> : null}
      </View>
      <T variant="bodySmall" tone="secondary">{right}</T>
    </View>
  );
}

/** Internal: AI calls, tokens, errors and estimated cost. The server refuses anyone who isn't an admin. */
export default function AiUsage() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const q = useLoad(() => api.getAiUsage(days), [days]);
  const d = q.data;
  const s = t.aiUsage;

  return (
    <Screen refreshing={q.refreshing} onRefresh={() => q.reload()}>
      <BackHeader overline={s.overline} title={s.title} />
      <Segmented<'7' | '30' | '90'> value={String(days) as '7' | '30' | '90'} onChange={(v) => setDays(Number(v) as 7 | 30 | 90)}
        options={[{ key: '7', label: s.days(7) }, { key: '30', label: s.days(30) }, { key: '90', label: s.days(90) }]} />
      {q.loading && !d ? <LoadingPanel label={s.loading} /> : q.error && !d ? (
        <MessagePanel kind="error" icon="Alert" title={s.failTitle} body={errorText(q.error)} action={t.common.tryAgain} onAction={() => q.reload()} />
      ) : !d || d.totals.calls === 0 ? (
        <MessagePanel kind="empty" icon="Sparkle" title={s.none} body={s.note} />
      ) : (
        <>
          <Card style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
            <Stat label={s.calls} value={fmtNumber(d.totals.calls)} />
            <Stat label={s.errors} value={fmtNumber(d.totals.errors)} />
            <Stat label={s.tokens} value={fmtNumber(d.totals.total_tokens)} />
            <Stat label={s.cost} value={usd(Number(d.totals.est_cost_usd))} />
            <Stat label={s.input} value={fmtNumber(d.totals.input_tokens)} />
            <Stat label={s.output} value={fmtNumber(d.totals.output_tokens + d.totals.thinking_tokens)} />
            <Stat label={s.latency} value={d.totals.avg_latency_ms === null ? '—' : `${fmtNumber(d.totals.avg_latency_ms)} ms`} />
            <Stat label={s.ok} value={fmtNumber(d.totals.ok)} />
          </Card>
          {d.totals.unpriced_calls > 0 && <T variant="caption" tone="warning">{s.unpriced(d.totals.unpriced_calls)}</T>}

          <SectionHeader title={s.byFeature} />
          <Card padding={0} style={{ gap: 0 }}>
            {d.by_feature.map((f, i) => (
              <View key={f.feature}>{i > 0 && <Divider />}
                <Line left={s.feature[f.feature] ?? f.feature} sub={`${fmtNumber(f.total_tokens)} ${s.tokens.toLowerCase()} · ${fmtNumber(f.errors)} ${s.errors.toLowerCase()}`} right={fmtNumber(f.calls)} />
              </View>
            ))}
          </Card>

          <SectionHeader title={s.byModel} />
          <Card padding={0} style={{ gap: 0 }}>
            {d.by_model.map((m, i) => (
              <View key={`${m.provider}-${m.model}`}>{i > 0 && <Divider />}
                <Line left={m.model} sub={`${m.provider ?? '—'} · ${fmtNumber(m.calls)} · ${fmtNumber(m.total_tokens)} ${s.tokens.toLowerCase()}`}
                  right={m.est_cost_usd === null ? '—' : usd(Number(m.est_cost_usd))} />
              </View>
            ))}
          </Card>

          {d.errors.length > 0 && (
            <>
              <SectionHeader title={s.errorTypes} />
              <Card padding={0} style={{ gap: 0 }}>
                {d.errors.map((e, i) => (
                  <View key={e.status}>{i > 0 && <Divider />}<Line left={e.status} sub={day(e.last_at)} right={fmtNumber(e.count)} /></View>
                ))}
              </Card>
            </>
          )}

          <SectionHeader title={s.daily} />
          <Card padding={0} style={{ gap: 0 }}>
            {[...d.daily].reverse().map((x, i) => (
              <View key={x.day}>{i > 0 && <Divider />}
                <Line left={day(x.day)} sub={`${fmtNumber(x.total_tokens)} ${s.tokens.toLowerCase()} · ${fmtNumber(x.errors)} ${s.errors.toLowerCase()}`} right={fmtNumber(x.calls)} />
              </View>
            ))}
          </Card>
          <T variant="caption" tone="tertiary">{s.note}</T>
        </>
      )}
    </Screen>
  );
}
