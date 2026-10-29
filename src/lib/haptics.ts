// Every touch fires a haptic (Liquid Glass skill, law 2). One shared hook, no inline calls.
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const safe = (fn: () => Promise<void>) => () => {
  if (Platform.OS === 'web') return;
  fn().catch(() => {});
};

export const haptics = {
  light: safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  medium: safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  heavy: safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  rigid: safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid)),
  selection: safe(() => Haptics.selectionAsync()),
  success: safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
export type HapticKind = keyof typeof haptics;
export const useHaptics = () => haptics;
