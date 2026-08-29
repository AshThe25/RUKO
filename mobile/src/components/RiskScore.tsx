import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StyleSheet, View} from 'react-native';
import type {RiskLevel} from '@contracts';
import {colors, motion, radius, riskPalette, space} from '@/theme';
import {Txt} from './Txt';
import {useReducedMotion} from './useReducedMotion';

interface RiskScoreProps {
  score: number;
  level: RiskLevel;
  /** 'display' for the intervention screen, 'inline' for the dashboard. */
  size?: 'display' | 'inline';
  /** Renders "—" instead of a number when the engine could not decide. */
  indeterminate?: boolean;
}

/**
 * A horizontal risk meter rather than a gauge or donut. It reads instantly at
 * a glance and, unlike a dial, it makes the band boundaries visible so the
 * number is never an unexplained verdict.
 */
export function RiskScore({score, level, size = 'inline', indeterminate}: RiskScoreProps) {
  const palette = riskPalette[level];
  const progress = useRef(new Animated.Value(0)).current;
  const clamped = Math.max(0, Math.min(100, score));
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const target = indeterminate ? 0 : clamped / 100;
    // The meter fills to show the score being arrived at, not for delight.
    // Under reduce-motion it simply arrives — the information is identical.
    if (reduceMotion) {
      progress.setValue(target);
      return;
    }
    Animated.timing(progress, {
      toValue: target,
      duration: motion.slow,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [clamped, indeterminate, progress, reduceMotion]);

  const width = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <View>
      <View style={styles.row}>
        <Txt
          variant={size === 'display' ? 'display' : 'title'}
          color={palette.fg}
          accessibilityLabel={`Risk score ${indeterminate ? 'unavailable' : clamped} out of 100`}>
          {indeterminate ? '—' : String(clamped).padStart(2, '0')}
        </Txt>
        <Txt variant="caption" tone="tertiary" style={styles.outOf}>
          / 100
        </Txt>
      </View>
      {/* Colour is never the only carrier: the glyph survives greyscale and
          colour blindness, and the meaning survives both plus a screen reader. */}
      <View style={styles.levelRow}>
        <Txt variant="label" color={palette.fg}>
          {indeterminate ? '—' : palette.glyph}
        </Txt>
        <Txt variant="label" color={palette.fg} uppercase style={styles.level}>
          {indeterminate ? 'NOT ENOUGH SIGNAL' : palette.label}
        </Txt>
      </View>
      {size === 'display' && !indeterminate ? (
        <Txt variant="caption" tone="secondary" style={styles.meaning}>
          {palette.meaning}
        </Txt>
      ) : null}
      <View style={styles.track}>
        <Animated.View style={[styles.fill, {width, backgroundColor: palette.fg}]} />
        {[30, 60, 80].map(tick => (
          <View key={tick} style={[styles.tick, {left: `${tick}%`}]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'flex-end'},
  outOf: {marginLeft: space.sm, marginBottom: 6},
  levelRow: {flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs},
  level: {},
  meaning: {marginTop: space.xs},
  track: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    marginTop: space.md,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  fill: {height: 6, borderRadius: radius.pill},
  tick: {
    position: 'absolute',
    top: 0,
    width: StyleSheet.hairlineWidth,
    height: 6,
    backgroundColor: colors.bg,
  },
});
