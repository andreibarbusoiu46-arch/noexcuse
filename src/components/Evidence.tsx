import { View } from 'react-native';
import type { Level, ProofAnalysis } from '@/data/types';
import { lang, t } from '@/i18n';
import { requirementsFor, type Activity } from '@/shared/activity';
import { color, radius } from '@/theme/tokens';
import { Icon } from './Icon';
import { T } from './Text';

type Row = { id: string; label: string; kind: 'live' | 'screenshot'; required: boolean; state: 'todo' | 'done' | 'missing'; note?: string };

function Rows({ rows }: { rows: Row[] }) {
  return (
    <View style={{ gap: 10 }}>
      {rows.map((r) => {
        const icon = r.state === 'done' ? 'Check' : r.kind === 'live' ? 'Camera' : 'Doc';
        const tint = r.state === 'done' ? color.status.success : r.state === 'missing' ? color.status.warning : color.icon.secondary;
        const status = r.state === 'done' ? t.proof.reqOk : r.state === 'missing' ? t.proof.reqMissing : null;
        return (
          <View key={r.id} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }} accessible
            accessibilityLabel={`${r.label}. ${r.kind === 'live' ? t.proof.reqLive : t.proof.reqShot}${r.required ? '' : `, ${t.proof.reqOptional}`}${status ? `. ${status}` : ''}`}>
            <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
              backgroundColor: r.state === 'done' ? color.status.successSoft : r.state === 'missing' ? color.status.warningSoft : color.surface.glass }}>
              <Icon name={icon} size={14} tint={tint} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <T variant="bodySmall" tone={r.state === 'missing' ? 'warning' : 'primary'}>{r.label}</T>
              <T variant="caption" tone="tertiary">
                {r.kind === 'live' ? t.proof.reqLive : t.proof.reqShot}{r.required ? '' : ` · ${t.proof.reqOptional}`}{status ? ` · ${status}` : ''}
              </T>
              {r.note ? <T variant="caption" tone="secondary">{r.note}</T> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const box = { alignSelf: 'stretch' as const, padding: 16, gap: 12, borderRadius: radius.lg, backgroundColor: color.surface.card, borderWidth: 1, borderColor: color.border.hairline };

/** What this commitment needs as evidence at this level. `have` ticks items off as photos are added. */
export function EvidenceChecklist({ activity, level, have }: { activity: Activity; level: Level; have?: { live: number; screenshots: number } }) {
  const reqs = requirementsFor(activity, level);
  // The n-th requirement of a kind is ticked when at least n photos of that kind were added.
  const rows: Row[] = reqs.map((q, i) => {
    const nth = reqs.slice(0, i + 1).filter((x) => x.kind === q.kind).length;
    const done = !!have && (q.kind === 'live' ? have.live : have.screenshots) >= nth;
    return { id: q.id, label: q.label[lang()], kind: q.kind, required: q.required, state: done ? 'done' : 'todo' };
  });
  return (
    <View style={box}>
      <T variant="overline" tone="tertiary">{t.proof.evidenceNeeded} · {t.domain.activity[activity]}</T>
      <Rows rows={rows} />
    </View>
  );
}

/** The AI's per-requirement and per-image analysis of a submission. */
export function AnalysisPanel({ a }: { a: ProofAnalysis }) {
  const rows: Row[] = a.requirements.map((q) => ({
    id: q.id, label: q.label, kind: q.kind, required: q.required,
    state: q.satisfied ? 'done' : q.required ? 'missing' : 'todo', note: q.note || undefined,
  }));
  return (
    <View style={{ alignSelf: 'stretch', gap: 12 }}>
      {a.next_action ? (
        <View style={{ padding: 16, borderRadius: radius.lg, gap: 4, backgroundColor: color.status.warningSoft }} accessible accessibilityLiveRegion="polite">
          <T variant="overline" tone="warning">{t.proof.nextAction}</T>
          <T variant="bodySmall">{a.next_action}</T>
        </View>
      ) : null}
      <View style={box}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <T variant="overline" tone="tertiary" style={{ flex: 1 }}>{t.proof.evidenceReview}</T>
          <T variant="caption" tone="tertiary">{t.proof.confidence(Math.round(a.confidence * 100))}</T>
        </View>
        <Rows rows={rows} />
      </View>
      {a.evidence.length > 0 && (
        <View style={box}>
          <T variant="overline" tone="tertiary">{t.proof.perImage}</T>
          {a.evidence.map((e) => (
            <View key={e.image} style={{ gap: 2 }}>
              <T variant="caption" tone={e.relevant ? 'success' : 'warning'}>
                {t.proof.imageN(e.image)} · {e.kind === 'live' ? t.proof.live : t.proof.screenshot}
              </T>
              <T variant="bodySmall" tone="secondary">{e.shows}</T>
              {e.concerns ? <T variant="caption" tone="warning">{e.concerns}</T> : null}
            </View>
          ))}
          {a.consistency ? <T variant="caption" tone="tertiary">{t.proof.consistency}: {a.consistency}</T> : null}
        </View>
      )}
    </View>
  );
}
