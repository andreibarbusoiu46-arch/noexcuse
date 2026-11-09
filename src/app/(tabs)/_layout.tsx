import { NativeTabs } from 'expo-router/native-tabs';
import { Tabs } from 'expo-router/js-tabs';
import { t } from '@/i18n';
import { Platform } from 'react-native';
import { GlassDock, revealInterpolator, revealTiming } from '@/components/GlassDock';
import { useReduceMotion } from '@/lib/hooks';
import { color } from '@/theme/tokens';

// Home is the centre of the navigation; deep links and refreshes still land on the section in the URL.
export const unstable_settings = { initialRouteName: 'index' };

/** Web: floating glass dock (Home in the centre); each section expands out of its place in the dock. */
function WebTabs() {
  const reduce = useReduceMotion();
  return (
    <Tabs
      tabBar={(props) => <GlassDock {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: color.bg.base },
        sceneStyleInterpolator: revealInterpolator(reduce),
        transitionSpec: revealTiming,
        animation: reduce ? 'fade' : 'shift',
      }}>
      <Tabs.Screen name="habits" />
      <Tabs.Screen name="ai" />
      <Tabs.Screen name="index" />
      <Tabs.Screen name="challenges" />
      <Tabs.Screen name="arena" />
    </Tabs>
  );
}

/**
 * Native: the system tab bar (Liquid Glass on iOS 26, never hand-rolled; it fires its own haptics),
 * with Home in the middle. Profile and Settings open from the avatar on Home.
 */
export default function TabsLayout() {
  if (Platform.OS === 'web') return <WebTabs />;
  return (
    <NativeTabs
      tintColor={color.accent.glow}
      iconColor={{ default: color.icon.secondary, selected: color.accent.glow }}
      labelStyle={{ default: { color: color.text.tertiary }, selected: { color: color.text.primary } }}
      minimizeBehavior="onScrollDown"
    >
      <NativeTabs.Trigger name="habits">
        <NativeTabs.Trigger.Icon sf="checklist" md="checklist" />
        <NativeTabs.Trigger.Label>{t.tabs.commitments}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="ai">
        <NativeTabs.Trigger.Icon sf="sparkles" md="auto_awesome" />
        <NativeTabs.Trigger.Label>{t.tabs.ai}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
        <NativeTabs.Trigger.Label>{t.tabs.home}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="challenges">
        <NativeTabs.Trigger.Icon sf={{ default: 'flag', selected: 'flag.fill' }} md="flag" />
        <NativeTabs.Trigger.Label>{t.tabs.challenges}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="arena">
        <NativeTabs.Trigger.Icon sf={{ default: 'trophy', selected: 'trophy.fill' }} md="emoji_events" />
        <NativeTabs.Trigger.Label>{t.tabs.arena}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
