import * as Sharing from 'expo-sharing';
import { t } from '@/i18n';
import { useRef, useState } from 'react';
import { Platform, View, type HostInstance } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { BackHeader } from '@/components/BackHeader';
import { Mark } from '@/components/Brand';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { LoadingPanel, MessagePanel } from '@/components/StatePanel';
import { T } from '@/components/Text';
import { api } from '@/data';
import { config } from '@/lib/config';
import { haptics } from '@/lib/haptics';
import { useLoad } from '@/lib/hooks';
import { useApp } from '@/providers/AppProvider';

// The card is always dark (it's an image people post), so its text colours are fixed.
const INK = { primary: '#FFFFFF', secondary: '#C7C7CC', tertiary: '#8E8E93', border: 'rgba(255,255,255,0.18)' };

/** A shareable image of your real record. Every number comes from the server. */
export default function ShareCard() {
  const { profile } = useApp();
  const q = useLoad(async () => {
    const [room, stats] = await Promise.all([api.getWarRoom(), api.getStats()]);
    return { room, stats };
  });
  const card = useRef<HostInstance>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const d = q.data;
  const score = d?.room.score?.score ?? null;

  async function share() {
    if (!card.current) return;
    setBusy(true); setMsg(null);
    try {
      if (Platform.OS === 'web') {
        const dataUri = await captureRef(card, { format: 'png', quality: 1, result: 'data-uri' });
        const blob = await (await fetch(dataUri)).blob();
        const file = new File([blob], 'noexcuse-record.png', { type: 'image/png' });
        const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
        if (nav.share && nav.canShare?.({ files: [file] })) {
          await nav.share({ files: [file], text: t.share.text(config.siteUrl) });
        } else {
          const a = document.createElement('a');
          a.href = dataUri; a.download = 'noexcuse-record.png'; a.click();
          setMsg(t.share.downloaded);
        }
      } else {
        const uri = await captureRef(card, { format: 'png', quality: 1, result: 'tmpfile' });
        if (!(await Sharing.isAvailableAsync())) { setMsg(t.share.unavailable); return; }
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: t.share.title, UTI: 'public.png' });
      }
      haptics.success();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') { haptics.error(); setMsg(t.share.failed); }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen footer={d ? <Button label={t.share.button} icon="ArrowUp" loading={busy} onPress={share} /> : undefined}>
      <BackHeader overline={t.share.overline} title={t.share.title} />
      {q.loading && !d ? <LoadingPanel label={t.share.loading} /> : q.error && !d ? (
        <MessagePanel kind="error" icon="Alert" title={t.share.loadFail} body={t.common.connection} action={t.common.tryAgain} onAction={() => q.reload()} />
      ) : (
        <>
          {/* The captured view is square-cornered and black, so the image has no transparent corners. */}
          <View ref={card} collapsable={false} style={{ alignSelf: 'center', backgroundColor: '#000000', padding: 12 }}>
          <View style={{ width: 320, aspectRatio: 4 / 5, backgroundColor: '#0A0A0B', borderRadius: 28, padding: 26, gap: 16, borderWidth: 1, borderColor: INK.border, overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Mark size={34} />
              <T variant="overline" style={{ color: INK.secondary }}>NoExcuse</T>
            </View>
            <View style={{ flex: 1, justifyContent: 'center', gap: 4 }}>
              <T variant="overline" style={{ color: INK.tertiary }}>{t.share.score}</T>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
                <T variant="numberXL" style={{ color: INK.primary }}>{score == null ? '—' : String(score)}</T>
                <T variant="bodySmall" style={{ marginBottom: 12, color: INK.tertiary }}>/ 100</T>
              </View>
              {d!.room.score?.provisional ? <T variant="caption" style={{ color: INK.tertiary }}>{t.share.calibrating}</T> : null}
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {[
                [t.share.streak, t.share.streakValue(d!.room.streak)],
                [t.share.verified, String(d!.stats.habits_completed)],
                [t.share.success, d!.stats.success_rate == null ? '—' : `${d!.stats.success_rate}%`],
              ].map(([k, v]) => (
                <View key={k} style={{ flex: 1, gap: 2 }}>
                  <T variant="h3" style={{ color: INK.primary }}>{v}</T>
                  <T variant="caption" style={{ color: INK.tertiary }}>{k}</T>
                </View>
              ))}
            </View>
            <T variant="caption" style={{ color: INK.secondary }}>{t.share.footer(profile?.display_name ?? '')}</T>
          </View>
          </View>
          <T variant="caption" tone="tertiary" align="center">{t.share.note}</T>
          {msg && <T variant="bodySmall" tone="secondary" align="center" accessibilityLiveRegion="polite">{msg}</T>}
        </>
      )}
    </Screen>
  );
}
