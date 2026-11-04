import { router } from 'expo-router';
import { Button } from './Button';
import { Card } from './Card';
import { T } from './Text';

/** Shown in place of a Premium feature for free accounts. Opens the real paywall. */
export function Upsell({ title, body }: { title: string; body: string }) {
  return (
    <Card tone="accent" style={{ padding: 18, gap: 10 }}>
      <T variant="overline" tone="accent">Premium</T>
      <T variant="bodyStrong">{title}</T>
      <T variant="caption" tone="secondary">{body}</T>
      <Button label="See Premium" onPress={() => router.push('/paywall')} />
    </Card>
  );
}
