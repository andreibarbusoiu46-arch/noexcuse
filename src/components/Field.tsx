import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { color, radius, type as typeScale } from '@/theme/tokens';
import { T } from './Text';

/** Labelled text input on an inset surface (Figma "Input"). */
export function Field(props: React.ComponentProps<typeof TextInput> & { label: string; focusTone?: boolean }) {
  const { label, style, ...rest } = props;
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <T variant="overline" tone="tertiary">{label}</T>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={color.text.tertiary}
        selectionColor={color.accent.glow}
        keyboardAppearance="dark"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        {...rest}
        style={[typeScale.body, { color: color.text.primary, backgroundColor: color.surface.inset, borderRadius: radius.md, borderWidth: 1,
          borderColor: focused ? color.border.accent : color.border.hairline, paddingHorizontal: 16, paddingVertical: 14, minHeight: 52 }, style]}
      />
    </View>
  );
}

