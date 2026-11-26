// Web emblem: shows the flat mark at once and swaps in the 3D canvas when its chunk (three.js, ~1 MB) has
// loaded, so sign-in renders without waiting for it. Native uses Emblem3D.native.tsx.
import { lazy, Suspense } from 'react';
import { View } from 'react-native';
import { Mark } from '../Brand';

const EmblemCanvas = lazy(() => import('./EmblemCanvas'));

export function Emblem3D({ size = 168 }: { size?: number }) {
  const placeholder = (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityRole="image" accessibilityLabel="NoExcuse emblem">
      <Mark size={size * 0.55} />
    </View>
  );
  return (
    <Suspense fallback={placeholder}>
      <EmblemCanvas size={size} />
    </Suspense>
  );
}
