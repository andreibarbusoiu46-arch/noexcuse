import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { api } from '@/data';
import { t } from '@/i18n';
import { confirmDestructive } from '@/lib/dialog';
import { errorText } from '@/lib/errors';
import { haptics } from '@/lib/haptics';
import { color, radius } from '@/theme/tokens';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { T } from './Text';

const MAX_SOURCE_BYTES = 20 * 1024 * 1024; // what we accept from the device before resizing
const OK_TYPES = /^image\/(jpeg|jpg|png|webp|heic|heif)$/i;

/** Square-ish 512 px JPEG, small enough for the 2 MB bucket limit. */
async function toAvatarJpeg(uri: string, width: number, height: number) {
  const ctx = ImageManipulator.manipulate(uri);
  const side = Math.min(width, height);
  if (side > 0) ctx.crop({ originX: Math.round((width - side) / 2), originY: Math.round((height - side) / 2), width: side, height: side });
  ctx.resize({ width: 512, height: 512 });
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ compress: 0.82, format: SaveFormat.JPEG, base64: true });
  if (!out.base64) throw new Error('no image data');
  return { uri: out.uri, base64: out.base64 };
}

/** Upload, preview, replace and remove the profile photo. The server checks the path; storage checks type and size. */
export function PhotoEditor({ name, path, onChanged }: { name: string; path: string | null | undefined; onChanged: () => Promise<void> | void }) {
  const [preview, setPreview] = useState<{ uri: string; base64: string } | null>(null);
  const [busy, setBusy] = useState<'pick' | 'save' | 'remove' | null>(null);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  async function pick(source: 'camera' | 'library') {
    if (busy) return;
    setMsg(null); setBusy('pick');
    try {
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { setMsg({ tone: 'danger', text: t.photo.noCamera }); return; }
      }
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: Platform.OS !== 'web', aspect: [1, 1], quality: 1 };
      const r = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      const a = r.canceled ? null : r.assets[0];
      if (!a) return;
      if (a.mimeType && !OK_TYPES.test(a.mimeType)) { setMsg({ tone: 'danger', text: t.photo.badType }); return; }
      if (a.fileSize && a.fileSize > MAX_SOURCE_BYTES) { setMsg({ tone: 'danger', text: t.photo.tooBig }); return; }
      setPreview(await toAvatarJpeg(a.uri, a.width, a.height));
    } catch {
      haptics.error();
      setMsg({ tone: 'danger', text: t.photo.readFail });
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!preview || busy) return;
    setBusy('save'); setMsg(null);
    try {
      await api.setAvatar({ base64: preview.base64 });
      await onChanged();
      setPreview(null);
      haptics.success();
      setMsg({ tone: 'success', text: t.photo.saved });
    } catch (e) {
      haptics.error();
      setMsg({ tone: 'danger', text: errorText(e) });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (busy) return;
    if (!(await confirmDestructive(t.photo.removeQ, t.photo.removeBody, t.photo.remove))) return;
    setBusy('remove'); setMsg(null);
    try {
      await api.removeAvatar();
      await onChanged();
      haptics.success();
      setMsg({ tone: 'success', text: t.photo.removed });
    } catch (e) {
      haptics.error();
      setMsg({ tone: 'danger', text: errorText(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={{ gap: 14, padding: 16, borderRadius: radius.lg, backgroundColor: color.surface.card, borderWidth: 1, borderColor: color.border.hairline }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <Avatar name={name} path={path} uri={preview?.uri} size={84} ring={!!preview} />
        <View style={{ flex: 1, gap: 4 }}>
          <T variant="bodyStrong">{preview ? t.photo.previewTitle : t.photo.title}</T>
          <T variant="caption" tone="tertiary">{preview ? t.photo.previewBody : t.photo.body}</T>
        </View>
      </View>
      {preview ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Button label={t.photo.save} onPress={save} loading={busy === 'save'} disabled={!!busy && busy !== 'save'} /></View>
          <View style={{ flex: 1 }}><Button kind="glass" label={t.common.cancel} onPress={() => setPreview(null)} disabled={!!busy} /></View>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <Button kind="glass" icon="Camera" label={t.photo.camera} onPress={() => pick('camera')} disabled={!!busy} />
          <Button kind="glass" icon="Plus" label={path ? t.photo.replace : t.photo.library} onPress={() => pick('library')} loading={busy === 'pick'} disabled={!!busy && busy !== 'pick'} />
          {path ? <Button kind="ghost" label={t.photo.remove} onPress={remove} loading={busy === 'remove'} disabled={!!busy && busy !== 'remove'} /> : null}
        </View>
      )}
      {msg ? <T variant="caption" tone={msg.tone} accessibilityLiveRegion="polite">{msg.text}</T> : null}
    </View>
  );
}
