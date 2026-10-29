// Small building blocks from the Figma library: Stat Tile, Section Header, Avatar, Icon Tile, Segmented, Day chips, Toggle row.
import type { ReactNode } from 'react';
import { Switch, View } from 'react-native';
import { haptics } from '@/lib/haptics';
import { color, radius, palette } from '@/theme/tokens';
import { Glass, GlassGroup } from './Glass';
import { Icon, type IconName } from './Icon';
import { Tap } from './Tap';
import { T } from './Text';

export function StatTile({ label, value, caption, icon }: { label: string; value: string; caption: string; icon: IconName }) {
  return (
    <View style={{ flex: 1, minWidth: 140, backgroundColor: color.surface.card, borderColor: color.border.hairline, borderWidth: 1, borderRadius: radius.lg, padding: 16, gap: 6 }}
      accessible accessibilityLabel={`${label}: ${value}, ${caption}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon name={icon} size={16} tint={color.accent.glow} />
        <T variant="overline" tone="tertiary" numberOfLines={1} style={{ flexShrink: 1 }}>{label}</T>
      </View>
      <T variant="numberL" adjustsFontSizeToFit numberOfLines={1}>{value}</T>
      <T variant="caption" tone="secondary" numberOfLines={1}>{caption}</T>
    </View>
  );
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <T variant="overline" tone="tertiary" accessibilityRole="header">{title}</T>
      {action && (
        <Tap onPress={onAction} accessibilityRole="link" accessibilityLabel={action}>
          <T variant="caption" tone="accent">{action}</T>
        </Tap>
      )}
    </View>
  );
}

export function Avatar({ name, size = 40, me }: { name: string; size?: number; me?: boolean }) {
  const initials = me ? 'YOU' : name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: me ? color.accent.primary : color.surface.control, borderColor: color.border.strong, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }}>
      <T variant="caption" tone={me ? 'onLight' : 'primary'} style={{ fontSize: Math.max(10, size * 0.32) }}>{initials}</T>
    </View>
  );
}

export function IconTile({ icon, bg, tint, size = 44 }: { icon: IconName; bg: string; tint: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.32, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={size / 2} tint={tint} />
    </View>
  );
}

/** Segmented control on native clear glass. */
export function Segmented<K extends string>({ value, options, onChange }: { value: K; options: { key: K; label: string }[]; onChange: (k: K) => void }) {
  return (
    <GlassGroup spacing={4}>
      <Glass variant="clear" fallback={color.surface.glass} border={color.border.hairline} style={{ flexDirection: 'row', padding: 4, borderRadius: 22, gap: 4 }}>
        {options.map((o) => {
          const on = o.key === value;
          return (
            <Tap key={o.key} haptic="selection" dim={false} onPress={() => onChange(o.key)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={o.label}
              style={{ flex: 1, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? color.surface.glassStrong : 'transparent', borderWidth: on ? 1 : 0, borderColor: color.border.strong }}>
              <T variant="caption" tone={on ? 'primary' : 'tertiary'}>{o.label}</T>
            </Tap>
          );
        })}
      </Glass>
    </GlassGroup>
  );
}

const DAYS = [
  { n: 1, s: 'M', l: 'Monday' }, { n: 2, s: 'T', l: 'Tuesday' }, { n: 3, s: 'W', l: 'Wednesday' }, { n: 4, s: 'T', l: 'Thursday' },
  { n: 5, s: 'F', l: 'Friday' }, { n: 6, s: 'S', l: 'Saturday' }, { n: 7, s: 'S', l: 'Sunday' },
];
export function DayChips({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 4 }}>
      {DAYS.map((d) => {
        const on = value.includes(d.n);
        return (
          <Tap key={d.n} haptic="selection" accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={d.l}
            onPress={() => onChange(on ? value.filter((x) => x !== d.n) : [...value, d.n].sort())}
            style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? color.accent.primary : color.surface.glass, borderWidth: 1, borderColor: on ? color.border.strong : color.border.hairline }}>
            <T variant="bodyStrong" tone={on ? 'onLight' : 'tertiary'}>{d.s}</T>
          </Tap>
        );
      })}
    </View>
  );
}

// React Native Web paints the "on" thumb teal unless told otherwise.
const webSwitchColors = { activeThumbColor: color.text.onLight, activeTrackColor: palette.white } as object;

export function ToggleRow({ title, subtitle, value, onChange, icon, disabled }: { title: string; subtitle?: string; value: boolean; onChange: (v: boolean) => void; icon?: ReactNode; disabled?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      {icon}
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="bodyStrong">{title}</T>
        {subtitle && <T variant="caption" tone="tertiary">{subtitle}</T>}
      </View>
      <Switch value={value} disabled={disabled} accessibilityLabel={title}
        onValueChange={(v) => { haptics.medium(); onChange(v); }}
        trackColor={{ true: color.status.success, false: color.surface.control }} thumbColor={value ? color.text.onLight : palette.white} ios_backgroundColor={color.surface.control}
          {...webSwitchColors} />
    </View>
  );
}
