import DateTimePicker from '@react-native-community/datetimepicker';
import { createElement } from 'react';
import { Platform, View } from 'react-native';
import { haptics } from '@/lib/haptics';
import { color, font, radius, scheme } from '@/theme/tokens';

/** "HH:MM:SS" wall time ⇄ a Date today in the device's zone (only hours and minutes matter). */
const toDate = (hhmmss: string) => { const [h, m] = hhmmss.split(':').map(Number); const d = new Date(); d.setHours(h || 0, m || 0, 0, 0); return d; };
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Exact-minute time picker. Native: the system wheel. Web: the browser's own time input, so typing,
 * arrow keys and mobile pickers all work and a half-typed value never resets the field.
 * The value is local wall time ("HH:MM:SS"); the server applies the profile's time zone.
 */
export function TimeField({ value, onChange, label }: { value: string; onChange: (hhmmss: string) => void; label: string }) {
  if (Platform.OS === 'web') {
    return createElement('input', {
      type: 'time', step: 60, value: value.slice(0, 5), 'aria-label': label,
      onChange: (e: { target: { value: string } }) => {
        const v = e.target.value;
        if (/^\d{2}:\d{2}$/.test(v)) onChange(`${v}:00`);
      },
      style: {
        fontFamily: font.semibold, fontSize: 28, letterSpacing: -0.5, padding: '14px 16px', borderRadius: radius.md,
        border: `1px solid ${color.border.strong}`, background: color.surface.inset, color: color.text.primary,
        colorScheme: scheme(), outline: 'none', width: '100%', boxSizing: 'border-box', minHeight: 64,
      },
    });
  }
  return (
    <View style={{ backgroundColor: color.surface.inset, borderRadius: radius.md, borderWidth: 1, borderColor: color.border.hairline, alignItems: 'center' }}>
      <DateTimePicker value={toDate(value)} mode="time" display="spinner" themeVariant={scheme()} textColor={color.text.primary} accentColor={color.accent.glow}
        accessibilityLabel={label}
        onChange={(_e, d) => { if (d) { haptics.selection(); onChange(`${pad(d.getHours())}:${pad(d.getMinutes())}:00`); } }}
        style={{ height: 150, alignSelf: 'stretch' }} />
    </View>
  );
}
