import { useState } from 'react';
import { Image, View } from 'react-native';
import { avatarUrl } from '@/lib/avatar';
import { color, font } from '@/theme/tokens';
import { T } from './Text';

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '·';

/**
 * A profile photo, or the user's initials on graphite when there isn't one (or it fails to load).
 * `uri` overrides the stored path (used for the preview before saving).
 */
export function Avatar({ name, path, uri, size = 40, ring = false, me = false }: { name: string; path?: string | null; uri?: string | null; size?: number; ring?: boolean; me?: boolean }) {
  ring = ring || me;
  const [failed, setFailed] = useState<string | null>(null);
  const src = uri ?? avatarUrl(path);
  const show = src && failed !== src;
  return (
    <View accessibilityLabel={name} accessible={false}
      style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
        backgroundColor: color.surface.control, borderWidth: ring ? 2 : 1, borderColor: ring ? color.text.primary : color.border.strong }}>
      {show ? (
        <Image source={{ uri: src }} style={{ width: size, height: size }} resizeMode="cover" onError={() => setFailed(src)} />
      ) : (
        <T style={{ fontFamily: font.semibold, fontSize: Math.round(size * 0.38), lineHeight: Math.round(size * 0.46), color: color.text.secondary }}>
          {initials(name)}
        </T>
      )}
    </View>
  );
}
