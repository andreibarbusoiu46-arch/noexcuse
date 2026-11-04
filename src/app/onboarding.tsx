import { router } from 'expo-router';
import { t } from '@/i18n';
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
    <View style={{ flexDirection: 'row', gap: 6 }} accessibilityLabel={t.onboarding.step(index + 1, 2)}>
      {[0, 1].map((i) => <View key={i} style={{ height: 6, width: i === index ? 22 : 6, borderRadius: 3, backgroundColor: i === index ? color.accent.glow : color.border.strong }} />)}
    </View>
  );
}

const STEP_LOOK = [
  { n: '01', icon: 'Bolt' as const, ai: false },
  { n: '02', icon: 'Camera' as const, ai: false },
  { n: '03', icon: 'Sparkle' as const, ai: true },
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
            <Button label={t.onboarding.start} onPress={() => setStep(1)} />
            <Button kind="ghost" label={t.onboarding.haveAccount} onPress={() => router.push('/sign-in')} />
          </>
        }
      >
        <View style={{ marginTop: 8 }}><Lockup /></View>
        <View style={{ gap: 16 }}>
          <T variant="overline" tone="accent">{t.onboarding.overline}</T>
          <View accessible accessibilityRole="header">
            <T variant="hero">{t.onboarding.hero1}</T>
            <T variant="hero" tone="accent">{t.onboarding.hero2}</T>
          </View>
          <T tone="secondary">{t.onboarding.pitch}</T>
          <Pager index={0} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen glow="violet" footer={<Button label={t.common.continue} onPress={() => router.push('/sign-in')} />}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <IconButton icon="ChevronLeft" label={t.common.back} onPress={() => setStep(0)} />
        <Pager index={1} />
        <Tap onPress={() => router.push('/sign-in')} accessibilityLabel={t.common.skip}>
          <T variant="caption" tone="tertiary" style={{ width: 44, textAlign: 'right' }}>{t.common.skip}</T>
        </Tap>
      </View>
      <View style={{ gap: 14 }}>
        <T variant="overline" tone="accent">{t.onboarding.howOver}</T>
        <T variant="h1" accessibilityRole="header">{t.onboarding.howTitle}</T>
      </View>
      <View style={{ gap: 12 }}>
        {STEP_LOOK.map((l, i) => ({ ...l, ...t.onboarding.steps[i] })).map((s) => (
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
