import { router, useLocalSearchParams } from 'expo-router';
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

const STATUS: Record<Target['status'], { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'neutral' },
  verified: { label: 'Verified', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  missed: { label: 'Missed', tone: 'danger' },
  excused: { label: 'Excused', tone: 'neutral' },
};

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
        <MessagePanel kind="error" icon="Alert" title="Commitment not found." body="It may have been changed on another device." action="Close" onAction={() => router.back()} />
      </View>
    );
  }
  const archived = !!h.archived_at;

  async function archive() {
    const ok = await confirmDestructive('Archive this commitment?', 'It stops scheduling new windows. Its history, points and streak record stay on your account. Archived commitments can’t be restored.', 'Archive');
    if (!ok) return;
    await api.archiveHabit(h!.id);
    router.back();
  }

  return (
    <HabitForm
      title={archived ? 'Archived commitment' : 'Edit commitment'}
      submitLabel="Save changes"
      initial={{ title: h.title, proof_hint: h.proof_hint, target_time: h.target_time, weekdays: h.weekdays, is_active: h.is_active, reminder_minutes: h.reminder_minutes,
        category: h.category, custom_category: h.custom_category, description: h.description, notes: h.notes }}
      onSubmit={async (v) => { await api.updateHabit(h.id, v); router.back(); }}
      onClose={() => router.back()}
      note="Time and day changes apply to windows that haven’t opened yet. Settled scores never change."
      footer={
        <View style={{ gap: 12, marginTop: 8 }}>
          <SectionHeader title="Completion history" />
          {(q.data?.history.length ?? 0) === 0 ? (
            <T variant="bodySmall" tone="tertiary">No windows yet. The first one appears on the next scheduled day.</T>
          ) : (
            <Card padding={0} style={{ gap: 0 }}>
              {q.data!.history.map((t, i) => (
                <View key={t.id}>
                  {i > 0 && <Divider />}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}>
                    <T variant="bodySmall" style={{ flex: 1 }}>{dayLabel(t.due_at, tz)} · {formatTime(t.due_at, tz)}</T>
                    <Badge tone={STATUS[t.status].tone} label={STATUS[t.status].label} />
                  </View>
                </View>
              ))}
            </Card>
          )}
          {!archived && <Button kind="danger" label="Archive commitment" icon="Trash" onPress={archive} />}
          <T variant="caption" tone="tertiary">Commitments are archived, never deleted, so your record and Discipline Score stay honest.</T>
        </View>
      }
    />
  );
}
