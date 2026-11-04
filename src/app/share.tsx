import * as Sharing from 'expo-sharing';
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
import { color } from '@/theme/tokens';

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
          await nav.share({ files: [file], text: `My NoExcuse record · ${config.siteUrl}` });
        } else {
          const a = document.createElement('a');
          a.href = dataUri; a.download = 'noexcuse-record.png'; a.click();
          setMsg('Image downloaded.');
        }
      } else {
        const uri = await captureRef(card, { format: 'png', quality: 1, result: 'tmpfile' });
        if (!(await Sharing.isAvailableAsync())) { setMsg('Sharing isn’t available on this device.'); return; }
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share your record', UTI: 'public.png' });
      }
      haptics.success();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') { haptics.error(); setMsg('Couldn’t create the image. Try again.'); }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen footer={d ? <Button label="Share image" icon="ArrowUp" loading={busy} onPress={share} /> : undefined}>
      <BackHeader overline="Real numbers only" title="Share your record" />
      {q.loading && !d ? <LoadingPanel label="Loading your record…" /> : q.error && !d ? (
        <MessagePanel kind="error" icon="Alert" title="Couldn’t load your record." body="Check your connection and try again." action="Try again" onAction={() => q.reload()} />
      ) : (
        <>
          {/* The captured view is square-cornered and black, so the image has no transparent corners. */}
          <View ref={card} collapsable={false} style={{ alignSelf: 'center', backgroundColor: '#000000', padding: 12 }}>
          <View style={{ width: 320, aspectRatio: 4 / 5, backgroundColor: '#0A0A0B', borderRadius: 28, padding: 26, gap: 16, borderWidth: 1, borderColor: color.border.strong, overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Mark size={34} />
              <T variant="overline" tone="secondary">NoExcuse</T>
            </View>
            <View style={{ flex: 1, justifyContent: 'center', gap: 4 }}>
              <T variant="overline" tone="tertiary">Discipline Score</T>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
                <T variant="numberXL">{score == null ? '—' : String(score)}</T>
                <T variant="bodySmall" tone="tertiary" style={{ marginBottom: 12 }}>/ 100</T>
              </View>
              {d!.room.score?.provisional ? <T variant="caption" tone="tertiary">Calibrating</T> : null}
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {[
                ['Streak', `${d!.room.streak}d`],
                ['Verified', String(d!.stats.habits_completed)],
                ['Success', d!.stats.success_rate == null ? '—' : `${d!.stats.success_rate}%`],
              ].map(([k, v]) => (
                <View key={k} style={{ flex: 1, gap: 2 }}>
                  <T variant="h3">{v}</T>
                  <T variant="caption" tone="tertiary">{k}</T>
                </View>
              ))}
            </View>
            <T variant="caption" tone="secondary">{profile?.display_name ?? ''} · every proof verified live</T>
          </View>
          </View>
          <T variant="caption" tone="tertiary" align="center">Your name, score and totals as recorded on the server. No photos or commitment titles are included.</T>
          {msg && <T variant="bodySmall" tone="secondary" align="center" accessibilityLiveRegion="polite">{msg}</T>}
        </>
      )}
    </Screen>
  );
}
