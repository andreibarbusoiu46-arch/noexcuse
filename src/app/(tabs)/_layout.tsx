import { NativeTabs } from 'expo-router/native-tabs';
import { color } from '@/theme/tokens';

/**
 * Native tab bar: on iOS 26 the system draws it in Liquid Glass (never hand-rolled),
 * and fires its own tab haptics. Android gets the Material bottom navigation.
 */
export default function TabsLayout() {
  return (
    <NativeTabs
      tintColor={color.accent.glow}
      iconColor={{ default: color.icon.secondary, selected: color.accent.glow }}
      labelStyle={{ default: { color: color.text.tertiary }, selected: { color: color.text.primary } }}
      minimizeBehavior="onScrollDown"
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="habits">
        <NativeTabs.Trigger.Icon sf="checklist" md="checklist" />
        <NativeTabs.Trigger.Label>Habits</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="arena">
        <NativeTabs.Trigger.Icon sf={{ default: 'trophy', selected: 'trophy.fill' }} md="emoji_events" />
        <NativeTabs.Trigger.Label>Arena</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Icon sf={{ default: 'person', selected: 'person.fill' }} md="person" />
        <NativeTabs.Trigger.Label>Profile</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
