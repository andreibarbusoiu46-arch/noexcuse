import { View } from 'react-native';
import type { ArenaRow } from '@/data/types';
import { color, palette, radius } from '@/theme/tokens';
import { Avatar } from './Blocks';
import { Icon } from './Icon';
import { T } from './Text';

const fmt = (n: number) => n.toLocaleString('en-US');

export function Delta({ change }: { change: number | null }) {
  if (change === null) return <T variant="caption" tone="tertiary">new</T>;
  const tone = change > 0 ? 'success' : change < 0 ? 'danger' : 'tertiary';
  const icon = change > 0 ? 'ArrowUp' : change < 0 ? 'ArrowDown' : 'Minus';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      <Icon name={icon} size={12} tint={color.text[tone]} />
      <T variant="caption" tone={tone}>{change > 0 ? `+${change}` : change < 0 ? `−${Math.abs(change)}` : '0'}</T>
    </View>
  );
}

/** Figma "Leaderboard Row". */
export function LeaderboardRow({ row }: { row: ArenaRow }) {
  return (
    <View accessible accessibilityLabel={`Rank ${row.rank}, ${row.is_me ? 'you' : row.display_name}, ${row.points} points, ${row.streak} day streak`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.md, borderWidth: 1,
        backgroundColor: row.is_me ? color.accent.soft : color.surface.card, borderColor: row.is_me ? color.border.accent : color.border.hairline }}>
      <T variant="bodyStrong" tone={row.is_me ? 'accent' : 'secondary'} style={{ width: 28 }} numberOfLines={1} adjustsFontSizeToFit>{row.rank}</T>
      <Avatar name={row.display_name} me={row.is_me} />
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="bodyStrong" numberOfLines={1}>{row.is_me ? 'You' : row.display_name}</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Icon name="Flame" size={13} tint={color.accent.glow} />
          <T variant="caption" tone="tertiary">{row.streak}-day streak</T>
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <T variant="bodyStrong">{fmt(row.points)}</T>
        <Delta change={row.rank_change} />
      </View>
    </View>
  );
}

/** Top three as a podium: #2 · #1 · #3. */
export function Podium({ rows }: { rows: ArenaRow[] }) {
  const order = [rows[1], rows[0], rows[2]].filter(Boolean) as ArenaRow[];
  const H: Record<number, number> = { 1: 140, 2: 104, 3: 88 };
  const rankColor: Record<number, string> = { 1: '#FFFFFF', 2: palette.silver300, 3: palette.amber400 };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
      {order.map((r) => (
        <View key={r.user_id} style={{ flex: 1, alignItems: 'center', gap: 8 }} accessible accessibilityLabel={`Place ${r.rank}: ${r.display_name}, ${r.points} points`}>
          <Avatar name={r.display_name} size={r.rank === 1 ? 64 : 54} me={r.is_me} />
          <T variant="bodyStrong" numberOfLines={1}>{r.is_me ? 'You' : r.display_name}</T>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Icon name="Flame" size={12} tint={color.accent.glow} />
            <T variant="caption" tone="tertiary">{r.streak} days</T>
          </View>
          <View style={{ alignSelf: 'stretch', height: H[r.rank], borderTopLeftRadius: 20, borderTopRightRadius: 20, borderBottomLeftRadius: 8, borderBottomRightRadius: 8,
            alignItems: 'center', paddingTop: 14, gap: 2, borderWidth: 1,
            backgroundColor: r.rank === 1 ? color.accent.primary : color.surface.raised,
            borderColor: r.rank === 3 ? color.status.warning : color.border.strong,
            ...(r.rank === 1 ? { shadowColor: color.accent.glow, shadowOpacity: 0.55, shadowRadius: 17, shadowOffset: { width: 0, height: 10 } } : null) }}>
            <T variant={r.rank === 1 ? 'numberL' : 'h1'} style={{ color: rankColor[r.rank] }}>{r.rank}</T>
            <T variant="caption" tone={r.rank === 1 ? 'primary' : 'secondary'}>{fmt(r.points)} pts</T>
          </View>
        </View>
      ))}
    </View>
  );
}
