import { CameraView, useCameraPermissions, type CameraType, type FlashMode } from 'expo-camera';
import { fmtNumber, t } from '@/i18n';
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
import { level as levelInfo } from '@/lib/levels';
import { errorText } from '@/lib/errors';
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

// The camera preview is always dark, whatever the app theme.
const ON_CAMERA = '#FFFFFF';
const ON_CAMERA_DIM = 'rgba(255,255,255,0.7)';

const SESSION_REFRESH_MS = 120_000; // re-issue the capture session if it's older than 2 min (server limit: 3)

function blockedCopy(e: unknown): { title: string; body: string } {
  const code = e instanceof ApiError ? e.code : 'unknown';
  switch (code) {
    case 'window_not_open': case 'window_closed': case 'already_settled': case 'network': return t.proof.blocked[code];
    default: return { title: t.proof.blocked.other.title, body: e instanceof Error ? errorText(e) : t.proof.blocked.other.body };
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
  const req = levelInfo(level);
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
        setNotice(t.proof.timedOut);
        setPhase({ k: 'capture' });
        return;
      }
      if (code === 'duplicate_evidence' || code === 'evidence_incomplete') {
        // Session not spent: fix the evidence and submit again.
        haptics.warning();
        setNotice(errorText(e));
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
      <Screen glow="grey" scroll={false} contentStyle={{ justifyContent: 'center' }} footer={<Button label={t.proof.backHome} onPress={() => router.back()} />}>
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
      step={req.live > 1 ? t.proof.photoStep(step + 1, req.live, req.steps[step] ?? '') : null} />;
  }
  if (phase.k === 'review') {
    return <Review target={target} tz={tz} level={level} shots={shots} notice={notice}
      onRetakeAll={retakeAll}
      onAddScreenshot={(sh) => { setShots((p) => [...p, sh]); setNotice(null); }}
      onRemove={(i) => setShots((p) => p.filter((_x, j) => j !== i))}
      onSubmit={submit} />;
  }
  if (phase.k === 'processing') return <Processing uri={phase.uri} title={target?.habit.title ?? ''} />;
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
            ? <Button label={t.proof.allowCamera} icon="Camera" onPress={requestPermission} />
            : <Button label={t.proof.openSettings} icon="Settings" onPress={() => Linking.openSettings()} />}
          <Button kind="ghost" label={t.common.notNow} onPress={() => router.back()} />
        </>}>
        <View style={{ gap: 12, alignItems: 'center' }}>
          <Icon name="Camera" size={40} tint={color.accent.glow} />
          <T variant="h2" align="center">{t.proof.cameraTitle}</T>
          <T tone="secondary" align="center">{t.proof.cameraBody}</T>
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
        <IconButton icon="Close" label={t.proof.closeCamera} tint={ON_CAMERA} onPress={() => router.back()} />
        <Glass variant="clear" fallback="rgba(10,10,11,0.72)" style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 22, alignItems: 'center', maxWidth: '62%', overflow: 'hidden' }}>
          <T variant="caption" numberOfLines={1} style={{ color: ON_CAMERA }}>{target?.habit.title ?? t.proof.proof}</T>
          {closes && <T variant="caption" style={{ color: ON_CAMERA }}>{t.proof.leftInWindow(countdown(closes - now))}</T>}
        </Glass>
        <IconButton icon={flash === 'on' ? 'Flash' : 'FlashOff'} label={flash === 'on' ? t.proof.flashOn : t.proof.flashOff} tint={ON_CAMERA} onPress={() => setFlash((f) => (f === 'on' ? 'off' : 'on'))} />
      </View>
      {step ? (
        <View style={[styles.hint, { top: insets.top + 64 }]} pointerEvents="none">
          <Glass variant="clear" fallback="rgba(10,10,11,0.72)" style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, overflow: 'hidden' }}>
            <T variant="caption" accessibilityLiveRegion="polite" style={{ color: ON_CAMERA }}>{step}</T>
          </Glass>
        </View>
      ) : null}
      {target?.habit.proof_hint ? (
        <View style={[styles.hint, { bottom: insets.bottom + 150 }]} pointerEvents="none">
          <Glass variant="clear" fallback="rgba(10,10,11,0.72)" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 22, overflow: 'hidden' }}>
            <Icon name="Sparkle" size={16} tint={color.ai.accent} />
            <T variant="caption" numberOfLines={2} style={{ flexShrink: 1, color: ON_CAMERA }}>{target.habit.proof_hint}</T>
          </Glass>
        </View>
      ) : null}
      <View style={[styles.dockWrap, { bottom: insets.bottom + 16 }]}>
        <GlassGroup spacing={16}>
          <Glass variant="regular" fallback="rgba(17,17,19,0.86)" style={styles.dock}>
            <View style={{ alignItems: 'center', gap: 4, width: 64 }} accessible accessibilityLabel={t.proof.noGalleryA11y}>
              <View style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                <Icon name="NoGallery" size={20} tint={ON_CAMERA_DIM} />
              </View>
              <T variant="tab" style={{ color: ON_CAMERA_DIM }}>{t.proof.noGallery}</T>
            </View>
            <Tap haptic="rigid" dim={false} onPress={shoot} disabled={!ready || busy} accessibilityLabel={t.proof.shoot}
              style={{ width: 78, height: 78, borderRadius: 39, borderWidth: 4, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
              {busy ? <ActivityIndicator color="#FFFFFF" /> : <View style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: '#FFFFFF' }} />}
            </Tap>
            <View style={{ alignItems: 'center', gap: 4, width: 64 }}>
              <IconButton icon="Flip" label={t.proof.flipA11y} tint={ON_CAMERA} onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))} />
              <T variant="tab" style={{ color: ON_CAMERA_DIM }}>{t.proof.flip}</T>
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
  const req = levelInfo(level);
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
      <Button label={t.proof.submit} icon="Sparkle" onPress={onSubmit} disabled={missingShot || (closes !== null && now > closes + 60_000)} />
      <Button kind="glass" label={req.live > 1 ? t.proof.retakeAll : t.proof.retake} icon="Retry" onPress={onRetakeAll} />
      <T variant="caption" tone="tertiary" align="center">{t.proof.cantEdit}</T>
    </>}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <IconButton icon="ChevronLeft" label={t.proof.retake} onPress={onRetakeAll} />
        <T variant="h3" align="center" style={{ flex: 1 }}>{t.proof.review}</T>
        <View style={{ width: 44 }} />
      </View>
      {req.live === 1 && screenshots === 0 ? (
        <View style={{ borderRadius: 28, overflow: 'hidden', borderWidth: 1, borderColor: color.border.strong }}>
          <Image source={{ uri: shots[0]?.uri }} style={{ width: '100%', aspectRatio: 3 / 4 }} resizeMode="cover" accessibilityLabel={t.proof.yourPhoto} />
          <View style={{ position: 'absolute', top: 14, left: 14, flexDirection: 'row', gap: 8 }}>
            <Badge tone="success" label={t.proof.liveCapture} />
            {shots[0] && <Badge tone="neutral" label={formatTime(shots[0].at, tz)} />}
          </View>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
          {shots.map((sh, i) => (
            <View key={`${sh.uri}-${i}`} style={{ width: 200, borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: color.border.strong }}>
              <Image source={{ uri: sh.uri }} style={{ width: 200, height: 266 }} resizeMode="cover" accessibilityLabel={sh.kind === 'live' ? t.proof.livePhoto(i + 1) : t.proof.screenshot} />
              <View style={{ position: 'absolute', top: 10, left: 10, flexDirection: 'row', gap: 6 }}>
                <Badge tone={sh.kind === 'live' ? 'success' : 'warning'} label={sh.kind === 'live' ? t.proof.live : t.proof.screenshot} />
              </View>
              {sh.kind === 'screenshot' && (
                <View style={{ position: 'absolute', top: 6, right: 6 }}>
                  <IconButton icon="Close" label={t.proof.removeShot} onPress={() => onRemove(i)} />
                </View>
              )}
            </View>
          ))}
        </ScrollView>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Badge tone="accent" label={t.domain.levelBadge(req.label)} />
        <T variant="caption" tone="tertiary" style={{ flex: 1 }}>{req.summary}</T>
      </View>
      {req.screenshotsMax > 0 && screenshots < req.screenshotsMax && (
        <Button kind="glass" icon="Plus" loading={picking}
          label={missingShot ? t.proof.addShotRequired : t.proof.addShot} onPress={pick} />
      )}
      {req.screenshotsMax > 0 && (
        <T variant="caption" tone="tertiary">{t.proof.shotHelp}</T>
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
            <T variant="caption" tone="tertiary">{t.proof.windowCloses(formatTime(windowOf(target.due_at).closesAt, tz))}</T>
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
    <Screen glow="ice" contentStyle={{ alignItems: 'center' }} footer={<Button kind="ghost" label={t.proof.backHomeNotify} onPress={() => router.back()} />}>
      <View style={{ height: 24 }} />
      <View style={{ width: 220, height: 280, borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: color.ai.accent }}>
        <Image source={{ uri }} style={{ width: '100%', height: '100%' }} accessibilityIgnoresInvertColors />
        {!reduce && (
          <Animated.View style={{ position: 'absolute', left: 0, right: 0, height: 3, backgroundColor: color.ai.accent, shadowColor: color.ai.accent, shadowOpacity: 0.9, shadowRadius: 12,
            transform: [{ translateY: y.interpolate({ inputRange: [0, 1], outputRange: [8, 268] }) }] }} />
        )}
      </View>
      <VerdictCard state="processing" critique={t.proof.comparing(title)} points={t.proof.pending} streak="—" />
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
  const over = { verified: t.proof.over.verified, rejected: t.proof.over.rejected, expired: t.proof.over.expired, insufficient: stillOpen ? t.proof.over.insufficientOpen : t.proof.over.insufficient, error: t.proof.over.error }[r.outcome];
  const streakLine = r.already_settled ? t.proof.alreadySettled
    : r.outcome === 'verified' ? t.proof.verifiedLine(r.streak ?? currentStreak + 1, fmtNumber(r.total_points ?? 0))
    : r.outcome === 'rejected' || r.outcome === 'expired' ? t.proof.resetLine(fmtNumber(r.total_points ?? 0))
    : r.outcome === 'insufficient' ? t.proof.heldLine(currentStreak) : t.proof.safeLine(currentStreak);
  const points = r.already_settled ? '0' : { verified: '+50', rejected: '−100', expired: '−100', insufficient: '0', error: '0' }[r.outcome];
  const streak = r.outcome === 'verified' ? t.proof.streakDays(r.streak ?? currentStreak + 1) : r.outcome === 'rejected' || r.outcome === 'expired' ? t.proof.resetTo0 : t.proof.streakDays(currentStreak);
  const glow = { verified: 'green', rejected: 'red', expired: 'red', insufficient: 'amber', error: 'grey' }[r.outcome] as 'green' | 'red' | 'amber' | 'grey';

  const actions = r.outcome === 'verified' ? (
    <>
      <Button label={t.proof.backHome} onPress={() => router.back()} />
      <Button kind="ghost" label={t.proof.seeArena} onPress={() => { router.back(); router.navigate('/arena'); }} />
    </>
  ) : r.outcome === 'insufficient' ? (
    <>
      {stillOpen && <Button label={t.proof.captureMore} icon="Camera" onPress={onRetake} />}
      <Button kind={stillOpen ? 'ghost' : 'primary'} label={t.proof.backHome} onPress={() => router.back()} />
      <T variant="caption" tone="tertiary" align="center">{t.proof.missedIfClosed}</T>
    </>
  ) : r.outcome === 'error' ? (
    <>
      <Button label={t.proof.backHome} onPress={() => router.back()} />
      <T variant="caption" tone="tertiary" align="center">{t.proof.savedRecheck}</T>
    </>
  ) : (
    <>
      {r.outcome === 'rejected' && target && !r.already_settled && (
        <Button kind="glass" label={premium ? t.proof.appeal : t.proof.appealPremium} icon="Shield"
          onPress={() => { router.back(); router.push(premium ? { pathname: '/appeal/[targetId]', params: { targetId: target.id } } : '/paywall'); }} />
      )}
      <Button label={t.proof.comeback} onPress={() => { router.back(); if (target) router.push({ pathname: '/comeback/[habitId]', params: { habitId: target.habit_id } }); }} />
      <Button kind="ghost" label={t.common.done} onPress={() => router.back()} />
      {r.outcome === 'expired' && <T variant="caption" tone="tertiary" align="center">{t.proof.serverClock}</T>}
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
            <T variant="overline" tone="warning">{t.proof.captureNext}</T>
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

