// Mirrors the Figma variables in "NoExcuse — iOS App" (collections Primitives, Color/Dark, Spacing, Radius)
// and the 13 text styles. Change a value here and in Figma together.

export const palette = {
  obsidian950: '#000000',
  obsidian900: '#0A0A0B',
  obsidian850: '#111113',
  obsidian800: '#161618',
  obsidian700: '#1F1F22',
  obsidian600: '#2A2A2E',
  obsidian500: '#3A3A3F',
  graphite: '#8C8C92',
  silver400: '#A6A6AC',
  silver300: '#C9C9CE',
  silver200: '#E6E6E9',
  white: '#FFFFFF',
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
  border: { hairline: 'rgba(255,255,255,0.10)', strong: 'rgba(255,255,255,0.18)', accent: 'rgba(255,255,255,0.34)' },
  text: {
    primary: palette.white,
    secondary: palette.silver300,
    tertiary: palette.silver400,
    accent: palette.silver200,
    ai: palette.silver200,
    onLight: palette.obsidian950,
    success: palette.white,
    warning: palette.silver300,
    danger: palette.silver400,
  },
  // Monochrome: the accent is white. Anything drawn ON an accent fill uses text.onLight.
  accent: { primary: palette.white, pressed: '#D9D9DD', glow: palette.white, soft: 'rgba(255,255,255,0.10)' },
  ai: { accent: palette.silver200, soft: 'rgba(255,255,255,0.08)' },
  status: {
    success: palette.white,
    successSoft: 'rgba(255,255,255,0.10)',
    warning: palette.silver300,
    warningSoft: 'rgba(255,255,255,0.06)',
    danger: palette.silver400,
    dangerSoft: 'rgba(255,255,255,0.05)',
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
  serif: 'BodoniModa_500Medium',
  serifBold: 'BodoniModa_600SemiBold',
} as const;

// letterSpacing in Figma is a percent of font size → px here.
const ls = (size: number, pct: number) => (size * pct) / 100;

export const type = {
  hero: { fontFamily: font.serif, fontSize: 52, lineHeight: 54, letterSpacing: ls(52, -3) },
  numberXL: { fontFamily: font.serif, fontSize: 76, lineHeight: 78, letterSpacing: ls(76, -3) },
  numberL: { fontFamily: font.serif, fontSize: 46, lineHeight: 48, letterSpacing: ls(46, -2) },
  h1: { fontFamily: font.serif, fontSize: 36, lineHeight: 40, letterSpacing: ls(36, -1.5) },
  h2: { fontFamily: font.serifBold, fontSize: 26, lineHeight: 30, letterSpacing: ls(26, -1) },
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
