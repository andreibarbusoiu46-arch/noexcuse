import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { api } from '@/data';
import { t } from '@/i18n';
import { useLoad } from '@/lib/hooks';
import { color, radius } from '@/theme/tokens';
import { Icon, type IconName } from './Icon';
import { Tap } from './Tap';
import { T } from './Text';

type Step = { key: string; icon: IconName; done: boolean; go?: string };

/**
 * First steps after sign-up, ticked from the account's real data (not from taps): a commitment, a challenge,
 * a live proof, an AI-verified result, points in the Arena. Hidden when everything is done or dismissed.
 */
export function GettingStarted({ userId }: { userId: string }) {
  const key = `noexcuse:started-dismissed:${userId}`;
  const [hidden, setHidden] = useState<boolean | null>(null);
  useEffect(() => { AsyncStorage.getItem(key).then((v) => setHidden(v === '1')).catch(() => setHidden(false)); }, [key]);
  const q = useLoad(() => api.getStarted());
  const d = q.data;
  if (hidden !== false || !d) return null;
  const g = t.started;
  const steps: Step[] = [
    { key: 'habit', icon: 'Plus', done: d.habits > 0, go: '/habit/new' },
    { key: 'challenge', icon: 'Target', done: d.challenges > 0, go: '/challenges' },
    { key: 'proof', icon: 'Camera', done: d.proofs > 0 },
    { key: 'ai', icon: 'Sparkle', done: d.verified > 0 },
    { key: 'points', icon: 'Arena', done: d.points > 0, go: '/arena' },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;
  const dismiss = () => { setHidden(true); void AsyncStorage.setItem(key, '1').catch(() => {}); };
  return (
    <View style={{ borderRadius: radius.xl, padding: 18, gap: 14, backgroundColor: color.surface.card, borderWidth: 1, borderColor: color.border.hairline }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="overline" tone="tertiary">{g.overline(doneCount, steps.length)}</T>
          <T variant="h3">{g.title}</T>
        </View>
        <Tap onPress={dismiss} accessibilityRole="button" accessibilityLabel={g.dismiss} style={{ padding: 8 }}>
          <Icon name="Close" size={16} tint={color.icon.secondary} />
        </Tap>
      </View>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: color.border.hairline, overflow: 'hidden' }}>
        <View style={{ width: `${(doneCount / steps.length) * 100}%`, height: 4, backgroundColor: color.text.primary }} />
      </View>
      {steps.map((s) => {
        const copy = g.steps[s.key as keyof typeof g.steps];
        const body = (
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', opacity: s.done ? 0.55 : 1 }}>
            <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: s.done ? color.status.successSoft : color.surface.glass }}>
              <Icon name={s.done ? 'Check' : s.icon} size={15} tint={s.done ? color.status.success : color.icon.primary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <T variant="bodyStrong">{copy.title}</T>
              <T variant="caption" tone="secondary">{copy.body}</T>
            </View>
            {!s.done && s.go ? <Icon name="ChevronRight" size={16} tint={color.icon.secondary} /> : null}
          </View>
        );
        return !s.done && s.go
          ? <Tap key={s.key} onPress={() => router.push(s.go as never)} accessibilityRole="button" accessibilityLabel={`${copy.title}. ${copy.body}`}>{body}</Tap>
          : <View key={s.key} accessible accessibilityLabel={`${copy.title}${s.done ? `, ${g.done}` : ''}. ${copy.body}`}>{body}</View>;
      })}
    </View>
  );
}
