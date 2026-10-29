import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { IconTile } from '@/components/Blocks';
import { Lockup } from '@/components/Brand';
import { Button, IconButton } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen, Summit } from '@/components/Screen';
import { Tap } from '@/components/Tap';
import { T } from '@/components/Text';
import { color } from '@/theme/tokens';

function Pager({ index }: { index: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }} accessibilityLabel={`Step ${index + 1} of 2`}>
      {[0, 1].map((i) => <View key={i} style={{ height: 6, width: i === index ? 22 : 6, borderRadius: 3, backgroundColor: i === index ? color.accent.glow : color.border.strong }} />)}
    </View>
  );
}

const STEPS = [
  { n: '01', icon: 'Bolt' as const, ai: false, title: 'Set a hard target', body: 'Pick the habit, the time and the days. Proof is due inside a ±15-minute window.' },
  { n: '02', icon: 'Camera' as const, ai: false, title: 'Prove it live', body: 'In-app camera only. Gallery uploads are blocked — the moment is the proof.' },
  { n: '03', icon: 'Sparkle' as const, ai: true, title: 'Get the AI verdict', body: 'Verified: +50 and your streak grows. Missed or rejected: −100 and it resets.' },
];

export default function Onboarding() {
  const [step, setStep] = useState(0);

  if (step === 0) {
    return (
      <Screen
        scroll={false}
        background={<Summit top={150} />}
        contentStyle={{ justifyContent: 'space-between' }}
        footer={
          <>
            <Button label="Get started" onPress={() => setStep(1)} />
            <Button kind="ghost" label="I already have an account" onPress={() => router.push('/sign-in')} />
          </>
        }
      >
        <View style={{ marginTop: 8 }}><Lockup /></View>
        <View style={{ gap: 16 }}>
          <T variant="overline" tone="accent">The private performance arena</T>
          <View accessible accessibilityRole="header">
            <T variant="hero">No excuses.</T>
            <T variant="hero" tone="accent">Just execution.</T>
          </View>
          <T tone="secondary">Set a target. Prove it live. An AI judge checks your proof. Your streak and your rank do the rest.</T>
          <Pager index={0} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen glow="violet" footer={<Button label="Continue" onPress={() => router.push('/sign-in')} />}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <IconButton icon="ChevronLeft" label="Back" onPress={() => setStep(0)} />
        <Pager index={1} />
        <Tap onPress={() => router.push('/sign-in')} accessibilityLabel="Skip">
          <T variant="caption" tone="tertiary" style={{ width: 44, textAlign: 'right' }}>Skip</T>
        </Tap>
      </View>
      <View style={{ gap: 14 }}>
        <T variant="overline" tone="accent">How it works</T>
        <T variant="h1" accessibilityRole="header">Discipline you can’t fake.</T>
      </View>
      <View style={{ gap: 12 }}>
        {STEPS.map((s) => (
          <Card key={s.n} tone={s.ai ? 'ai' : 'default'} style={{ flexDirection: 'row', gap: 14, padding: 16 }}>
            <IconTile icon={s.icon} bg={s.ai ? color.ai.soft : color.accent.soft} tint={s.ai ? color.ai.accent : color.accent.glow} />
            <View style={{ flex: 1, gap: 4 }}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <T variant="overline" tone={s.ai ? 'ai' : 'accent'}>{s.n}</T>
                <T variant="bodyStrong">{s.title}</T>
              </View>
              <T variant="bodySmall" tone="secondary">{s.body}</T>
            </View>
          </Card>
        ))}
      </View>
    </Screen>
  );
}
