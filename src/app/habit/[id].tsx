import { router, useLocalSearchParams } from 'expo-router';
import { t } from '@/i18n';
import { ActivityIndicator, View } from 'react-native';
import { Badge, type Tone } from '@/components/Badge';
import { SectionHeader } from '@/components/Blocks';
import { Button } from '@/components/Button';
import { Card, Divider } from '@/components/Card';
import { HabitForm } from '@/components/HabitForm';
import { MessagePanel } from '@/components/StatePanel';
import { T } from '@/components/Text';
import { api, type Target } from '@/data';
import { confirmDestructive } from '@/lib/dialog';
import { useLoad } from '@/lib/hooks';
import { dayLabel, formatTime } from '@/lib/time';
import { useApp } from '@/providers/AppProvider';
import { color } from '@/theme/tokens';

const TONE: Record<Target['status'], Tone> = { pending: 'neutral', verified: 'success', rejected: 'danger', missed: 'danger', excused: 'neutral' };

export default function EditHabit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useApp();
  const tz = profile?.timezone;
  const q = useLoad(async () => {
    const [habit, history] = await Promise.all([api.getHabit(id), api.getHabitHistory(id, 14)]);
    return { habit, history };
  }, [id]);
  if (q.loading) return <View style={{ flex: 1, backgroundColor: color.surface.card, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={color.text.secondary} /></View>;
  const h = q.data?.habit;
  if (!h) {
    return (
      <View style={{ flex: 1, backgroundColor: color.surface.card, padding: 20, justifyContent: 'center' }}>
        <MessagePanel kind="error" icon="Alert" title={t.form.notFound} body={t.form.notFoundBody} action={t.common.close} onAction={() => router.back()} />
      </View>
    );
  }
  const archived = !!h.archived_at;

  async function archive() {
    const ok = await confirmDestructive(t.form.archiveQ, t.form.archiveBody, t.form.archiveAction);
    if (!ok) return;
    await api.archiveHabit(h!.id);
    router.back();
  }

  return (
    <HabitForm
      title={archived ? t.form.archivedTitle : t.form.editTitle}
      submitLabel={t.common.saveChanges}
      initial={{ title: h.title, proof_hint: h.proof_hint, target_time: h.target_time, weekdays: h.weekdays, is_active: h.is_active, reminder_minutes: h.reminder_minutes,
        category: h.category, custom_category: h.custom_category, description: h.description, notes: h.notes, verification_level: h.verification_level, activity: h.activity ?? null }}
      onSubmit={async (v) => { await api.updateHabit(h.id, v); router.back(); }}
      onClose={() => router.back()}
      note={t.form.editNote}
      footer={
        <View style={{ gap: 12, marginTop: 8 }}>
          <SectionHeader title={t.form.history} />
          {(q.data?.history.length ?? 0) === 0 ? (
            <T variant="bodySmall" tone="tertiary">{t.form.historyEmpty}</T>
          ) : (
            <Card padding={0} style={{ gap: 0 }}>
              {q.data!.history.map((x, i) => (
                <View key={x.id}>
                  {i > 0 && <Divider />}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}>
                    <T variant="bodySmall" style={{ flex: 1 }}>{dayLabel(x.due_at, tz)} · {formatTime(x.due_at, tz)}</T>
                    <Badge tone={TONE[x.status]} label={t.domain.target[x.status]} />
                  </View>
                </View>
              ))}
            </Card>
          )}
          {!archived && <Button kind="danger" label={t.form.archive} icon="Trash" onPress={archive} />}
          <T variant="caption" tone="tertiary">{t.form.archiveNote}</T>
        </View>
      }
    />
  );
}
