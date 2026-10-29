import { Text as RNText, type TextProps } from 'react-native';
import { color, type TextColor, type as typeScale, type TypeVariant } from '@/theme/tokens';

export interface TProps extends TextProps {
  variant?: TypeVariant;
  tone?: TextColor;
  align?: 'left' | 'center' | 'right';
}

/** All text in the app. Variants = Figma text styles; tones = Figma text/* variables. */
export function T({ variant = 'body', tone = 'primary', align, style, ...rest }: TProps) {
  return (
    <RNText
      maxFontSizeMultiplier={variant === 'numberXL' || variant === 'hero' ? 1.15 : 1.6}
      {...rest}
      style={[typeScale[variant], { color: color.text[tone] }, align && { textAlign: align }, style]}
    />
  );
}
