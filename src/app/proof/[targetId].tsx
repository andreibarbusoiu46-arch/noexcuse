import { CameraView, useCameraPermissions, type CameraType, type FlashMode } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Image, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Badge } from '@/components/Badge';
import { Button, IconButton } from '@/components/Button';
import { Glass, GlassGroup } from '@/components/Glass';
import { Icon } from '@/components/Icon';
import { Glow, Screen } from '@/components/Screen';
import { Tap } from '@/components/Tap';
import { T } from '@/components/Text';
import { VerdictCard, type VerdictState } from '@/components/Verdict';
import { api, type CaptureSession, type EvidenceKind, type Level, type Target, type VerdictResult } from '@/data';
import { LEVELS } from '@/lib/levels';
import { haptics } from '@/lib/haptics';
import { useNow, useReduceMotion } from '@/lib/hooks';
import { ApiError } from '@/lib/supabase';
import { countdown, formatTime, windowOf } from '@/lib/time';
import { useApp } from '@/providers/AppProvider';
import { color, layout } from '@/theme/tokens';

interface Shot { kind: EvidenceKind; uri: string; base64: string; at: number }

type Phase =
  | { k: 'starting' }
  | { k: 'blocked'; title: string; body: string }
  | { k: 'capture' }
  | { k: 'review' }
  | { k: 'processing'; uri: string }
  | { k: 'result'; r: VerdictResult; uri: string };

/** Camera photos and picked screenshots are normalised to ≤1280 px JPEG before upload. */
async function toJpeg(uri: string, width: number): Promise<{ uri: string; base64: string }> {
  const ctx = ImageManipulator.manipulate(uri);
  if (width > 1280) ctx.resize({ width: 1280 });
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ compress: 0.72, format: SaveFormat.JPEG, base64: true });
  if (!out.base64) throw new Error('no image data');
  return { uri: out.uri, base64: out.base64 };
}

const SESSION_REFRESH_MS = 120_000; // re-issue the capture session if it's older than 2 min (server limit: 3)

function blockedCopy(e: unknown): { title: string; body: string } {
  const code = e instanceof ApiError ? e.code : 'unknown';
  switch (code) {
    case 'window_not_open': return { title: 'Window not open yet.', body: 'The camera unlocks 15 minutes before the target time.' };
    case 'window_closed': return { title: 'This window has closed.', body: 'Late proof doesn’t count. Your next window is on Home.' };
    case 'already_settled': return { title: 'Already settled.', body: 'This target has a final result. Check Recent activity on Home.' };
    case 'premium_required': return { title: 'Premium required.', body: 'Your subscription isn’t active on the server. Restore purchases from Profile.' };
    case 'already_appealed': return { title: 'Already appealed.', body: 'Each rejection gets one appeal.' };
    case 'network': return { title: 'No connection.', body: 'Proof needs a connection so the server can time-stamp it.' };
    default: return { title: 'Couldn’t open the camera.', body: e instanceof Error ? e.message : 'Try again in a moment.' };
  }
}

export default function Proof() {
  const { targetId } = useLocalSearchParams<{ targetId: string }>();
  const { profile, refreshProfile, premium } = useApp();
  const tz = profile?.timezone;
  const [phase, setPhase] = useState<Phase>({ k: 'starting' });
  const [target, setTarget] = useState<Target | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // Strict/Elite need Premium; without it the server judges at Standard, so the app asks for that.
  const level: Level = premium ? (target?.habit.verification_level ?? 'standard') : 'standard';
  const req = LEVELS[level];
  const live = shots.filter((x) => x.kind === 'live');
  const session = useRef<{ s: CaptureSession; at: number } | null>(null);

  async function openSession() {
    const s = await api.startProof(targetId);
    session.current = { s, at: Date.now() };
    return s;
  }

  useEffect(() => {
    (async () => {
      try {
        const [t] = await Promise.all([api.getTarget(targetId), openSession()]);
        setTarget(t);
        setPhase({ k: 'capture' });
      } catch (e) {
        haptics.warning();
        setPhase({ k: 'blocked', ...blockedCopy(e) });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId]);

  function onShot(uri: string, base64: string) {
    const next = [...shots, { kind: 'live' as const, uri, base64, at: Date.now() }];
    setShots(next);
    setNotice(null);
    setPhase(next.filter((x) => x.kind === 'live').length >= req.live ? { k: 'review' } : { k: 'capture' });
  }

  function retakeAll() {
    setShots([]); setNotice(null);
    setPhase({ k: 'capture' });
  }

  async function submit() {
    const first = live[0];
    if (!first) return;
    setPhase({ k: 'processing', uri: first.uri });
    try {
      if (!session.current || Date.now() - session.current.at > SESSION_REFRESH_MS) await openSession();
      const r = await api.verifyProof(session.current!.s.session_id, shots.map(({ kind, base64 }) => ({ kind, base64 })));
      session.current = null;
      ({ verified: haptics.success, rejected: haptics.error, expired: haptics.error, insufficient: haptics.warning, error: haptics.warning } as const)[r.outcome]();
      setPhase({ k: 'result', r, uri: first.uri });
      void refreshProfile();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      if (code === 'capture_expired' || code === 'capture_used') {
        haptics.warning();
        session.current = null;
        await openSession().catch(() => {});
        setShots([]);
        setNotice('The capture timed out. Take the photos again.');
        setPhase({ k: 'capture' });
        return;
      }
      if (code === 'duplicate_evidence' || code === 'evidence_incomplete') {
        // Session not spent: fix the evidence and submit again.
        haptics.warning();
        setNotice((e as Error).message);
        setPhase({ k: 'review' });
        return;
      }
      haptics.error();
      setPhase({ k: 'blocked', ...blockedCopy(e) });
    }
  }

  if (phase.k === 'starting') {
    return <View style={[styles.fill, styles.center]}><ActivityIndicator color={color.text.secondary} /></View>;
  }
  if (phase.k === 'blocked') {
    return (
      <Screen glow="grey" scroll={false} contentStyle={{ justifyContent: 'center' }} footer={<Button label="Back to Home" onPress={() => router.back()} />}>
        <View style={{ gap: 12, alignItems: 'center' }}>
          <Icon name="Lock" size={36} tint={color.icon.secondary} />
          <T variant="h2" align="center">{phase.title}</T>
          <T tone="secondary" align="center">{phase.body}</T>
        </View>
      </Screen>
    );
  }
  if (phase.k === 'capture') {
    const step = live.length;
    return <Capture target={target} tz={tz} onShot={onShot}
      step={req.live > 1 ? `Photo ${step + 1} of ${req.live} · ${req.steps[step] ?? ''}` : null} />;
  }
  if (phase.k === 'review') {
    return <Review target={target} tz={tz} level={level} shots={shots} notice={notice}
      onRetakeAll={retakeAll}
      onAddScreenshot={(sh) => { setShots((p) => [...p, sh]); setNotice(null); }}
      onRemove={(i) => setShots((p) => p.filter((_x, j) => j !== i))}
      onSubmit={submit} />;
  }
  if (phase.k === 'processing') return <Processing uri={phase.uri} title={target?.habit.title ?? 'your target'} />;
  return <Result r={phase.r} target={target} premium={premium} onRetake={async () => { await openSession().catch(() => {}); retakeAll(); }} />;
}

// ---------------------------------------------------------------- E1 capture
function Capture({ target, tz, onShot, step }: { target: Target | null; tz?: string; onShot: (uri: string, b64: string) => void; step: string | null }) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [busy, setBusy] = useState(false);
  const now = useNow(1000);
  const closes = target ? windowOf(target.due_at).closesAt : null;

  async function shoot() {
    if (!cam.current || !ready || busy) return;
    haptics.heavy();
    setBusy(true);
    try {
      const pic = await cam.current.takePictureAsync({ quality: 0.85, shutterSound: true });
      const out = await toJpeg(pic.uri, pic.width);
      onShot(out.uri, out.base64);
    } catch {
      haptics.error();
    } finally {
      setBusy(false);
    }
  }

  if (!permission) return <View style={[styles.fill, styles.center]}><ActivityIndicator color={color.text.secondary} /></View>;
  if (!permission.granted) {
    return (
      <Screen glow="violet" scroll={false} contentStyle={{ justifyContent: 'center' }}
        footer={<>
          {permission.canAskAgain
            ? <Button label="Allow camera" icon="Camera" onPress={requestPermission} />
            : <Button label="Open Settings" icon="Settings" onPress={() => Linking.openSettings()} />}
          <Button kind="ghost" label="Not now" onPress={() => router.back()} />
        </>}>
        <View style={{ gap: 12, alignItems: 'center' }}>
          <Icon name="Camera" size={40} tint={color.accent.glow} />
          <T variant="h2" align="center">Proof is live — camera only.</T>
          <T tone="secondary" align="center">NoExcuse takes a photo only when you press the shutter. Gallery uploads aren’t accepted.</T>
        </View>
      </Screen>
    );
  }

  return (
    <View style={styles.fill}>
      <CameraView ref={cam} style={StyleSheet.absoluteFill} facing={facing} flash={flash} mode="picture" animateShutter onCameraReady={() => setReady(true)} />
      {/* frame guide */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
        <View style={{ width: '76%', aspectRatio: 300 / 380, borderRadius: 18, borderWidth: 2, borderColor: 'rgba(255,255,255,0.55)', borderStyle: 'dashed' }} />
      </View>
      <View style={[styles.topBar, { top: insets.top + 8 }]}>
        <IconButton icon="Close" label="Close camera" onPress={() => router.back()} />
        <Glass variant="clear" fallback="rgba(10,10,11,0.72)" style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 22, alignItems: 'center', maxWidth: '62%', overflow: 'hidden' }}>
          <T variant="caption" numberOfLines={1}>{target?.habit.title ?? 'Proof'}</T>
          {closes && <T variant="caption" tone="accent">{countdown(closes - now)} left in window</T>}
        </Glass>
        <IconButton icon={flash === 'on' ? 'Flash' : 'FlashOff'} label={flash === 'on' ? 'Flash on' : 'Flash off'} onPress={() => setFlash((f) => (f === 'on' ? 'off' : 'on'))} />
      </View>
      {step ? (
        <View style={[styles.hint, { top: insets.top + 64 }]} pointerEvents="none">
          <Glass variant="clear" fallback="rgba(10,10,11,0.72)" style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, overflow: 'hidden' }}>
            <T variant="caption" accessibilityLiveRegion="polite">{step}</T>
          </Glass>
        </View>
      ) : null}
      {target?.habit.proof_hint ? (
        <View style={[styles.hint, { bottom: insets.bottom + 150 }]} pointerEvents="none">
          <Glass variant="clear" fallback="rgba(10,10,11,0.72)" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 22, overflow: 'hidden' }}>
            <Icon name="Sparkle" size={16} tint={color.ai.accent} />
            <T variant="caption" numberOfLines={2} style={{ flexShrink: 1 }}>{target.habit.proof_hint}</T>
          </Glass>
        </View>
      ) : null}
      <View style={[styles.dockWrap, { bottom: insets.bottom + 16 }]}>
        <GlassGroup spacing={16}>
          <Glass variant="regular" fallback="rgba(17,17,19,0.86)" style={styles.dock}>
            <View style={{ alignItems: 'center', gap: 4, width: 64 }} accessible accessibilityLabel="Gallery uploads are disabled">
              <View style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: color.surface.glass, borderWidth: 1, borderColor: color.border.hairline }}>
                <Icon name="NoGallery" size={20} tint={color.icon.secondary} />
              </View>
              <T variant="tab" tone="tertiary">No gallery</T>
            </View>
            <Tap haptic="rigid" dim={false} onPress={shoot} disabled={!ready || busy} accessibilityLabel="Take proof photo"
              style={{ width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
              {busy ? <ActivityIndicator color="#FFFFFF" /> : <View style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: '#FFFFFF' }} />}
            </Tap>
            <View style={{ alignItems: 'center', gap: 4, width: 64 }}>
              <IconButton icon="Flip" label="Flip camera" onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))} />
              <T variant="tab" tone="tertiary">Flip</T>
            </View>
          </Glass>
        </GlassGroup>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- E2 review
function Review({ target, tz, level, shots, notice, onRetakeAll, onAddScreenshot, onRemove, onSubmit }: {
  target: Target | null; tz?: string; level: Level; shots: Shot[]; notice: string | null;
  onRetakeAll: () => void; onAddScreenshot: (s: Shot) => void; onRemove: (i: number) => void; onSubmit: () => void;
}) {
  const now = useNow(1000);
  const closes = target ? windowOf(target.due_at).closesAt : null;
  const req = LEVELS[level];
  const screenshots = shots.filter((x) => x.kind === 'screenshot').length;
  const missingShot = screenshots < req.screenshotsRequired;
  const [picking, setPicking] = useState(false);

  async function pick() {
    setPicking(true);
    try {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, quality: 1 });
      const a = r.canceled ? null : r.assets[0];
      if (a) {
        const out = await toJpeg(a.uri, a.width);
        onAddScreenshot({ kind: 'screenshot', uri: out.uri, base64: out.base64, at: Date.now() });
      }
    } catch {
      haptics.error();
    } finally {
      setPicking(false);
    }
  }

  return (
    <Screen glow="none" footer={<>
      <Button label="Submit for verification" icon="Sparkle" onPress={onSubmit} disabled={missingShot || (closes !== null && now > closes + 60_000)} />
      <Button kind="glass" label={req.live > 1 ? 'Retake photos' : 'Retake'} icon="Retry" onPress={onRetakeAll} />
      <T variant="caption" tone="tertiary" align="center">Submitted proof can’t be edited. The AI judges only what’s visible.</T>
    </>}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <IconButton icon="ChevronLeft" label="Retake" onPress={onRetakeAll} />
        <T variant="h3" align="center" style={{ flex: 1 }}>Review proof</T>
        <View style={{ width: 44 }} />
      </View>
      {req.live === 1 && screenshots === 0 ? (
        <View style={{ borderRadius: 28, overflow: 'hidden', borderWidth: 1, borderColor: color.border.strong }}>
          <Image source={{ uri: shots[0]?.uri }} style={{ width: '100%', aspectRatio: 3 / 4 }} resizeMode="cover" accessibilityLabel="Your proof photo" />
          <View style={{ position: 'absolute', top: 14, left: 14, flexDirection: 'row', gap: 8 }}>
            <Badge tone="success" label="Live capture" />
            {shots[0] && <Badge tone="neutral" label={formatTime(shots[0].at, tz)} />}
          </View>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
          {shots.map((sh, i) => (
            <View key={`${sh.uri}-${i}`} style={{ width: 200, borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: color.border.strong }}>
              <Image source={{ uri: sh.uri }} style={{ width: 200, height: 266 }} resizeMode="cover" accessibilityLabel={sh.kind === 'live' ? `Live photo ${i + 1}` : 'Screenshot'} />
              <View style={{ position: 'absolute', top: 10, left: 10, flexDirection: 'row', gap: 6 }}>
                <Badge tone={sh.kind === 'live' ? 'success' : 'warning'} label={sh.kind === 'live' ? 'Live' : 'Screenshot'} />
              </View>
              {sh.kind === 'screenshot' && (
                <View style={{ position: 'absolute', top: 6, right: 6 }}>
                  <IconButton icon="Close" label="Remove screenshot" onPress={() => onRemove(i)} />
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Badge tone="accent" label={`${req.label} verification`} />
        <T variant="caption" tone="tertiary" style={{ flex: 1 }}>{req.summary}</T>
      </View>
      {req.screenshotsMax > 0 && screenshots < req.screenshotsMax && (
        <Button kind="glass" icon="Plus" loading={picking}
          label={missingShot ? 'Add tracking-app screenshot (required)' : 'Add a screenshot (optional)'} onPress={pick} />
      )}
      {req.screenshotsMax > 0 && (
        <T variant="caption" tone="tertiary">Screenshots come from your gallery, so they count as lower-trust supporting evidence. Reused images are refused.</T>
      )}
      {notice && (
        <View style={{ padding: 14, borderRadius: 16, backgroundColor: color.status.warningSoft }} accessibilityLiveRegion="assertive">
          <T variant="bodySmall" tone="warning">{notice}</T>
        </View>
      )}
      {target && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 20, backgroundColor: color.surface.card, borderWidth: 1, borderColor: color.border.hairline }}>
          <View style={{ flex: 1, gap: 2 }}>
            <T variant="bodyStrong" numberOfLines={1}>{target.habit.title}</T>
            <T variant="caption" tone="tertiary">Window closes {formatTime(windowOf(target.due_at).closesAt, tz)}</T>
          </View>
          {closes && <T variant="h3" tone={closes - now < 120_000 ? 'warning' : 'accent'}>{countdown(closes - now)}</T>}
        </View>
      )}
    </Screen>
  );
}

// ---------------------------------------------------------------- F1 processing
function Processing({ uri, title }: { uri: string; title: string }) {
  const reduce = useReduceMotion();
  const [y] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(y, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(y, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduce, y]);
  return (
    <Screen glow="ice" contentStyle={{ alignItems: 'center' }} footer={<Button kind="ghost" label="Back to Home — we’ll notify you" onPress={() => router.back()} />}>
      <View style={{ height: 24 }} />
      <View style={{ width: 220, height: 280, borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: color.ai.accent }}>
        <Image source={{ uri }} style={{ width: '100%', height: '100%' }} accessibilityIgnoresInvertColors />
        {!reduce && (
          <Animated.View style={{ position: 'absolute', left: 0, right: 0, height: 3, backgroundColor: color.ai.accent, shadowColor: color.ai.accent, shadowOpacity: 0.9, shadowRadius: 12,
            transform: [{ translateY: y.interpolate({ inputRange: [0, 1], outputRange: [8, 268] }) }] }} />
        )}
      </View>
      <VerdictCard state="processing" critique={`Comparing the photo with your target: ${title}. This usually takes under 10 seconds.`} points="Pending" streak="—" />
    </Screen>
  );
}

// ---------------------------------------------------------------- F2–F6 results
function Result({ r, target, premium, onRetake }: { r: VerdictResult; target: Target | null; premium: boolean; onRetake: () => void }) {
  const now = useNow(1000);
  const currentStreak = target?.habit.current_streak ?? 0;
  const closes = target ? windowOf(target.due_at).closesAt : 0;
  const stillOpen = closes > now;
  const s = r.outcome as VerdictState;

  const big = { verified: `+${r.points_delta || 50}`, rejected: '−100', expired: '−100', insufficient: stillOpen ? countdown(closes - now) : '0', error: '0' }[r.outcome];
  const bigTone = { verified: 'success', rejected: 'danger', expired: 'danger', insufficient: 'warning', error: 'secondary' }[r.outcome] as 'success' | 'danger' | 'warning' | 'secondary';
  const over = { verified: 'Proof verified', rejected: 'Proof rejected', expired: 'Window closed', insufficient: stillOpen ? 'Needs more evidence' : 'Not enough evidence', error: 'Temporary error' }[r.outcome];
  const streakLine = r.already_settled ? 'Already settled — no change'
    : r.outcome === 'verified' ? `${r.streak ?? currentStreak + 1}-day streak · ${(r.total_points ?? 0).toLocaleString('en-US')} pts`
    : r.outcome === 'rejected' || r.outcome === 'expired' ? `Streak reset · ${(r.total_points ?? 0).toLocaleString('en-US')} pts`
    : r.outcome === 'insufficient' ? `${currentStreak}-day streak held · retake to keep it` : `${currentStreak}-day streak safe · no penalty`;
  const points = r.already_settled ? '0' : { verified: '+50', rejected: '−100', expired: '−100', insufficient: '0', error: '0' }[r.outcome];
  const streak = r.outcome === 'verified' ? `${r.streak ?? currentStreak + 1} days` : r.outcome === 'rejected' || r.outcome === 'expired' ? 'Reset to 0' : `${currentStreak} days`;
  const glow = { verified: 'green', rejected: 'red', expired: 'red', insufficient: 'amber', error: 'grey' }[r.outcome] as 'green' | 'red' | 'amber' | 'grey';

  const actions = r.outcome === 'verified' ? (
    <>
      <Button label="Back to Home" onPress={() => router.back()} />
      <Button kind="ghost" label="See your Arena rank" onPress={() => { router.back(); router.navigate('/arena'); }} />
    </>
  ) : r.outcome === 'insufficient' ? (
    <>
      {stillOpen && <Button label="Capture more evidence" icon="Camera" onPress={onRetake} />}
      <Button kind={stillOpen ? 'ghost' : 'primary'} label="Back to Home" onPress={() => router.back()} />
      <T variant="caption" tone="tertiary" align="center">If the window closes without a valid proof, it counts as missed.</T>
    </>
  ) : r.outcome === 'error' ? (
    <>
      <Button label="Back to Home" onPress={() => router.back()} />
      <T variant="caption" tone="tertiary" align="center">Your proof is saved with the time it reached the server. It will be re-checked automatically — if we can’t, there’s no penalty.</T>
    </>
  ) : (
    <>
      {r.outcome === 'rejected' && target && !r.already_settled && (
        <Button kind="glass" label={premium ? 'Appeal — ask for a second AI review' : 'Appeal (Premium)'} icon="Shield"
          onPress={() => { router.back(); router.push(premium ? { pathname: '/appeal/[targetId]', params: { targetId: target.id } } : '/paywall'); }} />
      )}
      <Button label="Plan the comeback" onPress={() => { router.back(); if (target) router.push({ pathname: '/comeback/[habitId]', params: { habitId: target.habit_id } }); }} />
      <Button kind="ghost" label="Done" onPress={() => router.back()} />
      {r.outcome === 'expired' && <T variant="caption" tone="tertiary" align="center">Times are checked on the server, not your phone clock.</T>}
    </>
  );

  return (
    <View style={styles.fill}>
      <Glow tone={glow} />
      <Screen glow="none" contentStyle={{ alignItems: 'center' }} footer={actions}>
        <View style={{ height: 48 }} />
        <T variant="overline" tone={bigTone === 'secondary' ? 'secondary' : bigTone}>{over}</T>
        <T variant="numberXL" tone={bigTone} accessibilityRole="header">{big}</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="Flame" size={18} tint={r.outcome === 'rejected' || r.outcome === 'expired' ? color.icon.secondary : color.accent.glow} />
          <T variant="bodyStrong" tone={r.outcome === 'verified' ? 'primary' : 'secondary'}>{streakLine}</T>
        </View>
        <VerdictCard state={s} critique={r.critique} points={points} streak={streak} />
        {r.outcome === 'insufficient' && r.requested_evidence ? (
          <View style={{ alignSelf: 'stretch', padding: 16, borderRadius: 20, gap: 4, backgroundColor: color.status.warningSoft }} accessible>
            <T variant="overline" tone="warning">Capture next</T>
            <T variant="bodySmall">{r.requested_evidence}</T>
          </View>
        ) : null}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  topBar: { position: 'absolute', left: layout.gutter, right: layout.gutter, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hint: { position: 'absolute', left: layout.gutter, right: layout.gutter, alignItems: 'center' },
  dockWrap: { position: 'absolute', left: layout.gutter, right: layout.gutter, alignItems: 'center' },
  dock: { width: '100%', maxWidth: 420, height: 104, borderRadius: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, overflow: 'hidden', borderWidth: 0 },
});

