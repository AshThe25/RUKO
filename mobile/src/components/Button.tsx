import React from 'react';
import {ActivityIndicator, Pressable, StyleSheet, View, ViewStyle} from 'react-native';
import {colors, radius, space} from '@/theme';
import {Txt} from './Txt';

/**
 * Variants encode intent, not appearance. Pick the one that matches what the
 * button *does* and the colour follows — that is what stops a destructive
 * action from ever looking like a neutral one.
 */
type Variant =
  /** The main way forward. Ink on light: maximum trust, no hue. */
  | 'primary'
  /** An alternative that is equally safe. */
  | 'secondary'
  /** Ruko acting on your behalf — protection, investigation, local AI. */
  | 'accent'
  /** Something needs attention. Pressure, not danger. */
  | 'attention'
  /** Stop a payment. Only ever this. */
  | 'danger'
  /** A quiet tertiary action inside a card. */
  | 'quiet'
  /** Lowest emphasis. The override on an intervention lives here. */
  | 'ghost';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  /** Sub-label under the main label, e.g. what continuing actually means. */
  hint?: string;
  style?: ViewStyle;
  testID?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  hint,
  style,
  testID,
}: ButtonProps) {
  const v = variants[variant];
  const inactive = !!disabled || !!loading;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{disabled: inactive}}
      disabled={inactive}
      onPress={onPress}
      style={({pressed}) => [
        styles.base,
        {backgroundColor: v.bg, borderColor: v.border},
        pressed && !inactive ? {backgroundColor: v.pressed} : null,
        disabled ? styles.disabled : null,
        style,
      ]}>
      <View style={styles.content}>
        {loading ? <ActivityIndicator color={v.fg} style={styles.spinner} /> : null}
        <Txt variant="bodyStrong" color={disabled ? colors.textTertiary : v.fg}>
          {label}
        </Txt>
      </View>
      {hint ? (
        <Txt variant="caption" color={disabled ? colors.textTertiary : v.hint} center style={styles.hint}>
          {hint}
        </Txt>
      ) : null}
    </Pressable>
  );
}

const variants: Record<
  Variant,
  {bg: string; pressed: string; fg: string; border: string; hint: string}
> = {
  primary: {
    bg: colors.text,
    pressed: colors.textSecondary,
    fg: colors.textInverse,
    border: colors.text,
    hint: 'rgba(255, 255, 255, 0.72)',
  },
  secondary: {
    bg: colors.surface,
    pressed: colors.surfaceRaised,
    fg: colors.text,
    border: colors.border,
    hint: colors.textSecondary,
  },
  // Ink on periwinkle, not white: #8B93F8 against white is about 2.5:1, which
  // fails contrast outright. Against ink it clears 7:1.
  accent: {
    bg: colors.accent,
    pressed: colors.accentPressed,
    fg: colors.text,
    border: colors.accent,
    hint: colors.text,
  },
  attention: {
    bg: colors.high,
    pressed: '#E87A31',
    fg: colors.text,
    border: colors.high,
    hint: colors.text,
  },
  danger: {
    bg: colors.critical,
    pressed: '#A5312522',
    fg: colors.textInverse,
    border: colors.critical,
    hint: 'rgba(255, 255, 255, 0.78)',
  },
  quiet: {
    bg: colors.surfaceRaised,
    pressed: colors.surfacePressed,
    fg: colors.text,
    border: colors.border,
    hint: colors.textSecondary,
  },
  ghost: {
    bg: 'transparent',
    pressed: colors.surfacePressed,
    fg: colors.textSecondary,
    border: 'transparent',
    hint: colors.textTertiary,
  },
};

const styles = StyleSheet.create({
  base: {
    minHeight: 54,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  content: {flexDirection: 'row', alignItems: 'center'},
  spinner: {marginRight: space.sm},
  disabled: {backgroundColor: colors.surfaceRaised, borderColor: colors.border},
  hint: {marginTop: 2},
});
