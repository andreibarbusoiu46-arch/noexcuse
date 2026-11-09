import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { Segmented } from '@/components/Blocks';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Field } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { LoadingPanel, MessagePanel } from '@/components/StatePanel';
import { Tap } from '@/components/Tap';
import { T } from '@/components/Text';
import { api, type ArenaBoard, type ArenaMember, type ArenaPeriod } from '@/data';
import { fmtNumber, t } from '@/i18n';
import { levelOf } from '@/lib/level';
import { useApp } from '@/providers/AppProvider';
import { color, radius } from '@/theme/tokens';

const PAGE = 20;
type Sort = 'points' | 'streak';
type Scope = 'all' | 'partners';

const pts = (n: number) => (n > 0 ? `+${fmtNumber(n)}` : n < 0 ? `−${fmtNumber(Math.abs(n))}` : '0');

function LevelBar({ points }: { points: number }) {
  const l = levelOf(points);
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <T variant="caption" tone="secondary">{t.community.level(l.level)}</T>
        <T variant="caption" tone="tertiary">{l.next === null ? t.community.maxLevel : t.community.toNext(fmtNumber(l.next - points))}</T>
      </View>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: color.surface.control, overflow: 'hidden' }}>
        <View style={{ width: `${Math.round(l.progress * 100)}%`, height: 4, backgroundColor: color.text.primary }} />
      </View>
    </View>
  );
}

function MemberRow({ m, period }: { m: ArenaMember; period: ArenaPeriod }) {
  const sub = [m.username ? `@${m.username}` : null, t.community.level(m.level), m.challenge].filter(Boolean).join(' · ');
  return (
    <View accessible accessibilityLabel={t.community.rowA11y(m.rank, m.display_name, m.points, m.level)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: radius.lg,
        backgroundColor: m.is_me ? color.surface.glassStrong : color.surface.card, borderWidth: 1, borderColor: m.is_me ? color.border.accent : color.border.hairline }}>
      <T variant="bodyStrong" tone={m.rank <= 3 ? 'primary' : 'tertiary'} style={{ width: 30, textAlign: 'center' }}>{m.rank}</T>
      <Avatar name={m.display_name} path={m.avatar_path} size={42} me={m.is_me} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <T variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{m.display_name}</T>
          {m.is_me ? <T variant="caption" tone="tertiary">{t.community.you}</T> : m.is_partner ? <Icon name="Shield" size={12} tint={color.icon.secondary} /> : null}
        </View>
        <T variant="caption" tone="tertiary" numberOfLines={1}>{sub}</T>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <T variant="bodyStrong">{period === 'all' ? fmtNumber(m.points) : pts(m.points)}</T>
        {m.streak !== null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
            <Icon name="Flame" size={11} tint={color.icon.secondary} />
            <T variant="caption" tone="tertiary">{m.streak}</T>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** The community: every registered member who chose to appear, ranked by period, searchable, paged on the server. */
export default function Arena() {
  const { profile } = useApp();
  const [period, setPeriod] = useState<ArenaPeriod>('week');
  const [sort, setSort] = useState<Sort>('points');
  const [scope, setScope] = useState<Scope>('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [board, setBoard] = useState<ArenaBoard | null>(null);
  const [rows, setRows] = useState<ArenaMember[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'more'>('loading');
  const seq = useRef(0);

  // Debounce typing so every keystroke doesn't hit the server.
  useEffect(() => { const id = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(id); }, [search]);

  const load = useCallback(async (offset: number) => {
    const my = ++seq.current;
    setState(offset === 0 ? 'loading' : 'more');
    try {
      const b = await api.getArenaBoard({ period, sort, search: query, scope, offset, limit: PAGE });
      if (my !== seq.current) return;                       // a newer query already started
      setBoard(b);
      setRows((prev) => (offset === 0 ? b.rows : [...prev, ...b.rows.filter((r) => !prev.some((p) => p.user_id === r.user_id))]));
      setState('ready');
    } catch {
      if (my === seq.current) setState('error');
    }
  }, [period, sort, query, scope]);

  // Runs on focus and again whenever the query changes (the callback changes with it).
  useFocusEffect(useCallback(() => { void load(0); }, [load]));

  const me = board?.me;
  const periodLabel = { week: t.community.week, month: t.community.month, all: t.community.allTime }[period];

  return (
    <Screen tabBar refreshing={state === 'loading' && !!board} onRefresh={() => load(0)}>
      <View style={{ gap: 4 }}>
        <T variant="overline" tone="tertiary">{board ? t.community.members(board.eligible) : t.community.overline}</T>
        <T variant="h1" accessibilityRole="header">{t.arena.title}</T>
      </View>

      <Segmented<ArenaPeriod> value={period} onChange={setPeriod}
        options={[{ key: 'week', label: t.community.week }, { key: 'month', label: t.community.month }, { key: 'all', label: t.community.allTime }]} />

      {me ? (
        <Card style={{ gap: 14, padding: 18 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Avatar name={profile?.display_name ?? '?'} path={profile?.avatar_path} size={52} ring />
            <View style={{ flex: 1, gap: 2 }}>
              <T variant="overline" tone="tertiary">{t.community.yourStanding(periodLabel)}</T>
              <T variant="h2">{me.rank ? t.community.rank(me.rank) : t.community.hidden}</T>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <T variant="h3">{period === 'all' ? fmtNumber(me.points) : pts(me.points)}</T>
              <T variant="caption" tone="tertiary">{t.community.pts}</T>
            </View>
          </View>
          <LevelBar points={profile?.total_points ?? 0} />
          {me.hidden ? (
            <Tap onPress={() => router.push('/settings')} accessibilityLabel={t.community.hiddenBody}>
              <T variant="caption" tone="secondary">{t.community.hiddenBody}</T>
            </Tap>
          ) : null}
        </Card>
      ) : null}

      <View style={{ gap: 10 }}>
        <Field label={t.community.search} value={search} onChangeText={setSearch} placeholder={t.community.searchPlaceholder}
          autoCapitalize="none" autoCorrect={false} returnKeyType="search" maxLength={40} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Segmented<Scope> value={scope} onChange={setScope} options={[{ key: 'all', label: t.community.everyone }, { key: 'partners', label: t.community.partners }]} />
          </View>
          <View style={{ flex: 1 }}>
            <Segmented<Sort> value={sort} onChange={setSort} options={[{ key: 'points', label: t.community.byPoints }, { key: 'streak', label: t.community.byStreak }]} />
          </View>
        </View>
      </View>

      {state === 'loading' && !board ? (
        <LoadingPanel label={t.arena.loading} />
      ) : state === 'error' && rows.length === 0 ? (
        <MessagePanel kind="error" icon="Alert" title={t.arena.failTitle} body={t.arena.failBody} action={t.common.tryAgain} onAction={() => load(0)} />
      ) : rows.length === 0 ? (
        <MessagePanel kind="empty" icon="Arena" title={query ? t.community.noMatch : t.community.emptyTitle}
          body={query ? t.community.noMatchBody : scope === 'partners' ? t.community.noPartners : t.community.emptyBody} />
      ) : (
        <View style={{ gap: 8 }} accessibilityRole="list">
          {rows.map((m) => <MemberRow key={m.user_id} m={m} period={period} />)}
          {board && rows.length < board.total ? (
            <Button kind="glass" label={t.community.more(board.total - rows.length)} onPress={() => load(rows.length)} loading={state === 'more'} disabled={state === 'more'} />
          ) : null}
        </View>
      )}
      <T variant="caption" tone="tertiary" align="center">{t.community.footer}</T>
    </Screen>
  );
}
