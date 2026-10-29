// Mirrors the Figma variables in "NoExcuse — iOS App" (collections Primitives, Color/Dark, Spacing, Radius)
// and the 13 text styles. Change a value here and in Figma together.

export const palette = {
  obsidian950: '#07070A',
  obsidian900: '#0C0C11',
  obsidian850: '#111118',
  obsidian800: '#16161E',
  obsidian700: '#1E1E28',
  obsidian600: '#2A2A36',
  obsidian500: '#3A3A48',
  silver400: '#A3A3B5',
  silver300: '#C3C3D0',
  silver200: '#E1E1E8',
  white: '#FFFFFF',
  violet700: '#4A2FD0',
  violet600: '#6243F0',
  violet500: '#7C5CFF',
  violet400: '#9C85FF',
  violet300: '#BEB0FF',
  ice400: '#6FD3FF',
  green400: '#3DDC97',
  amber400: '#FFB547',
  red400: '#FF5C6C',
} as const;

export const color = {
  bg: { base: palette.obsidian950, elevated: palette.obsidian900 },
  surface: {
    card: palette.obsidian850,
    raised: palette.obsidian800,
    inset: palette.obsidian700,
    control: palette.obsidian600,
    glass: 'rgba(255,255,255,0.07)',
    glassStrong: 'rgba(255,255,255,0.10)',
    glassFaint: 'rgba(255,255,255,0.04)',
  },
  overlay: { scrim: 'rgba(0,0,0,0.6)' },
  border: { hairline: 'rgba(255,255,255,0.10)', strong: 'rgba(255,255,255,0.16)', accent: 'rgba(124,92,255,0.32)' },
  text: {
    primary: palette.white,
    secondary: palette.silver300,
    tertiary: palette.silver400,
    accent: palette.violet400,
    ai: palette.ice400,
    onLight: palette.obsidian950,
    success: palette.green400,
    warning: palette.amber400,
    danger: palette.red400,
  },
  accent: { primary: palette.violet600, pressed: palette.violet700, glow: palette.violet500, soft: 'rgba(124,92,255,0.16)' },
  ai: { accent: palette.ice400, soft: 'rgba(111,211,255,0.14)' },
  status: {
    success: palette.green400,
    successSoft: 'rgba(61,220,151,0.14)',
    warning: palette.amber400,
    warningSoft: 'rgba(255,181,71,0.14)',
    danger: palette.red400,
    dangerSoft: 'rgba(255,92,108,0.14)',
  },
  icon: { primary: palette.white, secondary: palette.silver400 },
} as const;

export const space = { 2: 2, 4: 4, 8: 8, 12: 12, 16: 16, 20: 20, 24: 24, 32: 32, 40: 40, 56: 56 } as const;
export const radius = { sm: 10, md: 16, lg: 22, xl: 28, full: 999 } as const;

/** Screen side gutter and the widest a content column gets on iPad / large phones. */
export const layout = { gutter: 16, maxContentWidth: 560, tabBarClearance: 96 } as const;

export const font = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  extrabold: 'Inter_800ExtraBold',
} as const;

// letterSpacing in Figma is a percent of font size → px here.
const ls = (size: number, pct: number) => (size * pct) / 100;

export const type = {
  hero: { fontFamily: font.extrabold, fontSize: 48, lineHeight: 50, letterSpacing: ls(48, -4) },
  numberXL: { fontFamily: font.extrabold, fontSize: 72, lineHeight: 74, letterSpacing: ls(72, -4) },
  numberL: { fontFamily: font.bold, fontSize: 44, lineHeight: 46, letterSpacing: ls(44, -3) },
  h1: { fontFamily: font.bold, fontSize: 34, lineHeight: 38, letterSpacing: ls(34, -2.5) },
  h2: { fontFamily: font.bold, fontSize: 24, lineHeight: 28, letterSpacing: ls(24, -1.5) },
  h3: { fontFamily: font.semibold, fontSize: 19, lineHeight: 24, letterSpacing: ls(19, -1) },
  bodyStrong: { fontFamily: font.semibold, fontSize: 16, lineHeight: 22, letterSpacing: ls(16, -0.5) },
  body: { fontFamily: font.regular, fontSize: 16, lineHeight: 23, letterSpacing: ls(16, -0.3) },
  bodySmall: { fontFamily: font.regular, fontSize: 14, lineHeight: 20, letterSpacing: ls(14, -0.2) },
  button: { fontFamily: font.semibold, fontSize: 17, lineHeight: 22, letterSpacing: ls(17, -0.4) },
  caption: { fontFamily: font.medium, fontSize: 13, lineHeight: 17, letterSpacing: 0 },
  overline: { fontFamily: font.semibold, fontSize: 11, lineHeight: 14, letterSpacing: ls(11, 8), textTransform: 'uppercase' as const },
  tab: { fontFamily: font.medium, fontSize: 10, lineHeight: 12, letterSpacing: ls(10, 0.5) },
} as const;

export type TypeVariant = keyof typeof type;
export type TextColor = keyof typeof color.text;
