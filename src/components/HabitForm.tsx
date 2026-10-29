import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { HabitInput } from '@/data/types';
import { haptics } from '@/lib/haptics';
import { formatTime, windowOf } from '@/lib/time';
import { color, radius } from '@/theme/tokens';
import { DayChips, ToggleRow } from './Blocks';
import { Button, IconButton } from './Button';
import { Field } from './Field';
import { T } from './Text';

const toDate = (hhmmss: string) => { const [h, m] = hhmmss.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d; };
const toHHMM = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;

interface Props {
  title: string;
  initial: HabitInput;
  submitLabel: string;
  onSubmit: (v: HabitInput) => Promise<void>;
  onClose: () => void;
  note?: string;
}

/** Figma D2 — the new/edit habit sheet. Server validates everything again. */
export function HabitForm({ title, initial, submitLabel, onSubmit, onClose, note }: Props) {
  const insets = useSafeAreaInsets();
  const [v, setV] = useState<HabitInput>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof HabitInput>(k: K, val: HabitInput[K]) => setV((p) => ({ ...p, [k]: val }));
  const time = toDate(v.target_time);
  const w = windowOf(time);

  async function submit() {
    if (!v.title.trim()) { haptics.error(); return setError('Give the habit a name.'); }
    if (v.weekdays.length === 0) { haptics.error(); return setError('Pick at least one day.'); }
    setBusy(true); setError(null);
    try {
      await onSubmit({ ...v, title: v.title.trim(), proof_hint: v.proof_hint?.trim() || null });
      haptics.success();
    } catch (e) {
      haptics.error();
      setError((e as Error).message || 'Couldn’t save. Try again.');
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.surface.card }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 18, maxWidth: 560, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <T variant="h2" style={{ flex: 1 }} accessibilityRole="header">{title}</T>
          <IconButton icon="Close" label="Close" onPress={onClose} />
        </View>
        <Field label="Habit" value={v.title} onChangeText={(t) => set('title', t)} placeholder="e.g. Cold shower — 3 min" maxLength={80} returnKeyType="done" />
        <View style={{ gap: 8 }}>
          <T variant="overline" tone="tertiary">Target time</T>
          {Platform.OS === 'web' ? (
            <Field label="HH:MM" value={v.target_time.slice(0, 5)} onChangeText={(t) => /^\d{2}:\d{2}$/.test(t) && set('target_time', `${t}:00`)} />
          ) : (
            <View style={{ backgroundColor: color.surface.inset, borderRadius: radius.md, borderWidth: 1, borderColor: color.border.hairline, alignItems: 'center' }}>
              <DateTimePicker value={time} mode="time" display="spinner" minuteInterval={5} themeVariant="dark" textColor={color.text.primary} accentColor={color.accent.glow}
                onChange={(_e, d) => { if (d) { haptics.selection(); set('target_time', toHHMM(d)); } }} style={{ height: 150, alignSelf: 'stretch' }} />
            </View>
          )}
          <T variant="caption" tone="accent">Proof window {formatTime(w.opensAt)} – {formatTime(w.closesAt)} · your local time</T>
        </View>
        <View style={{ gap: 8 }}>
          <T variant="overline" tone="tertiary">Days</T>
          <DayChips value={v.weekdays} onChange={(d) => set('weekdays', d)} />
        </View>
        <View style={{ gap: 8 }}>
          <Field label="What counts as proof" value={v.proof_hint ?? ''} onChangeText={(t) => set('proof_hint', t)} placeholder="Me under the running shower, timer visible on my phone." multiline maxLength={280} style={{ minHeight: 84, textAlignVertical: 'top' }} />
          <T variant="caption" tone="tertiary">Specific proof makes the AI verdict fairer and faster.</T>
        </View>
        <ToggleRow title="Reminder" subtitle={v.reminder_minutes > 0 ? `${v.reminder_minutes} minutes before the window opens` : 'Off'} value={v.reminder_minutes > 0} onChange={(on) => set('reminder_minutes', on ? 10 : 0)} />
        <ToggleRow title="Active" subtitle="Inactive habits keep their history but score nothing" value={v.is_active} onChange={(on) => set('is_active', on)} />
        {note && <T variant="caption" tone="tertiary">{note}</T>}
        {error && <View style={{ padding: 14, borderRadius: radius.md, backgroundColor: color.status.dangerSoft }} accessibilityLiveRegion="assertive"><T variant="bodySmall" tone="danger">{error}</T></View>}
        <Button label={submitLabel} onPress={submit} loading={busy} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
