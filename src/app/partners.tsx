import * as Clipboard from 'expo-clipboard';
import { locale, t } from '@/i18n';
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
import { errorText } from '@/lib/errors';
import { haptics } from '@/lib/haptics';
import { useLoad } from '@/lib/hooks';
import { formatTime } from '@/lib/time';
import { useApp } from '@/providers/AppProvider';
import { color, radius } from '@/theme/tokens';

const TONE: Record<Partner['today'][number]['state'], Tone> = { pending: 'neutral', in_progress: 'accent', verified: 'success', failed: 'danger', excused: 'neutral' };

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
      setMsg({ tone: 'danger', text: errorText(e) });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function shareCode(c: string) {
    const message = t.partners.shareMessage(c, config.siteUrl);
    try { await Share.share({ message }); } catch { await Clipboard.setStringAsync(c); notify(t.partners.copied, c); }
  }

  return (
    <Screen refreshing={q.refreshing} onRefresh={() => q.reload()}>
      <BackHeader overline={d ? t.partners.count(d.partners.length, d.max_partners) : t.partners.overline} title={t.partners.title} />
      {q.loading && !d ? <LoadingPanel label={t.partners.loading} /> : q.error && !d ? (
        <MessagePanel kind="error" icon="Alert" title={t.partners.fail} body={t.common.connection} action={t.common.tryAgain} onAction={() => q.reload()} />
      ) : (
        <>
          {msg && (
            <View style={{ padding: 14, borderRadius: radius.md, backgroundColor: msg.tone === 'danger' ? color.status.dangerSoft : color.surface.glass }} accessibilityLiveRegion="polite">
              <T variant="bodySmall" tone={msg.tone}>{msg.text}</T>
            </View>
          )}
          <T variant="caption" tone="secondary">{t.partners.sees}</T>

          {d!.partners.length === 0 ? (
            <MessagePanel kind="empty" icon="Profile" title={t.partners.empty} body={t.partners.emptyBody} />
          ) : d!.partners.map((p) => {
            const rate = p.week.settled ? Math.round((100 * p.week.verified) / p.week.settled) : null;
            return (
              <Card key={p.id} style={{ padding: 16, gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <Avatar name={p.display_name} size={44} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <T variant="bodyStrong" numberOfLines={1}>{p.display_name}</T>
                    <T variant="caption" tone="tertiary">{t.partners.meta(p.score?.score ?? null, p.streak, rate)}</T>
                  </View>
                </View>
                {p.today.length > 0 && (
                  <View style={{ gap: 0, borderRadius: radius.md, borderWidth: 1, borderColor: color.border.hairline }}>
                    {p.today.map((x, i) => (
                      <View key={`${x.title}-${i}`}>
                        {i > 0 && <Divider />}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 }}>
                          <T variant="bodySmall" numberOfLines={1} style={{ flex: 1 }}>{x.title}</T>
                          <T variant="caption" tone="tertiary">{formatTime(x.due_at, tz)}</T>
                          <Badge tone={TONE[x.state]} label={x.state === 'in_progress' ? t.partners.windowOpen : t.domain.state[x.state]} />
                        </View>
                      </View>
                    ))}
                  </View>
                )}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Button kind="glass" style={{ flex: 1 }} label={p.nudged_today ? t.partners.nudged : t.partners.nudge} icon="Bell" disabled={p.nudged_today}
                    loading={busy === `n-${p.id}`} onPress={() => run(`n-${p.id}`, () => api.nudgePartner(p.id), (sent) => (sent ? t.partners.nudgeSent(p.display_name) : t.partners.nudgedAlready))} />
                  <Button kind="ghost" style={{ flex: 1 }} label={t.partners.remove} loading={busy === `r-${p.id}`}
                    onPress={async () => { if (await confirmDestructive(t.partners.removeTitle(p.display_name), t.partners.removeBody, t.partners.remove)) void run(`r-${p.id}`, () => api.removePartner(p.id)); }} />
                </View>
              </Card>
            );
          })}

          <View style={{ gap: 12 }}>
            <SectionHeader title={t.partners.invite} />
            {d!.can_invite ? (
              <>
                {d!.invites.map((inv) => (
                  <Card key={inv.code} style={{ padding: 16, gap: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <T variant="h2" style={{ flex: 1, letterSpacing: 4 }} selectable accessibilityLabel={t.partners.codeA11y(inv.code.split('').join(' '))}>{inv.code}</T>
                      <T variant="caption" tone="tertiary">{t.partners.expires(new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short' }).format(new Date(inv.expires_at)))}</T>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <Button kind="glass" style={{ flex: 1 }} label={t.partners.share} onPress={() => shareCode(inv.code)} />
                      <Button kind="ghost" style={{ flex: 1 }} label={t.partners.copy} onPress={async () => { await Clipboard.setStringAsync(inv.code); haptics.success(); setMsg({ tone: 'success', text: t.partners.copied }); }} />
                    </View>
                    <Button kind="ghost" label={t.partners.revoke} loading={busy === `v-${inv.code}`} onPress={() => run(`v-${inv.code}`, () => api.revokePartnerInvite(inv.code))} />
                  </Card>
                ))}
                {d!.partners.length < d!.max_partners && (
                  <Button kind="glass" icon="Plus" label={t.partners.create} loading={busy === 'create'}
                    onPress={() => run('create', () => api.createPartnerInvite(), (r) => t.partners.created(r.code))} />
                )}
              </>
            ) : (
              <Card tone="accent" style={{ padding: 16, gap: 8 }}>
                <T variant="bodyStrong">{t.partners.premiumTitle}</T>
                <T variant="caption" tone="secondary">{t.partners.premiumBody}</T>
                <Button label={t.common.seePremium} onPress={() => router.push('/paywall')} />
              </Card>
            )}
          </View>

          <View style={{ gap: 12 }}>
            <SectionHeader title={t.partners.haveCode} />
            <Field label={t.partners.codeLabel} value={code} onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
              placeholder={t.partners.codePlaceholder} autoCapitalize="characters" autoCorrect={false} />
            <Button label={t.partners.join} disabled={code.length !== 8} loading={busy === 'accept'}
              onPress={() => run('accept', () => api.acceptPartnerInvite(code), (r) => { setCode(''); return t.partners.joined(r.display_name); })} />
          </View>

        </>
      )}
    </Screen>
  );
}
