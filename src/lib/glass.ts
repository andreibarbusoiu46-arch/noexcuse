import { isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Platform } from 'react-native';
import { useReduceTransparency } from './hooks';

/** Native Liquid Glass exists only on iOS 26+. Elsewhere we render plain opaque surfaces — never fake glass. */
export function canUseLiquidGlass(): boolean {
  if (Platform.OS !== 'ios') return false;
  try {
    return isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
  } catch {
    return false;
  }
}

export function useLiquidGlassEnabled(): boolean {
  const reduceTransparency = useReduceTransparency();
  return canUseLiquidGlass() && !reduceTransparency;
}
