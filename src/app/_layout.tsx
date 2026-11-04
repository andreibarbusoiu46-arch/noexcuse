import { BodoniModa_500Medium } from '@expo-google-fonts/bodoni-moda/500Medium';
import { BodoniModa_600SemiBold } from '@expo-google-fonts/bodoni-moda/600SemiBold';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { Inter_800ExtraBold } from '@expo-google-fonts/inter/800ExtraBold';
import { useFonts } from 'expo-font';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useNotificationRouting } from '@/lib/notificationRouting';
import { AppProvider, useApp } from '@/providers/AppProvider';
import { color } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {});

const WEB_FONT_GRACE_MS = 1200;

const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: color.bg.base, card: color.bg.base, primary: color.accent.glow, text: color.text.primary, border: color.border.hairline } };

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, BodoniModa_500Medium, BodoniModa_600SemiBold });
  // Web: Safari/WebKit can leave `document.fonts.load()` pending even after the face has loaded, so
  // expo-font only gives up after its 12 s timeout and the app stays black until then on iPhone.
  // Never block the first render on fonts for more than a moment; the @font-face rules are already
  // injected, so text switches to the brand fonts as soon as the files arrive.
  const [fontGrace, setFontGrace] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const t = setTimeout(() => setFontGrace(true), WEB_FONT_GRACE_MS);
    return () => clearTimeout(t);
  }, []);
  return (
    <SafeAreaProvider>
      <ThemeProvider value={theme}>
        <AppProvider>
          <StatusBar style="light" />
          <Navigator fontsReady={fontsLoaded || !!fontError || fontGrace} />
        </AppProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function Navigator({ fontsReady }: { fontsReady: boolean }) {
  const { ready, session } = useApp();
  const signedIn = !!session;
  const show = ready && fontsReady;

  useEffect(() => {
    if (show) SplashScreen.hideAsync().catch(() => {});
  }, [show]);

  useNotificationRouting(signedIn);

  if (!show) return null;
  const sheet = { presentation: 'formSheet' as const, sheetAllowedDetents: [0.94], sheetGrabberVisible: true, sheetCornerRadius: 34, contentStyle: { backgroundColor: color.surface.card } };
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg.base }, animation: Platform.OS === 'ios' ? 'default' : 'fade' }}>
      {/* Free and Premium use the same app; Premium features check the plan on the server. */}
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="habit/new" options={sheet} />
        <Stack.Screen name="habit/[id]" options={sheet} />
        <Stack.Screen name="proof/[targetId]" options={{ presentation: 'fullScreenModal', gestureEnabled: false, animation: 'slide_from_bottom' }} />
        <Stack.Screen name="missed/[targetId]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="comeback/[habitId]" />
        <Stack.Screen name="discipline" />
        <Stack.Screen name="challenge/[id]" />
        <Stack.Screen name="challenge/start" />
        <Stack.Screen name="appeal/[targetId]" />
        <Stack.Screen name="coach" />
        <Stack.Screen name="reports" />
        <Stack.Screen name="partners" />
        <Stack.Screen name="share" />
        <Stack.Screen name="achievements" />
        <Stack.Screen name="paywall" options={{ presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}
