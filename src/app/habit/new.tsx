import { router } from 'expo-router';
import { HabitForm } from '@/components/HabitForm';
import { api } from '@/data';

const nextRoundHour = () => {
  const d = new Date(Date.now() + 60 * 60_000);
  return `${String(d.getHours()).padStart(2, '0')}:00:00`;
};

export default function NewHabit() {
  return (
    <HabitForm
      title="New habit"
      submitLabel="Create habit"
      initial={{ title: '', proof_hint: '', target_time: nextRoundHour(), weekdays: [1, 2, 3, 4, 5], is_active: true, reminder_minutes: 10 }}
      onSubmit={async (v) => { await api.createHabit(v); router.back(); }}
      onClose={() => router.back()}
      note="Today’s window is only created if it hasn’t closed yet."
    />
  );
}
