/**
 * Ruko design tokens.
 *
 * Ruko is quiet until it matters. The palette is near-black with one
 * restrained accent; risk colours are calm, not alarming — a security product
 * that shouts at the user every day gets uninstalled before the day it
 * actually needs to be believed.
 *
 * These are the landing page's values, not an approximation of them. The site
 * renders light, but the phone it shows in the hero is this screen, so the app
 * matches that mock: #0E0F12 ground, coral for risk, indigo for information.
 * A person who installs from the site should recognise what they installed.
 */

export const colors = {
  /* surfaces */
  bg: '#0E0F12',            /* site: the phone mock's screen */
  surface: '#16181D',
  surfaceRaised: '#1C1F26',
  surfacePressed: '#232730',
  border: '#252932',
  borderStrong: '#333944',

  /* text */
  text: '#F2F4F7',
  textSecondary: '#9BA3AF',
  textTertiary: '#666E7A',
  textInverse: '#0E0F12',

  /* brand — used sparingly, never as decoration */
  accent: '#8B93F8',        /* site: --cool */
  accentPressed: '#727BE8',

  /* risk — calm, desaturated, readable on near-black */
  safe: '#5FBF87',          /* site: --safe on dark */
  safeSurface: '#11221B',
  medium: '#D9A441',
  mediumSurface: '#241C10',
  high: '#FF8A3D',          /* site: --warm */
  highSurface: '#26170E',
  critical: '#FF6B5A',      /* site: --critical on dark */
  criticalSurface: '#2A1512',

  /* status */
  offline: '#666E7A',
  online: '#5FBF87',
} as const;

export const riskPalette = {
  LOW: {fg: colors.safe, surface: colors.safeSurface, label: 'SAFE'},
  MEDIUM: {fg: colors.medium, surface: colors.mediumSurface, label: 'CAUTION'},
  HIGH: {fg: colors.high, surface: colors.highSurface, label: 'HIGH RISK'},
  CRITICAL: {fg: colors.critical, surface: colors.criticalSurface, label: 'CRITICAL'},
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
