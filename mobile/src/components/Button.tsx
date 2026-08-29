import React from 'react';
import {ActivityIndicator, Pressable, StyleSheet, View, ViewStyle} from 'react-native';
import {colors, radius, space} from '@/theme';
import {Txt} from './Txt';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  /** Sub-label under the main label, e.g. "Recommended". */
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
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{disabled: !!disabled || !!loading}}
      disabled={disabled || loading}
      onPress={onPress}
      style={({pressed}) => [
        styles.base,
        {backgroundColor: v.bg, borderColor: v.border},
        pressed && !disabled ? styles.pressed : null,
        disabled ? styles.disabled : null,
        style,
      ]}>
      <View style={styles.content}>
        {loading ? <ActivityIndicator color={v.fg} style={styles.spinner} /> : null}
        <Txt variant="bodyStrong" color={v.fg}>
          {label}
        </Txt>
      </View>
      {hint ? (
        <Txt variant="caption" color={v.hint} style={styles.hint}>
          {hint}
        </Txt>
      ) : null}
    </Pressable>
  );
}

const variants: Record<Variant, {bg: string; fg: string; border: string; hint: string}> = {
  primary: {
    bg: colors.text,
    fg: colors.textInverse,
    border: colors.text,
    hint: colors.textInverse,
  },
  secondary: {
    bg: 'transparent',
    fg: colors.text,
    border: colors.borderStrong,
    hint: colors.textSecondary,
  },
  danger: {
    bg: colors.critical,
    fg: '#0B0405',
    border: colors.critical,
    hint: '#0B0405',
  },
  ghost: {
    bg: 'transparent',
    fg: colors.textSecondary,
    border: 'transparent',
    hint: colors.textTertiary,
  },
  quiet: {
    bg: colors.surfaceRaised,
    fg: colors.text,
    border: colors.border,
    hint: colors.textSecondary,
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
  pressed: {opacity: 0.82},
  disabled: {opacity: 0.4},
  hint: {marginTop: 2},
});
