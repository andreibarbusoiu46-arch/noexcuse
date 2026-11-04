import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';

/** Tapping a push opens the right screen: reminders → camera, missed → consequences, appeal → decision. */
export function useNotificationRouting(enabled: boolean) {
  const last = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!enabled || !last) return;
    const data = last.notification.request.content.data as { kind?: string; refId?: string; targetId?: string };
    const k = data.kind;
    if ((k === 'reminder' || k === 'window_open' || k === 'last_call') && data.targetId) router.push({ pathname: '/proof/[targetId]', params: { targetId: data.targetId } });
    else if (k === 'missed' && data.refId) router.push({ pathname: '/missed/[targetId]', params: { targetId: data.refId } });
    else if (k === 'appeal' && data.targetId) router.push({ pathname: '/appeal/[targetId]', params: { targetId: data.targetId } });
    else if (k === 'arena_up') router.navigate('/arena');
    else if (k === 'weekly_report') router.push('/reports');
    else if (k === 'partner_missed') router.push('/partners');
    else if (k === 'achievement') router.push('/achievements');
    else if (k === 'heads_up' || k === 'nudge') router.navigate('/');
    Notifications.clearLastNotificationResponseAsync?.().catch(() => {});
  }, [enabled, last]);
}
