import React from 'react';
import {StyleSheet, View} from 'react-native';
import {colors, radius, space} from '@/theme';

interface ProgressDotsProps {
  count: number;
  index: number;
  label?: string;
}

/**
 * Position in a short flow. The active dot is a bar rather than a bigger
 * circle — the width difference is legible at a glance without relying on
 * colour, which matters for anyone who cannot tell the two tones apart.
 */
export function ProgressDots({count, index, label}: ProgressDotsProps) {
  return (
    <View
      style={styles.row}
      accessibilityRole="progressbar"
      accessibilityValue={{min: 1, max: count, now: index + 1}}
      accessibilityLabel={label ?? `Step ${index + 1} of ${count}`}>
      {Array.from({length: count}, (_, i) => (
        <View key={i} style={[styles.dot, i === index ? styles.active : null]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center'},
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    marginRight: space.sm,
  },
  active: {width: 22, backgroundColor: colors.text},
});
