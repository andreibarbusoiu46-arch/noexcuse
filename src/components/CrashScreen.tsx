import { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { palette } from '@/theme/tokens';

/**
 * Shown by the root error boundary when a screen throws while rendering. It must not depend on any
 * app provider (they may be what failed), so it uses plain React Native views, fixed dark colours and
 * both app languages. Nothing about the error is shown to the person; it goes to the console only.
 */
export function CrashScreen({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  useEffect(() => { console.error('[NoExcuse] screen crashed:', error); }, [error]);
  const ro = typeof navigator !== 'undefined' && /^ro\b/i.test(navigator.language ?? '');
  const s = ro
    ? { title: 'Ceva n-a mers.', body: 'Datele tale sunt în siguranță. Încearcă din nou sau revino la ecranul principal.', retry: 'Încearcă din nou', home: 'Ecranul principal' }
    : { title: 'Something went wrong.', body: 'Your data is safe. Try again, or go back to the home screen.', retry: 'Try again', home: 'Home screen' };
  const goHome = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.assign('/');
    else void retry();
  };
  return (
    <View style={st.root} accessibilityRole="alert">
      <Text style={st.title} accessibilityRole="header">{s.title}</Text>
      <Text style={st.body}>{s.body}</Text>
      <Pressable accessibilityRole="button" onPress={() => void retry()} style={({ pressed }) => [st.primary, pressed && { opacity: 0.8 }]}>
        <Text style={st.primaryLabel}>{s.retry}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={goHome} style={({ pressed }) => [st.secondary, pressed && { opacity: 0.7 }]}>
        <Text style={st.secondaryLabel}>{s.home}</Text>
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.obsidian950, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  title: { color: palette.white, fontSize: 28, fontFamily: 'BodoniModa_500Medium', textAlign: 'center' },
  body: { color: palette.silver300, fontSize: 15, lineHeight: 22, fontFamily: 'Inter_400Regular', textAlign: 'center', maxWidth: 340 },
  primary: { marginTop: 10, minHeight: 48, minWidth: 220, borderRadius: 999, backgroundColor: palette.white, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  primaryLabel: { color: palette.obsidian950, fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  secondary: { minHeight: 44, minWidth: 220, alignItems: 'center', justifyContent: 'center' },
  secondaryLabel: { color: palette.silver300, fontSize: 15, fontFamily: 'Inter_500Medium' },
});
