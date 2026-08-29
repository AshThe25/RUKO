import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StyleSheet, View} from 'react-native';
import {colors, motion, radius, space} from '@/theme';
import {formatPercent} from '@/utils/format';
import {Txt} from './Txt';

interface SignalBarProps {
  label: string;
  value: number;
  /** Above this the bar takes the warning colour. */
  threshold?: number;
  color?: string;
}

/** One manipulation signal, e.g. "Coercion — 91%". */
export function SignalBar({label, value, threshold = 0.6, color}: SignalBarProps) {
  const anim = useRef(new Animated.Value(0)).current;
  const clamped = Math.max(0, Math.min(1, value));
  const fg = color ?? (clamped >= threshold ? colors.critical : colors.textSecondary);

  useEffect(() => {
    Animated.timing(anim, {
      toValue: clamped,
      duration: motion.base,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [anim, clamped]);

  const width = anim.interpolate({inputRange: [0, 1], outputRange: ['0%', '100%']});

  return (
    <View style={styles.wrap} accessibilityLabel={`${label} ${formatPercent(clamped)}`}>
      <View style={styles.row}>
        <Txt variant="caption" tone="secondary">
          {label}
        </Txt>
        <Txt variant="caption" color={fg}>
          {formatPercent(clamped)}
        </Txt>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, {width, backgroundColor: fg}]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {marginBottom: space.md},
  row: {flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6},
  track: {height: 4, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised},
  fill: {height: 4, borderRadius: radius.pill},
});
