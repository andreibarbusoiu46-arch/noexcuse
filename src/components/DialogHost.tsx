import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, View } from 'react-native';
import { t } from '@/i18n';
import { onDialog, type DialogRequest } from '@/lib/dialog';
import { color, radius } from '@/theme/tokens';
import { Button } from './Button';
import { T } from './Text';

/**
 * In-app confirm / notice dialog for the web. Browser dialogs (window.confirm) are blocked inside
 * iframes and some in-app browsers and then answer "no" instantly — which made archive look broken.
 */
export function DialogHost() {
  const [req, setReq] = useState<DialogRequest | null>(null);
  useEffect(() => onDialog(setReq), []);
  if (!req) return null;
  const close = (ok: boolean) => { setReq(null); req.resolve(ok); };
  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => close(false)}>
      <Pressable onPress={() => close(false)} accessibilityLabel={t.common.cancel}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', ...(Platform.OS === 'web' ? { backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' } : null), alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <Pressable onPress={() => {}} accessibilityRole="alert" accessibilityViewIsModal
          style={[{ width: '100%', maxWidth: 420, borderRadius: radius.xl, padding: 22, gap: 18 },
            { backgroundColor: color.bg.elevated, borderWidth: 1, borderColor: color.border.strong },
            Platform.OS === 'web' ? { boxShadow: '0 30px 80px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)' } as object : null]}>
          <View style={{ gap: 8 }}>
            <T variant="h3">{req.title}</T>
            {req.message ? <T variant="body" tone="secondary">{req.message}</T> : null}
          </View>
          {req.kind === 'confirm' ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}><Button kind="glass" label={t.common.cancel} onPress={() => close(false)} /></View>
              <View style={{ flex: 1 }}><Button kind={req.destructive ? 'danger' : 'primary'} label={req.action} onPress={() => close(true)} /></View>
            </View>
          ) : (
            <Button label="OK" onPress={() => close(true)} />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
