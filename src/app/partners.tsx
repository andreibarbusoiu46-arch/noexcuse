import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { Share, View } from 'react-native';
import { BackHeader } from '@/components/BackHeader';
import { Avatar, SectionHeader } from '@/components/Blocks';
import { Badge, type Tone } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, Divider } from '@/components/Card';
import { Field } from '@/components/Field';
import { Screen } from '@/components/Screen';
import { LoadingPanel, MessagePanel } from '@/components/StatePanel';
import { T } from '@/components/Text';
import { api, type Partner } from '@/data';
import { config } from '@/lib/config';
import { confirmDestructive, notify } from '@/lib/dialog';
import { haptics } from '@/lib/haptics';
import { useLoad } from '@/lib/hooks';
import { formatTime } from '@/lib/time';
import { useApp } from '@/providers/AppProvider';
import { color, radius } from '@/theme/tokens';

const STATE: Record<Partner['today'][number]['state'], { label: string; tone: Tone }> = {
  pending: { label: 'Pending', tone: 'neutral' }, in_progress: { label: 'Window open', tone: 'accent' },
  verified: { label: 'Verified', tone: 'success' }, failed: { label: 'Failed', tone: 'danger' }, excused: { label: 'Excused', tone: 'neutral' },
};

/** Accountability partners: invite by code; see each other's score, streak and today's commitments. */
export default function Partners() {
  const { profile } = useApp();
  const tz = profile?.timezone;
  const q = useLoad(() => api.getPartners());
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const d = q.data;

  async function run<T>(key: string, fn: () => Promise<T>, ok?: (r: T) => string | null) {
    setBusy(key); setMsg(null);
    try {
      const r = await fn();
      const text = ok?.(r) ?? null;
      if (text) setMsg({ tone: 'success', text });
      haptics.success();
      await q.reload({ silent: true });
      return r;
    } catch (e) {
      haptics.error();
      setMsg({ tone: 'danger', text: (e as Error).message.replace(/^premium_required: /, '') });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function shareCode(c: string) {
    const message = `Be my accountability partner on NoExcuse. Enter code ${c} in Profile › Partners. ${config.siteUrl}`;
    try { await Share.share({ message }); } catch { await Clipboard.setStringAsync(c); notify('Code copied', c); }
  }

  return (
    <Screen refreshing={q.refreshing} onRefresh={() => q.reload()}>
      <BackHeader overline={d ? `${d.partners.length} of ${d.max_partners}` : 'Accountability'} title="Partners" />
      {q.loading && !d ? <LoadingPanel label="Loading partners…" /> : q.error && !d ? (
        <MessagePanel kind="error" icon="Alert" title="Couldn’t load partners." body="Check your connection and try again." action="Try again" onAction={() => q.reload()} />
      ) : (
        <>
          {msg && (
            <View style={{ padding: 14, borderRadius: radius.md, backgroundColor: msg.tone === 'danger' ? color.status.dangerSoft : color.surface.glass }} accessibilityLiveRegion="polite">
              <T variant="bodySmall" tone={msg.tone}>{msg.text}</T>
            </View>
          )}
          <T variant="caption" tone="secondary">Partners see your name, Discipline Score, streak, this week’s rate and today’s commitments with their status. Never your photos, AI critiques or private notes.</T>

          {d!.partners.length === 0 ? (
            <MessagePanel kind="empty" icon="Profile" title="No partners yet." body="Invite someone who won’t let you off the hook — or enter their code below." />
          ) : d!.partners.map((p) => {
            const rate = p.week.settled ? Math.round((100 * p.week.verified) / p.week.settled) : null;
            return (
              <Card key={p.id} style={{ padding: 16, gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Avatar name={p.display_name} size={44} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <T variant="bodyStrong" numberOfLines={1}>{p.display_name}</T>
                    <T variant="caption" tone="tertiary">Score {p.score?.score ?? '—'} · {p.streak}-day streak · {rate == null ? 'no results this week' : `${rate}% this week`}</T>
                  </View>
                </View>
                {p.today.length > 0 && (
                  <View style={{ gap: 0, borderRadius: radius.md, borderWidth: 1, borderColor: color.border.hairline }}>
                    {p.today.map((t, i) => (
                      <View key={`${t.title}-${i}`}>
                        {i > 0 && <Divider />}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 }}>
                          <T variant="bodySmall" numberOfLines={1} style={{ flex: 1 }}>{t.title}</T>
                          <T variant="caption" tone="tertiary">{formatTime(t.due_at, tz)}</T>
                          <Badge {...STATE[t.state]} />
                        </View>
                      </View>
                    ))}
                  </View>
                )}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Button kind="glass" style={{ flex: 1 }} label={p.nudged_today ? 'Nudged today' : 'Nudge'} icon="Bell" disabled={p.nudged_today}
                    loading={busy === `n-${p.id}`} onPress={() => run(`n-${p.id}`, () => api.nudgePartner(p.id), (sent) => (sent ? `${p.display_name} gets a nudge.` : 'Already nudged today.'))} />
                  <Button kind="ghost" style={{ flex: 1 }} label="Remove" loading={busy === `r-${p.id}`}
                    onPress={async () => { if (await confirmDestructive(`Remove ${p.display_name}?`, 'You’ll stop seeing each other’s progress.', 'Remove')) void run(`r-${p.id}`, () => api.removePartner(p.id)); }} />
                </View>
              </Card>
            );
          })}

          <View style={{ gap: 12 }}>
            <SectionHeader title="Invite" />
            {d!.can_invite ? (
              <>
                {d!.invites.map((inv) => (
                  <Card key={inv.code} style={{ padding: 16, gap: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <T variant="h2" style={{ flex: 1, letterSpacing: 4 }} selectable accessibilityLabel={`Invite code ${inv.code.split('').join(' ')}`}>{inv.code}</T>
                      <T variant="caption" tone="tertiary">expires {new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(inv.expires_at))}</T>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <Button kind="glass" style={{ flex: 1 }} label="Share" onPress={() => shareCode(inv.code)} />
                      <Button kind="ghost" style={{ flex: 1 }} label="Copy" onPress={async () => { await Clipboard.setStringAsync(inv.code); haptics.success(); setMsg({ tone: 'success', text: 'Code copied.' }); }} />
                    </View>
                    <Button kind="ghost" label="Revoke code" loading={busy === `v-${inv.code}`} onPress={() => run(`v-${inv.code}`, () => api.revokePartnerInvite(inv.code))} />
                  </Card>
                ))}
                {d!.partners.length < d!.max_partners && (
                  <Button kind="glass" icon="Plus" label="Create invite code" loading={busy === 'create'}
                    onPress={() => run('create', () => api.createPartnerInvite(), (r) => `Code ${r.code} — valid for 7 days, single use.`)} />
                )}
              </>
            ) : (
              <Card tone="accent" style={{ padding: 16, gap: 8 }}>
                <T variant="bodyStrong">Creating invites is part of Premium.</T>
                <T variant="caption" tone="secondary">You can still join a Premium member’s circle with their code.</T>
                <Button label="See Premium" onPress={() => router.push('/paywall')} />
              </Card>
            )}
          </View>

          <View style={{ gap: 12 }}>
            <SectionHeader title="Have a code?" />
            <Field label="Partner code" value={code} onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
              placeholder="8 characters" autoCapitalize="characters" autoCorrect={false} />
            <Button label="Join" disabled={code.length !== 8} loading={busy === 'accept'}
              onPress={() => run('accept', () => api.acceptPartnerInvite(code), (r) => { setCode(''); return `You and ${r.display_name} are now partners.`; })} />
          </View>

        </>
      )}
    </Screen>
  );
}
