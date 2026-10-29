import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { IconTile, ToggleRow } from '@/components/Blocks';
import { Button, IconButton } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { T } from '@/components/Text';
import { api } from '@/data';
import { haptics } from '@/lib/haptics';
import { useLoad } from '@/lib/hooks';
import { color } from '@/theme/tokens';

/** Figma I2 — concrete changes that make the next window easier to win. Every toggle really changes the habit. */
export default function Comeback() {
  const { habitId } = useLocalSearchParams<{ habitId: string }>();
  const q = useLoad(() => api.getHabit(habitId), [habitId]);
  const h = q.data;
  const [earlierChoice, setEarlier] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const earlier = earlierChoice ?? (h ? h.reminder_minutes >= 30 : false);

  if (q.loading || !h) return <View style={{ flex: 1, backgroundColor: color.bg.base, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={color.text.secondary} /></View>;
  const goal = Math.max(h.longest_streak, 7);
  const dots = Math.min(goal, 14);

  async function commit() {
    setBusy(true);
    try {
      await api.updateHabit(h!.id, { reminder_minutes: earlier ? 30 : 10 });
      haptics.success();
      router.back();
    } catch {
      haptics.error();
      setBusy(false);
    }
  }

  return (
    <Screen glow="violet" footer={<>
      <Button label="Commit to the plan" onPress={commit} loading={busy} />
      <T variant="caption" tone="tertiary" align="center">Changes apply from the next window. Scores already recorded don’t change.</T>
    </>}>
      <View style={{ flexDirection: 'row' }}><IconButton icon="ChevronLeft" label="Back" onPress={() => router.back()} /></View>
      <View style={{ gap: 6 }}>
        <T variant="overline" tone="accent">Recovery</T>
        <T variant="h1" accessibilityRole="header">Comeback plan</T>
        <T tone="secondary">{h.title}: rebuild to {goal} days. Start with the next window.</T>
      </View>
      <Card style={{ padding: 18 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <T variant="bodyStrong">Back to {goal} days</T>
          <T variant="caption" tone="tertiary">{h.current_streak} / {goal}</T>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} accessible accessibilityLabel={`${h.current_streak} of ${goal} days rebuilt`}>
          {Array.from({ length: dots }).map((_, i) => (
            <View key={i} style={{ width: 20, height: 20, borderRadius: 7, borderWidth: 1, backgroundColor: i < h.current_streak ? color.accent.primary : i === h.current_streak ? color.accent.soft : color.surface.glass, borderColor: i === h.current_streak ? color.border.accent : color.border.hairline }} />
          ))}
        </View>
      </Card>
      <Card style={{ padding: 16 }}>
        <ToggleRow title="Earlier reminder" subtitle={earlier ? '30 minutes before the window opens' : `Now ${h.reminder_minutes || 'no'} min before — switch to 30`} value={earlier} onChange={setEarlier}
          icon={<IconTile icon="Bell" size={40} bg={color.accent.soft} tint={color.accent.glow} />} />
      </Card>
      <Card tone="ai" style={{ padding: 16, flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <IconTile icon="Sparkle" size={40} bg={color.ai.soft} tint={color.ai.accent} />
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="bodyStrong">Sharpen what counts as proof</T>
          <T variant="caption" tone="tertiary" numberOfLines={3}>{h.proof_hint ? `Now: “${h.proof_hint}”` : 'No description yet — the AI judges more fairly when it knows what to look for.'}</T>
        </View>
        <Button kind="glass" label="Edit" onPress={() => router.push({ pathname: '/habit/[id]', params: { id: h.id } })} />
      </Card>
    </Screen>
  );
}
