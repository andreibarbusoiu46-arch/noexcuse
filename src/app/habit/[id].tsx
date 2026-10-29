import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { HabitForm } from '@/components/HabitForm';
import { MessagePanel } from '@/components/StatePanel';
import { api } from '@/data';
import { useLoad } from '@/lib/hooks';
import { color } from '@/theme/tokens';

export default function EditHabit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useLoad(() => api.getHabit(id), [id]);
  if (q.loading) return <View style={{ flex: 1, backgroundColor: color.surface.card, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={color.text.secondary} /></View>;
  const h = q.data;
  if (!h) {
    return (
      <View style={{ flex: 1, backgroundColor: color.surface.card, padding: 20, justifyContent: 'center' }}>
        <MessagePanel kind="error" icon="Alert" title="Habit not found." body="It may have been removed on another device." action="Close" onAction={() => router.back()} />
      </View>
    );
  }
  return (
    <HabitForm
      title="Edit habit"
      submitLabel="Save changes"
      initial={{ title: h.title, proof_hint: h.proof_hint, target_time: h.target_time, weekdays: h.weekdays, is_active: h.is_active, reminder_minutes: h.reminder_minutes }}
      onSubmit={async (v) => { await api.updateHabit(h.id, v); router.back(); }}
      onClose={() => router.back()}
      note="Time and day changes apply to windows that haven’t opened yet. Settled scores never change. Habits can be paused, not deleted, so your record stays honest."
    />
  );
}
