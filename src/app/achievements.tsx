import { View } from 'react-native';
import { BackHeader } from '@/components/BackHeader';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { LoadingPanel, MessagePanel } from '@/components/StatePanel';
import { T } from '@/components/Text';
import { api } from '@/data';
import { useLoad } from '@/lib/hooks';
import { color, radius } from '@/theme/tokens';

/** Achievements are computed from your record on the server and unlock once. */
export default function Achievements() {
  const q = useLoad(() => api.getAchievements());
  const list = q.data ?? [];
  const unlocked = list.filter((a) => a.unlocked_at).length;
  return (
    <Screen refreshing={q.refreshing} onRefresh={() => q.reload()}>
      <BackHeader overline={q.data ? `${unlocked} of ${list.length} unlocked` : 'Earned, not given'} title="Achievements" />
      {q.loading && !q.data ? <LoadingPanel label="Loading…" /> : q.error && !q.data ? (
        <MessagePanel kind="error" icon="Alert" title="Couldn’t load achievements." body="Check your connection and try again." action="Try again" onAction={() => q.reload()} />
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {list.map((a) => {
            const on = !!a.unlocked_at;
            return (
              <View key={a.key} accessible accessibilityLabel={`${a.title}. ${a.description}. ${on ? 'Unlocked' : 'Locked'}`}
                style={{ flexGrow: 1, flexBasis: 150, padding: 16, gap: 8, borderRadius: radius.lg, borderWidth: 1,
                  borderColor: on ? color.border.strong : color.border.hairline, backgroundColor: on ? color.surface.card : 'transparent' }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? color.accent.primary : color.surface.glass }}>
                  <Icon name={on ? 'Check' : 'Lock'} size={18} tint={on ? color.text.onLight : color.icon.secondary} />
                </View>
                <T variant="bodyStrong" tone={on ? 'primary' : 'secondary'}>{a.title}</T>
                <T variant="caption" tone="tertiary">{a.description}</T>
                {on ? <T variant="caption" tone="secondary">{new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(a.unlocked_at!))}</T> : null}
              </View>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
