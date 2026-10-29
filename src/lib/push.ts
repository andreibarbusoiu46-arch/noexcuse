import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from '@/data';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export type PushResult = 'enabled' | 'denied' | 'unavailable';

/** Asks for permission (only when called from a user action) and stores the Expo push token on the server. */
export async function enablePush(): Promise<PushResult> {
  if (Platform.OS === 'web' || !Device.isDevice) return 'unavailable';
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'NoExcuse', importance: AndroidImportance.HIGH });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return 'denied';
  const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
  if (!projectId) return 'unavailable';
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await api.savePushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
  return 'enabled';
}

export async function disablePush(): Promise<void> {
  await api.deletePushTokens();
}

export async function pushPermissionGranted(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  return (await Notifications.getPermissionsAsync()).status === 'granted';
}

/** Re-registers silently if permission was granted earlier (tokens can rotate). */
export async function refreshPushTokenIfGranted(): Promise<void> {
  if (await pushPermissionGranted().catch(() => false)) await enablePush().catch(() => {});
}
