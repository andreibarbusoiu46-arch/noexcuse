// Native alerts on iOS/Android. On the web an in-app dialog (DialogHost): React Native Web's Alert does
// nothing, and window.confirm is blocked inside iframes / in-app browsers, where it silently returns false.
import { Alert, Platform } from 'react-native';
import { t } from '@/i18n';

export type DialogRequest = {
  kind: 'confirm' | 'notice'; title: string; message?: string; action: string; destructive: boolean; resolve: (ok: boolean) => void;
};
let show: ((r: DialogRequest) => void) | null = null;
/** DialogHost registers itself here; returns the unsubscribe. */
export function onDialog(fn: (r: DialogRequest) => void) { show = fn; return () => { if (show === fn) show = null; }; }

function webDialog(r: Omit<DialogRequest, 'resolve'>): Promise<boolean> {
  if (show) { const s = show; return new Promise((resolve) => s({ ...r, resolve })); }
  // Fallback before the host mounts.
  if (r.kind === 'confirm') return Promise.resolve(window.confirm(`${r.title}\n\n${r.message ?? ''}`));
  window.alert(r.message ? `${r.title}\n\n${r.message}` : r.title);
  return Promise.resolve(true);
}

export function notify(title: string, message?: string): void {
  if (Platform.OS === 'web') { void webDialog({ kind: 'notice', title, message, action: 'OK', destructive: false }); return; }
  Alert.alert(title, message);
}

export function confirmDestructive(title: string, message: string, actionLabel: string): Promise<boolean> {
  if (Platform.OS === 'web') return webDialog({ kind: 'confirm', title, message, action: actionLabel, destructive: true });
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: t.common.cancel, style: 'cancel', onPress: () => resolve(false) },
      { text: actionLabel, style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
