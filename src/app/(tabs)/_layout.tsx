import { NativeTabs } from 'expo-router/native-tabs';
import { t } from '@/i18n';
import { Platform } from 'react-native';
import { color } from '@/theme/tokens';

// Web only: expo-router's web tab bar pads each tab 20px, which overflows five tabs on a phone.
if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('nx-tabs-css')) {
  const el = document.createElement('style');
  el.id = 'nx-tabs-css';
  el.textContent = '@media (max-width: 520px){[class*="navigationMenuTrigger"]{padding:0 7px!important}}';
  document.head.appendChild(el);
}

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
        <NativeTabs.Trigger.Label>{t.tabs.home}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="habits">
        <NativeTabs.Trigger.Icon sf="checklist" md="checklist" />
        <NativeTabs.Trigger.Label>{t.tabs.commitments}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="challenges">
        <NativeTabs.Trigger.Icon sf={{ default: 'flag', selected: 'flag.fill' }} md="flag" />
        <NativeTabs.Trigger.Label>{t.tabs.challenges}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="arena">
        <NativeTabs.Trigger.Icon sf={{ default: 'trophy', selected: 'trophy.fill' }} md="emoji_events" />
        <NativeTabs.Trigger.Label>{t.tabs.arena}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Icon sf={{ default: 'person', selected: 'person.fill' }} md="person" />
        <NativeTabs.Trigger.Label>{t.tabs.profile}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
