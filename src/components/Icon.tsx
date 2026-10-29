import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Platform, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { color } from '@/theme/tokens';

// iOS: SF Symbols (system, monochrome). Elsewhere: the same 24px stroke set that's in the Figma library.
const SF: Record<IconName, SFSymbol> = {
  Home: 'house', Habits: 'checklist', Arena: 'trophy', Profile: 'person', Camera: 'camera', Flame: 'flame.fill',
  Bolt: 'bolt.fill', Clock: 'clock', ChevronRight: 'chevron.right', ChevronLeft: 'chevron.left', Close: 'xmark',
  Check: 'checkmark', Retry: 'arrow.clockwise', Sparkle: 'sparkles', Plus: 'plus', Lock: 'lock', NoGallery: 'nosign',
  ArrowUp: 'arrow.up', ArrowDown: 'arrow.down', Minus: 'minus', Settings: 'slider.horizontal.3', Shield: 'checkmark.shield',
  Alert: 'exclamationmark.triangle', EyeOff: 'eye.slash', Flash: 'bolt.fill', FlashOff: 'bolt.slash', Flip: 'arrow.triangle.2.circlepath.camera',
  Bell: 'bell', Target: 'scope', Trash: 'trash', Logout: 'rectangle.portrait.and.arrow.right', Globe: 'globe', Doc: 'doc.text',
};

const PATHS: Record<IconName, string[]> = {
  Home: ['M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z'],
  Habits: ['M10 6h10M10 12h10M10 18h10', 'm3.5 6 1.3 1.3L7.3 4.8M3.5 12l1.3 1.3 2.5-2.5M3.5 18l1.3 1.3 2.5-2.5'],
  Arena: ['M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z', 'M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3'],
  Profile: ['M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8z', 'M4 21a8 8 0 0 1 16 0'],
  Camera: ['M3 8a2 2 0 0 1 2-2h2.5L9 4h6l1.5 2H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M12 9a4 4 0 1 1 0 8 4 4 0 0 1 0-8z'],
  Flame: ['M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5 0 2 1 3 2 3 0-3-1-5.5 1-8.5z'],
  Bolt: ['M13 2 4 14h7l-1 8 9-12h-7z'],
  Clock: ['M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z', 'M12 7v5l3 2'],
  ChevronRight: ['m9 6 6 6-6 6'],
  ChevronLeft: ['m15 6-6 6 6 6'],
  Close: ['M6 6l12 12M18 6 6 18'],
  Check: ['m5 12.5 4.5 4.5L19 7'],
  Retry: ['M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6'],
  Sparkle: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', 'M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z'],
  Plus: ['M12 5v14M5 12h14'],
  Lock: ['M5 13a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z', 'M8 11V7a4 4 0 0 1 8 0v4'],
  NoGallery: ['M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'm8 14 2.5-2.5L13 14M3 3l18 18'],
  ArrowUp: ['M12 19V5M6 11l6-6 6 6'],
  ArrowDown: ['M12 5v14M6 13l6 6 6-6'],
  Minus: ['M5 12h14'],
  Settings: ['M4 7h10M18 7h2M4 17h4M12 17h8', 'M16 5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM10 15a2 2 0 1 1 0 4 2 2 0 0 1 0-4z'],
  Shield: ['M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6z', 'm9 12 2 2 4-4'],
  Alert: ['M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9v4M12 17h.01'],
  EyeOff: ['M3 3l18 18', 'M10.6 6.1A10 10 0 0 1 12 6c5.5 0 9 6 9 6a17 17 0 0 1-2.6 3.3M6.6 7.6A17 17 0 0 0 3 12s3.5 6 9 6a9 9 0 0 0 4.4-1.1'],
  Flash: ['M7 2h10l-3 7h5L9 22l2-9H6z'],
  FlashOff: ['M7 2h10l-3 7h5L9 22l2-9H6z', 'M3 3l18 18'],
  Flip: ['M4 9a8 8 0 0 1 14-3l2 2M20 15a8 8 0 0 1-14 3l-2-2', 'M20 4v4h-4M4 20v-4h4'],
  Bell: ['M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8', 'M10 21a2 2 0 0 0 4 0'],
  Target: ['M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z', 'M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10z'],
  Trash: ['M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13'],
  Logout: ['M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10'],
  Globe: ['M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z', 'M3 12h18M12 3c2.5 3 2.5 15 0 18M12 3c-2.5 3-2.5 15 0 18'],
  Doc: ['M6 3h8l4 4v14H6z', 'M14 3v4h4M9 12h6M9 16h6'],
};

export type IconName =
  | 'Home' | 'Habits' | 'Arena' | 'Profile' | 'Camera' | 'Flame' | 'Bolt' | 'Clock' | 'ChevronRight' | 'ChevronLeft'
  | 'Close' | 'Check' | 'Retry' | 'Sparkle' | 'Plus' | 'Lock' | 'NoGallery' | 'ArrowUp' | 'ArrowDown' | 'Minus'
  | 'Settings' | 'Shield' | 'Alert' | 'EyeOff' | 'Flash' | 'FlashOff' | 'Flip' | 'Bell' | 'Target' | 'Trash' | 'Logout' | 'Globe' | 'Doc';

export function Icon({ name, size = 24, tint = color.icon.primary }: { name: IconName; size?: number; tint?: string }) {
  const fallback = (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={tint} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name].map((d, i) => <Path key={i} d={d} />)}
    </Svg>
  );
  if (Platform.OS !== 'ios') return <View accessible={false} importantForAccessibility="no">{fallback}</View>;
  return <SymbolView name={SF[name]} size={size * 0.92} tintColor={tint} weight="medium" resizeMode="scaleAspectFit" style={{ width: size, height: size }} fallback={fallback} />;
}

