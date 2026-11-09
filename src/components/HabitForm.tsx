import { t } from '@/i18n';
import { errorText } from '@/lib/errors';
import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { CATEGORIES } from '@/lib/categories';
import { level as levelInfo, LEVEL_ORDER } from '@/lib/levels';
import { useApp } from '@/providers/AppProvider';
import { Icon } from './Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { HabitInput } from '@/data/types';
import { haptics } from '@/lib/haptics';
import { formatTime, windowOf } from '@/lib/time';
import { color, radius, scheme } from '@/theme/tokens';
import { DayChips, ToggleRow } from './Blocks';
import { ACTIVITIES, detectActivity } from '@/shared/activity';
import { EvidenceChecklist } from './Evidence';
import { Button, IconButton } from './Button';
import { Tap } from './Tap';
import { Field } from './Field';
import { TimeField } from './TimeField';
import { T } from './Text';

const toDate = (hhmmss: string) => { const [h, m] = hhmmss.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d; };

interface Props {
  title: string;
  initial: HabitInput;
  submitLabel: string;
  onSubmit: (v: HabitInput) => Promise<void>;
  onClose: () => void;
  note?: string;
  /** Extra content under the save button (history, archive). */
  footer?: ReactNode;
}

/** Figma D2 — the new/edit habit sheet. Server validates everything again. */
export function HabitForm({ title, initial, submitLabel, onSubmit, onClose, note, footer }: Props) {
  const insets = useSafeAreaInsets();
  const { premium, profile } = useApp();
  const [v, setV] = useState<HabitInput>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof HabitInput>(k: K, val: HabitInput[K]) => setV((p) => ({ ...p, [k]: val }));
  const time = toDate(v.target_time);
  const w = windowOf(time);

  async function submit() {
    if (!v.title.trim()) { haptics.error(); return setError(t.form.errName); }
    if (v.weekdays.length === 0) { haptics.error(); return setError(t.form.errDays); }
    if (v.category === 'custom' && !v.custom_category?.trim()) { haptics.error(); return setError(t.form.errCustom); }
    setBusy(true); setError(null);
    try {
      await onSubmit({
        ...v, title: v.title.trim(), proof_hint: v.proof_hint?.trim() || null,
        custom_category: v.category === 'custom' ? v.custom_category?.trim() || null : null,
        description: v.description?.trim() || null, notes: v.notes?.trim() || null,
      });
      haptics.success();
    } catch (e) {
      haptics.error();
      setError(errorText(e) || t.form.errSave);
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.surface.card }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 18, maxWidth: 560, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <T variant="h2" style={{ flex: 1 }} accessibilityRole="header">{title}</T>
          <IconButton icon="Close" label={t.common.close} onPress={onClose} />
        </View>
        <Field label={t.form.commitment} value={v.title} onChangeText={(x) => set('title', x)} placeholder={t.form.commitmentPlaceholder} maxLength={80} returnKeyType="done" />
        <View style={{ gap: 8 }}>
          <T variant="overline" tone="tertiary">{t.form.category}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
            {CATEGORIES.map((c) => {
              const on = v.category === c.id;
              return (
                <Tap key={c.id} haptic="selection" onPress={() => set('category', c.id)} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={t.domain.category[c.id]}
                  style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.full, backgroundColor: on ? color.accent.primary : color.surface.glass, borderWidth: 1, borderColor: on ? color.accent.primary : color.border.hairline }}>
                  <T variant="caption" tone={on ? 'onLight' : 'secondary'}>{t.domain.category[c.id]}</T>
                </Tap>
              );
            })}
          </View>
          {v.category === 'custom' && (
            <Field label={t.form.customCategory} value={v.custom_category ?? ''} onChangeText={(x) => set('custom_category', x)} placeholder={t.form.customPlaceholder} maxLength={30} />
          )}
        </View>
        <Field label={t.form.description} value={v.description ?? ''} onChangeText={(x) => set('description', x)} placeholder={t.form.descriptionPlaceholder} multiline maxLength={500} style={{ minHeight: 64, textAlignVertical: 'top' }} />
        <View style={{ gap: 8 }}>
          <T variant="overline" tone="tertiary">{t.form.targetTime}</T>
          <TimeField value={v.target_time} onChange={(x) => set('target_time', x)} label={t.form.timeLabel} />
          <T variant="caption" tone="tertiary">{t.form.timeHelp(profile?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)}</T>
          <T variant="caption" tone="accent">{t.form.window(formatTime(w.opensAt), formatTime(w.closesAt))}</T>
        </View>
        <View style={{ gap: 8 }}>
          <T variant="overline" tone="tertiary">{t.form.days}</T>
          <DayChips value={v.weekdays} onChange={(d) => set('weekdays', d)} />
        </View>
        <View style={{ gap: 8 }}>
          <Field label={t.form.proof} value={v.proof_hint ?? ''} onChangeText={(x) => set('proof_hint', x)} placeholder={t.form.proofPlaceholder} multiline maxLength={280} style={{ minHeight: 84, textAlignVertical: 'top' }} />
          <T variant="caption" tone="tertiary">{t.form.proofHelp}</T>
        </View>
        <View style={{ gap: 8 }}>
          <T variant="overline" tone="tertiary">{t.form.level}</T>
          <View style={{ gap: 8 }} accessibilityRole="radiogroup">
            {LEVEL_ORDER.map((lv) => {
              const on = v.verification_level === lv;
              const locked = lv !== 'standard' && !premium;
              return (
                <Tap key={lv} haptic="selection" onPress={() => (locked ? router.push('/paywall') : set('verification_level', lv))}
                  accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${levelInfo(lv).label}: ${levelInfo(lv).summary}${locked ? ` ${t.common.premium}.` : ''}`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.md, borderWidth: 1,
                    borderColor: on ? color.text.primary : color.border.hairline, backgroundColor: on ? color.surface.glassStrong : color.surface.glass }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <T variant="bodyStrong" tone={locked ? 'secondary' : 'primary'}>{levelInfo(lv).label}</T>
                    <T variant="caption" tone="tertiary">{levelInfo(lv).summary}</T>
                  </View>
                  {locked ? <><Icon name="Lock" size={14} tint={color.icon.secondary} /><T variant="caption" tone="secondary">{t.common.premium}</T></>
                    : on ? <Icon name="Check" size={18} tint={color.text.primary} /> : null}
                </Tap>
              );
            })}
          </View>
          <T variant="caption" tone="tertiary">{t.form.levelHelp}</T>
        </View>
        <View style={{ gap: 8 }}>
          <T variant="overline" tone="tertiary">{t.form.activity}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
            {([null, ...ACTIVITIES] as const).map((a) => {
              const on = (v.activity ?? null) === a;
              const label = a === null ? t.domain.activity.auto : t.domain.activity[a];
              return (
                <Tap key={a ?? 'auto'} haptic="selection" onPress={() => set('activity', a)} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={label}
                  style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.full, backgroundColor: on ? color.accent.primary : color.surface.glass, borderWidth: 1, borderColor: on ? color.accent.primary : color.border.hairline }}>
                  <T variant="caption" tone={on ? 'onLight' : 'secondary'}>{label}</T>
                </Tap>
              );
            })}
          </View>
          {!v.activity && <T variant="caption" tone="tertiary">{t.proof.activityAuto(t.domain.activity[detectActivity(v.title, v.category, v.proof_hint)])}</T>}
          <EvidenceChecklist activity={v.activity ?? detectActivity(v.title, v.category, v.proof_hint)} level={premium ? v.verification_level : 'standard'} />
        </View>
        <View style={{ gap: 8 }}>
          <Field label={t.form.notes} value={v.notes ?? ''} onChangeText={(x) => set('notes', x)} placeholder={t.form.notesPlaceholder} multiline maxLength={1000} style={{ minHeight: 64, textAlignVertical: 'top' }} />
        </View>
        <ToggleRow title={t.form.reminder} subtitle={v.reminder_minutes > 0 ? t.form.reminderOn(v.reminder_minutes) : t.common.off} value={v.reminder_minutes > 0} onChange={(on) => set('reminder_minutes', on ? 10 : 0)} />
        <ToggleRow title={t.form.active} subtitle={t.form.activeHelp} value={v.is_active} onChange={(on) => set('is_active', on)} />
        {note && <T variant="caption" tone="tertiary">{note}</T>}
        {error && <View style={{ padding: 14, borderRadius: radius.md, backgroundColor: color.status.dangerSoft }} accessibilityLiveRegion="assertive"><T variant="bodySmall" tone="danger">{error}</T></View>}
        <Button label={submitLabel} onPress={submit} loading={busy} />
        {footer}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
