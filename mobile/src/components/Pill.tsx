import React from 'react';
import {StyleSheet, View, ViewStyle} from 'react-native';
import {colors, radius, space} from '@/theme';
import {Txt} from './Txt';

interface PillProps {
  label: string;
  /** Small leading dot. Omit for a plain chip. */
  dotColor?: string;
  fg?: string;
  bg?: string;
  style?: ViewStyle;
}

export function Pill({label, dotColor, fg = colors.textSecondary, bg = colors.surfaceRaised, style}: PillProps) {
  return (
    <View accessible accessibilityLabel={label} style={[styles.pill, {backgroundColor: bg}, style]}>
      {dotColor ? <View style={[styles.dot, {backgroundColor: dotColor}]} /> : null}
      <Txt variant="label" color={fg} uppercase>
        {label}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  dot: {width: 6, height: 6, borderRadius: 3, marginRight: space.sm},
});
