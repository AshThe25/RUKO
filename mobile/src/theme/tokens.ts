/**
 * Ruko design tokens — the app's single source of colour, type and spacing.
 *
 * These are the website's exact values (web/index.html), not an approximation.
 * Ruko is a fraud-intervention product: it interrupts someone at the moment
 * they are being pressured into paying. That demands calm and trust, not the
 * dark "cyber-security" register, so the app is light like the site and holds
 * near-black for one thing only — engineering diagnostics, which are not part
 * of the customer experience.
 *
 * The colour language carries meaning, and each hue means exactly one thing:
 *
 *   ground   creates calm            — 70-80% of any screen
 *   ink      creates trust           — every value that matters
 *   cool     is Ruko itself          — local intelligence, protection, focus
 *   warm     is pressure             — urgency, manipulation, "pay attention"
 *   danger   is intervention         — only when a payment must stop
 *   success  is a verified outcome   — never merely "not bad"
 *
 * Never hard-code a colour in a screen. If something is missing, add it here.
 */

/** The raw brand values. Nothing outside this file should use them directly. */
export const palette = {
  ground: '#FCFCFD',
  surface: '#FFFFFF',
  surfaceSoft: '#F6F6F8',
  ink: '#17171B',
  inkSecondary: '#43434E',
  muted: '#767683',
  warm: '#FF8A3D',
  cool: '#8B93F8',
  danger: '#C0392B',
  success: '#3F8F5F',
  darkSurface: '#0E0F12',
  onDark: '#F2F2F2',
} as const;

export const colors = {
  /* surfaces — light, borders instead of shadows */
  bg: palette.ground,
  surface: palette.surface,
  /** Secondary information, timelines, quiet regions, grouped settings. */
  surfaceRaised: palette.surfaceSoft,
  surfacePressed: 'rgba(23, 23, 27, 0.06)',
  border: 'rgba(23, 23, 27, 0.10)',
  borderStrong: 'rgba(23, 23, 27, 0.18)',

  /* text */
  text: palette.ink,
  textSecondary: palette.inkSecondary,
  textTertiary: palette.muted,
  /** For text sitting on ink or on a saturated fill. */
  textInverse: palette.surface,

  /* Ruko itself: local intelligence, active protection, focus */
  accent: palette.cool,
  accentPressed: '#727BE8',
  accentSurface: 'rgba(139, 147, 248, 0.10)',

  /* risk — never used alone; always paired with a label and an explanation */
  safe: palette.success,
  safeSurface: 'rgba(63, 143, 95, 0.08)',
  /** "Watching": Ruko is paying attention, nothing is wrong yet. */
  medium: palette.cool,
  mediumSurface: 'rgba(139, 147, 248, 0.10)',
  /** Pressure and urgency. Not danger — the moment Ruko starts caring. */
  high: palette.warm,
  highSurface: 'rgba(255, 138, 61, 0.10)',
  /** Confirmed critical. A payment that must be stopped. */
  critical: palette.danger,
  criticalSurface: 'rgba(192, 57, 43, 0.09)',

  /* status */
  offline: palette.muted,
  online: palette.success,

  /**
   * Technical surfaces — engineering mode, runtime logs, device capability.
   * Deliberately the only dark ground in the app, so a diagnostics screen can
   * never be mistaken for something a customer is meant to act on.
   */
  darkBg: palette.darkSurface,
  darkSurface: '#16181D',
  darkBorder: 'rgba(242, 242, 242, 0.12)',
  darkText: palette.onDark,
  darkTextSecondary: 'rgba(242, 242, 242, 0.62)',
} as const;

/**
 * Risk is never communicated by colour alone.
 *
 * Every band carries a label, a glyph and a plain-language meaning, so the
 * state survives colour blindness, a greyscale screenshot, and a screen reader.
 */
export const riskPalette = {
  LOW: {
    fg: colors.safe,
    surface: colors.safeSurface,
    label: 'SAFE',
    glyph: '✓',
    meaning: 'Ruko checked this and found nothing wrong.',
  },
  MEDIUM: {
    fg: colors.medium,
    surface: colors.mediumSurface,
    label: 'WATCHING',
    glyph: '•',
    meaning: 'Something is slightly unusual. Ruko is paying attention.',
  },
  HIGH: {
    fg: colors.high,
    surface: colors.highSurface,
    label: 'PRESSURE',
    glyph: '!',
    meaning: 'Someone appears to be pushing you into this payment.',
  },
  CRITICAL: {
    fg: colors.critical,
    surface: colors.criticalSurface,
    label: 'STOP',
    glyph: '✕',
    meaning: 'This has the shape of a scam. Ruko is asking you not to pay.',
  },
} as const;

/**
 * The signature gradient: pressure resolving into calm.
 *
 * Reserved for the splash, the onboarding hero, the app icon and the
 * protection animation. Never behind body text, never behind every card.
 */
export const glow = {
  warm: 'rgba(255, 138, 61, 0.35)',
  cool: 'rgba(139, 147, 248, 0.35)',
} as const;

/**
 * Typefaces.
 *
 * NOTE: these families only render once the font files are bundled and linked
 * on the native side — that lives in `mobile/android`, which this workstream
 * does not own. Until then React Native silently falls back to the system
 * face, so `undefined` is used rather than a name that would fail quietly and
 * leave us thinking the serif shipped when it did not.
 */
export const fonts = {
  /** Instrument Serif. Hero statements and onboarding headlines only. */
  display: undefined as string | undefined,
  /** Manrope. The entire interface: buttons, body, values, labels. */
  body: undefined as string | undefined,
} as const;

/** 4pt base grid. Use these, never raw numbers, in screen layout. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

export const type = {
  display: {fontSize: 44, lineHeight: 48, fontWeight: '700' as const, letterSpacing: -1.2},
  title: {fontSize: 28, lineHeight: 34, fontWeight: '700' as const, letterSpacing: -0.6},
  heading: {fontSize: 20, lineHeight: 26, fontWeight: '600' as const, letterSpacing: -0.3},
  body: {fontSize: 15, lineHeight: 22, fontWeight: '400' as const, letterSpacing: 0},
  bodyStrong: {fontSize: 15, lineHeight: 22, fontWeight: '600' as const, letterSpacing: 0},
  caption: {fontSize: 13, lineHeight: 18, fontWeight: '400' as const, letterSpacing: 0},
  /** All-caps micro labels. Always paired with letterSpacing. */
  label: {fontSize: 11, lineHeight: 14, fontWeight: '600' as const, letterSpacing: 1.1},
  /** Tabular numerals for money and scores. */
  mono: {fontSize: 15, lineHeight: 20, fontWeight: '500' as const, letterSpacing: 0.2},
} as const;

export const motion = {
  /** Ruko never animates for delight. Durations are short and purposeful. */
  fast: 140,
  base: 220,
  slow: 380,
  /** Cadence of the investigation feed, ms between tool results. */
  investigationStep: 620,
} as const;

export const layout = {
  screenPadding: space.xl,
  maxContentWidth: 520,
  hitSlop: {top: 8, bottom: 8, left: 8, right: 8},
} as const;
