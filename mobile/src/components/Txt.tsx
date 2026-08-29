import React from 'react';
import {StyleSheet, Text as RNText, TextProps} from 'react-native';
import {colors, type as typeScale} from '@/theme';

type Variant = keyof typeof typeScale;
type Tone = 'default' | 'secondary' | 'tertiary' | 'inverse';

export interface TxtProps extends TextProps {
  variant?: Variant;
  tone?: Tone;
  color?: string;
  center?: boolean;
  uppercase?: boolean;
}

const tones: Record<Tone, string> = {
  default: colors.text,
  secondary: colors.textSecondary,
  tertiary: colors.textTertiary,
  inverse: colors.textInverse,
};

/**
 * The only text primitive in the app. Screens never set fontSize directly —
 * that is how a design system stays a system.
 */
export function Txt({
  variant = 'body',
  tone = 'default',
  color,
  center,
  uppercase,
  style,
  children,
  ...rest
}: TxtProps) {
  return (
    <RNText
      allowFontScaling
      style={[
        typeScale[variant],
        {color: color ?? tones[tone]},
        center && styles.center,
        uppercase && styles.uppercase,
        style,
      ]}
      {...rest}>
      {children}
    </RNText>
  );
}

const styles = StyleSheet.create({
  center: {textAlign: 'center'},
  uppercase: {textTransform: 'uppercase'},
});
