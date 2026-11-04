import { router } from 'expo-router';
import { t } from '@/i18n';
import { View } from 'react-native';
import { LeaderboardRow, Podium } from '@/components/Arena';
import { Badge } from '@/components/Badge';
import { Screen } from '@/components/Screen';
import { LoadingPanel, MessagePanel } from '@/components/StatePanel';
import { T } from '@/components/Text';
import { api } from '@/data';
import { useLoad, useNow } from '@/lib/hooks';
import { countdown } from '@/lib/time';

/** Daily Arena from the server (get_arena): UTC day, points from verified proof only. */
export default function Arena() {
  const q = useLoad(() => api.getArena());
  const now = useNow(30_000);
  const midnightUtc = new Date(now); midnightUtc.setUTCHours(24, 0, 0, 0);
  const rows = q.data ?? [];
  const me = rows.find((r) => r.is_me);
  const others = rows.filter((r) => r.rank > 3 && !(r.is_me && r.rank > 50));

  return (
    <Screen tabBar refreshing={q.refreshing} onRefresh={() => q.reload()}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1, gap: 4 }}>
          <T variant="overline" tone="tertiary">{t.arena.resets(countdown(midnightUtc.getTime() - now))}</T>
          <T variant="h1" accessibilityRole="header">{t.arena.title}</T>
        </View>
        {rows.length > 0 && <Badge tone="neutral" label={t.arena.ranked(rows.length >= 50 ? '50+' : String(rows.length))} />}
      </View>

      {q.loading && !q.data ? (
        <LoadingPanel label={t.arena.loading} />
      ) : q.error && !q.data ? (
        <MessagePanel kind="error" icon="Alert" title={t.arena.failTitle} body={t.arena.failBody} action={t.common.tryAgain} onAction={() => q.reload()} />
      ) : rows.length === 0 ? (
        <MessagePanel kind="empty" icon="Target" title={t.arena.emptyTitle} body={t.arena.emptyBody} action={t.arena.goHome} onAction={() => router.navigate('/')} />
      ) : (
        <>
          <Podium rows={rows.slice(0, 3)} />
          <View style={{ gap: 8 }}>
            <T variant="overline" tone="tertiary">{t.arena.yourPosition}</T>
            {me ? <LeaderboardRow row={me} /> : <T variant="bodySmall" tone="secondary">{t.arena.notRanked}</T>}
          </View>
          {others.length > 0 && (
            <View style={{ gap: 8 }}>
              <T variant="overline" tone="tertiary">{t.arena.rankings}</T>
              {others.map((r) => <LeaderboardRow key={r.user_id} row={r} />)}
            </View>
          )}
          <T variant="caption" tone="tertiary" align="center">{t.arena.footer}</T>
        </>
      )}
    </Screen>
  );
}
