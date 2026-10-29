import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';

/** Tapping a push opens the right screen: reminders → camera, missed → consequences. */
export function useNotificationRouting(enabled: boolean) {
  const last = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!enabled || !last) return;
    const data = last.notification.request.content.data as { kind?: string; refId?: string; targetId?: string };
    if ((data.kind === 'reminder' || data.kind === 'window_open') && data.targetId) router.push({ pathname: '/proof/[targetId]', params: { targetId: data.targetId } });
    else if (data.kind === 'missed' && data.refId) router.push({ pathname: '/missed/[targetId]', params: { targetId: data.refId } });
    else if (data.kind === 'arena_up') router.navigate('/arena');
    Notifications.clearLastNotificationResponseAsync?.().catch(() => {});
  }, [enabled, last]);
}
