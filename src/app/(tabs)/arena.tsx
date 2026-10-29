import { router } from 'expo-router';
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
          <T variant="overline" tone="tertiary">Today · resets in {countdown(midnightUtc.getTime() - now)}</T>
          <T variant="h1" accessibilityRole="header">Arena</T>
        </View>
        {rows.length > 0 && <Badge tone="neutral" label={`${rows.length >= 50 ? '50+' : rows.length} ranked`} />}
      </View>

      {q.loading && !q.data ? (
        <LoadingPanel label="Loading the Arena…" />
      ) : q.error && !q.data ? (
        <MessagePanel kind="error" icon="Alert" title="Arena didn’t load." body="Check your connection. Your score is safe on the server." action="Try again" onAction={() => q.reload()} />
      ) : rows.length === 0 ? (
        <MessagePanel kind="empty" icon="Target" title="No rankings yet today." body="Submit your first verified proof to enter today’s Arena." action="Go to Home" onAction={() => router.navigate('/')} />
      ) : (
        <>
          <Podium rows={rows.slice(0, 3)} />
          <View style={{ gap: 8 }}>
            <T variant="overline" tone="tertiary">Your position</T>
            {me ? <LeaderboardRow row={me} /> : <T variant="bodySmall" tone="secondary">Not ranked yet today — one verified proof puts you on the board.</T>}
          </View>
          {others.length > 0 && (
            <View style={{ gap: 8 }}>
              <T variant="overline" tone="tertiary">Rankings</T>
              {others.map((r) => <LeaderboardRow key={r.user_id} row={r} />)}
            </View>
          )}
          <T variant="caption" tone="tertiary" align="center">Points come only from server-verified proof and settled penalties. Ties break on the longer current streak.</T>
        </>
      )}
    </Screen>
  );
}
