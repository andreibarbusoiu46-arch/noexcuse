// Building blocks shared by the challenge screens: badges, plan preview, time stepper, calendar.
import { ScrollView, View } from 'react-native';
import { Badge, type Tone } from '@/components/Badge';
import { DayChips, Segmented } from '@/components/Blocks';
import { Card, Divider } from '@/components/Card';
import { Field } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { Tap } from '@/components/Tap';
import { T } from '@/components/Text';
import type { ChallengeDayState, ChallengeKind, ChallengePlan, Difficulty, PlanObjective } from '@/data/types';
import { t } from '@/i18n';
import { level } from '@/lib/levels';
import { color } from '@/theme/tokens';

const DIFF_TONE: Record<Difficulty, Tone> = { beginner: 'neutral', intermediate: 'accent', advanced: 'warning', elite: 'danger' };

export function KindBadges({ kind, difficulty }: { kind: ChallengeKind; difficulty: Difficulty }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
      <Badge tone="neutral" label={t.domain.kind[kind]} />
      {kind !== 'elite' && <Badge tone={DIFF_TONE[difficulty]} label={t.domain.difficulty[difficulty]} />}
    </View>
  );
}

/** Points paid once if the plan is completed — the same formula the server uses, counted from tomorrow. */
export function estimateBonus(plan: Pick<ChallengePlan, 'duration_days' | 'difficulty' | 'objectives'>, perDay: number): { days: number; bonus: number } {
  const wd = new Set(plan.objectives.flatMap((o) => o.weekdays));
  let days = 0;
  const d = new Date();
  for (let i = 1; i <= plan.duration_days; i++) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
    if (wd.has(((x.getDay() + 6) % 7) + 1)) days++;
  }
  const pct = plan.difficulty === 'advanced' ? 150 : plan.difficulty === 'elite' ? 200 : 100;
  return { days, bonus: Math.floor((days * perDay * pct) / 100) };
}

const pad = (n: number) => String(n).padStart(2, '0');
function shift(time: string, mins: number) {
  const [h, m] = time.split(':').map(Number);
  const total = (((h * 60 + m + mins) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** A whole number with − / + buttons. */
export function NumberStepper({ value, min, max, onChange, format = String, label }: { value: number; min: number; max: number; onChange: (n: number) => void; format?: (n: number) => string; label: string }) {
  const btn = (icon: 'Minus' | 'Plus', next: number, a11y: string) => (
    <Tap haptic="selection" disabled={next < min || next > max} onPress={() => onChange(next)} accessibilityLabel={a11y}
      style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', opacity: next < min || next > max ? 0.35 : 1, backgroundColor: color.surface.glass, borderWidth: 1, borderColor: color.border.hairline }}>
      <Icon name={icon} size={16} tint={color.icon.secondary} />
    </Tap>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <T variant="bodyStrong" style={{ flex: 1 }}>{label}</T>
      {btn('Minus', value - 1, t.ch.less(label))}
      <T variant="bodyStrong" style={{ minWidth: 64, textAlign: 'center' }} accessibilityLiveRegion="polite">{format(value)}</T>
      {btn('Plus', value + 1, t.ch.more(label))}
    </View>
  );
}

/** Time in 15-minute steps. Works the same on iOS and the web. */
export function TimeStepper({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const btn = (icon: 'Minus' | 'Plus', delta: number, label: string) => (
    <Tap haptic="selection" onPress={() => onChange(shift(value, delta))} accessibilityLabel={label}
      style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface.glass, borderWidth: 1, borderColor: color.border.hairline }}>
      <Icon name={icon} size={16} tint={color.icon.secondary} />
    </Tap>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} accessibilityLabel={t.ch.timeA11y(value)}>
      {btn('Minus', -15, t.ch.earlier)}
      <T variant="bodyStrong" style={{ minWidth: 52, textAlign: 'center', fontVariant: ['tabular-nums'] }}>{value.slice(0, 5)}</T>
      {btn('Plus', 15, t.ch.later)}
    </View>
  );
}

type Edit = 'none' | 'schedule' | 'all';

/** A challenge plan before it starts: what it asks, what counts as evidence, and the objectives. */
export function PlanView({ plan, edit = 'none', onChange, perDay }: { plan: ChallengePlan; edit?: Edit; onChange?: (p: ChallengePlan) => void; perDay: number }) {
  const setObj = (i: number, o: Partial<PlanObjective>) => onChange?.({ ...plan, objectives: plan.objectives.map((x, k) => (k === i ? { ...x, ...o } : x)) });
  const est = estimateBonus(plan, perDay);
  return (
    <View style={{ gap: 16 }}>
      <Card style={{ gap: 14 }}>
        <KindBadges kind={plan.kind} difficulty={plan.difficulty} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Fact label={t.ch.length} value={t.common.days(plan.duration_days)} />
          <Fact label={t.ch.misses} value={plan.allowed_misses === 0 ? t.ch.none : String(plan.allowed_misses)} />
          <Fact label={t.ch.bonus} value={`+${est.bonus}`} />
        </View>
        {!!plan.description && <T tone="secondary">{plan.description}</T>}
        {!!plan.progression && <T variant="caption" tone="secondary">{plan.progression}</T>}
      </Card>

      <Card style={{ gap: 12 }}>
        <Row icon="Target" title={t.ch.rules} body={plan.rules || t.ch.rulesDefault(plan.allowed_misses)} />
        <Divider />
        <Row icon="Camera" title={t.ch.evidence} body={plan.evidence || t.ch.evidenceDefault} />
        <Divider />
        <Row icon="Shield" title={t.ch.fair} body={t.ch.fairBody} />
      </Card>

      <View style={{ gap: 10 }}>
        <T variant="overline" tone="tertiary">{t.ch.objectivesN(plan.objectives.length)}</T>
        {plan.objectives.map((o, i) => (
          <Card key={i} style={{ gap: 12 }}>
            {edit === 'all' ? (
              <View style={{ gap: 10 }}>
                <Field label={t.ch.objTitle} value={o.title} maxLength={80} onChangeText={(v) => setObj(i, { title: v })} />
                <Field label={t.ch.objHint} value={o.proof_hint ?? ''} maxLength={280} multiline onChangeText={(v) => setObj(i, { proof_hint: v })} placeholder={t.ch.objHintPlaceholder} />
              </View>
            ) : (
              <View style={{ gap: 4 }}>
                <T variant="bodyStrong">{o.title}</T>
                {!!o.proof_hint && <T variant="caption" tone="secondary">{t.ch.proofOf(o.proof_hint)}</T>}
              </View>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              {edit === 'all'
                ? <View style={{ flexBasis: '100%' }}><Segmented value={o.verification_level} onChange={(v) => setObj(i, { verification_level: v })}
                    options={(['standard', 'strict', 'elite'] as const).map((k) => ({ key: k, label: level(k).label }))} /></View>
                : <Badge tone="accent" label={t.domain.levelBadge(level(o.verification_level).label)} />}
              {edit === 'none' ? <T variant="caption" tone="secondary">{o.time.slice(0, 5)} · {dayList(o.weekdays)}</T>
                : <TimeStepper value={o.time} onChange={(v) => setObj(i, { time: v })} />}
            </View>
            {edit !== 'none' && <DayChips value={o.weekdays} onChange={(v) => setObj(i, { weekdays: v })} />}
            {edit === 'all' && plan.objectives.length > 1 && (
              <Tap onPress={() => onChange?.({ ...plan, objectives: plan.objectives.filter((_, k) => k !== i) })} accessibilityLabel={t.ch.removeObj}>
                <T variant="caption" tone="danger">{t.ch.removeObj}</T>
              </Tap>
            )}
          </Card>
        ))}
      </View>
    </View>
  );
}

export function dayList(wd: number[]) {
  if (wd.length === 7) return t.ch.everyDay;
  if (wd.length === 5 && [1, 2, 3, 4, 5].every((d) => wd.includes(d))) return t.ch.weekdays;
  return wd.map((d) => t.common.weekdayShort[d]).join(' ');
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 2, padding: 12, borderRadius: 14, backgroundColor: color.surface.glass, borderWidth: 1, borderColor: color.border.hairline }}>
      <T variant="overline" tone="tertiary">{label}</T>
      <T variant="h3">{value}</T>
    </View>
  );
}

function Row({ icon, title, body }: { icon: 'Target' | 'Camera' | 'Shield'; title: string; body: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <Icon name={icon} size={18} tint={color.icon.secondary} />
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="bodyStrong">{title}</T>
        <T variant="caption" tone="secondary">{body}</T>
      </View>
    </View>
  );
}

// Monochrome like the rest of the app: kept days are solid, lost days are struck through.
const CELL: Record<ChallengeDayState, { bg: () => string; fg: 'onLight' | 'secondary' | 'tertiary' | 'primary' }> = {
  done: { bg: () => color.accent.primary, fg: 'onLight' },
  lost: { bg: () => color.status.dangerSoft, fg: 'tertiary' },
  today: { bg: () => color.surface.glassStrong, fg: 'primary' },
  upcoming: { bg: () => color.surface.glass, fg: 'tertiary' },
};

/** One square per challenge day, Monday-first rows. */
export function ChallengeCalendar({ days }: { days: { day: string; state: ChallengeDayState; targets: number }[] }) {
  if (!days.length) return null;
  const first = new Date(`${days[0].day}T12:00:00`);
  const lead = (first.getDay() + 6) % 7;
  const cells: (typeof days[number] | null)[] = [...Array(lead).fill(null), ...days];
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[1, 2, 3, 4, 5, 6, 7].map((d) => <T key={d} variant="tab" tone="tertiary" style={{ flex: 1, textAlign: 'center' }}>{t.common.weekdayLetter[d]}</T>)}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -3 }}>
        {cells.map((c, i) => (
          <View key={i} style={{ width: `${100 / 7}%`, padding: 3 }}>
            {c && (
              <View accessibilityLabel={t.ch.dayA11y(c.day, t.ch.dayState[c.targets ? c.state : 'rest'])}
                style={{ aspectRatio: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center', opacity: c.targets ? 1 : 0.35,
                  backgroundColor: CELL[c.state].bg(), borderWidth: c.state === 'today' ? 1.5 : c.state === 'lost' ? 1 : 0, borderColor: c.state === 'today' ? color.border.accent : color.border.hairline }}>
                <T variant="tab" tone={CELL[c.state].fg} style={c.state === 'lost' ? { textDecorationLine: 'line-through' } : undefined}>{Number(c.day.slice(8))}</T>
              </View>
            )}
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 14, flexWrap: 'wrap' }}>
        {(['done', 'lost', 'upcoming'] as const).map((s) => (
          <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: CELL[s].bg(), borderWidth: 1, borderColor: color.border.hairline }} />
            <T variant="caption" tone="tertiary">{t.ch.dayState[s]}</T>
          </View>
        ))}
      </View>
    </View>
  );
}

/** One choice from a short list, as a scrollable row of pills. */
export function ChoiceChips<K extends string | number>({ label, value, options, name, onChange }: { label: string; value: K; options: readonly K[]; name: (k: K) => string; onChange: (k: K) => void }) {
  return (
    <View style={{ gap: 8 }}>
      <T variant="overline" tone="tertiary">{label}</T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {options.map((k) => {
          const on = k === value;
          return (
            <Tap key={String(k)} haptic="selection" dim={false} onPress={() => onChange(k)} accessibilityRole="radio" accessibilityState={{ selected: on }}
              style={{ paddingHorizontal: 14, height: 34, borderRadius: 17, justifyContent: 'center', backgroundColor: on ? color.accent.primary : color.surface.glass, borderWidth: 1, borderColor: on ? color.border.strong : color.border.hairline }}>
              <T variant="caption" tone={on ? 'onLight' : 'secondary'}>{name(k)}</T>
            </Tap>
          );
        })}
      </ScrollView>
    </View>
  );
}
