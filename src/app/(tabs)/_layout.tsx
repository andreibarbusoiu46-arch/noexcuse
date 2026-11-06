import { NativeTabs } from 'expo-router/native-tabs';
import { t } from '@/i18n';
import { Platform } from 'react-native';
import { color, scheme } from '@/theme/tokens';

// Web only: expo-router's web tab bar pads each tab 20px (overflows five tabs on a phone) and has a fixed
// dark palette. Re-written on every render so it follows the current theme.
function webTabsCss() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  let el = document.getElementById('nx-tabs-css');
  if (!el) { el = document.createElement('style'); el.id = 'nx-tabs-css'; document.head.appendChild(el); }
  el.textContent = [
    '@media (max-width: 520px){[class*="navigationMenuTrigger"]{padding:0 7px!important}}',
    `[class*="navigationMenuRoot"]{background:${color.surface.raised}!important;border:1px solid ${color.border.hairline};box-shadow:0 8px 24px rgba(0,0,0,${scheme() === 'light' ? 0.08 : 0.3})}`,
    `[class*="navigationMenuTrigger"]{background:transparent!important}`,
    `[class*="navigationMenuTrigger"][data-state="active"]{background:${color.surface.glassStrong}!important;box-shadow:inset 0 0 0 1px ${color.border.strong}}`,
  ].join('\n');
}

/**
 * Native tab bar: on iOS 26 the system draws it in Liquid Glass (never hand-rolled),
 * and fires its own tab haptics. Android gets the Material bottom navigation.
 */
export default function TabsLayout() {
  webTabsCss();
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
