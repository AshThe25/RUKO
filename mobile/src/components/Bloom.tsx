import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StyleSheet, View, ViewStyle} from 'react-native';
import {colors, motion} from '@/theme';
import {useReducedMotion} from './useReducedMotion';

/**
 * The ambient bloom from the landing page, rebuilt for the phone.
 *
 * The site runs warm amber into calm indigo because that is the product's arc:
 * alarm resolving into calm. Bringing it into the app means someone who
 * installs from the site recognises what they installed.
 *
 * Built from stacked translucent circles rather than a gradient library. The
 * project has no SVG or gradient dependency and adding one to draw a decorative
 * shape is a poor trade — twenty overlapping views composite on the GPU and
 * cost nothing. Alpha accumulates toward the centre, which is what makes the
 * falloff read as a soft radial glow rather than a flat disc.
 */
interface BloomProps {
  /** Diameter of the widest ring. */
  size?: number;
  /** Warm first, cool second — the order the arc runs in. */
  tint?: 'warm' | 'cool' | 'duo';
  /** Slow drift. Disabled automatically under reduce-motion. */
  animated?: boolean;
  style?: ViewStyle;
}

const RINGS = 9;

export function Bloom({size = 300, tint = 'duo', animated = true, style}: BloomProps) {
  const reduceMotion = useReducedMotion();
  const drift = useRef(new Animated.Value(0)).current;
  // Breathing is a second, slower cycle than the drift. One value doing both
  // ties the swell to the sideways travel, and the pair moving in lockstep
  // reads as a single mechanical loop rather than something alive.
  const breath = useRef(new Animated.Value(0)).current;
  const shouldAnimate = animated && !reduceMotion;

  useEffect(() => {
    if (!shouldAnimate) {
      drift.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, {
          toValue: 1,
          duration: motion.slow * 26,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(drift, {
          toValue: 0,
          duration: motion.slow * 26,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    // Roughly the cadence of calm breathing. Slow enough that it is felt
    // rather than watched -- a fast pulse on a security screen reads as alarm.
    const breathing = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: 2400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    breathing.start();
    return () => {
      loop.stop();
      breathing.stop();
    };
  }, [drift, breath, shouldAnimate]);

  const warmShift = drift.interpolate({inputRange: [0, 1], outputRange: [0, size * 0.05]});
  const coolShift = drift.interpolate({inputRange: [0, 1], outputRange: [0, -size * 0.05]});
  // The two layers breathe slightly out of phase, so the edge softens and
  // firms instead of the whole shape scaling as one disc.
  const warmBreath = breath.interpolate({inputRange: [0, 1], outputRange: [0.82, 1.18]});
  const coolBreath = breath.interpolate({inputRange: [0, 1], outputRange: [1.16, 0.86]});
  const glow = breath.interpolate({inputRange: [0, 1], outputRange: [0.62, 1]});

  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.wrap, {width: size, height: size}, style]}>
      {tint !== 'cool' ? (
        <Animated.View
          style={[
            styles.layer,
            {
              opacity: glow,
              transform: [
                {translateX: warmShift},
                {translateY: warmShift},
                {scale: warmBreath},
              ],
            },
          ]}>
          <Rings color={colors.high} size={size * 0.86} />
        </Animated.View>
      ) : null}
      {tint !== 'warm' ? (
        <Animated.View
          style={[
            styles.layer,
            {
              opacity: glow,
              transform: [
                {translateX: coolShift},
                {translateY: coolShift},
                {scale: coolBreath},
              ],
            },
          ]}>
          <Rings color={colors.accent} size={size} />
        </Animated.View>
      ) : null}
    </View>
  );
}

/** One colour's radial falloff: concentric discs of equal, low alpha. */
function Rings({color, size}: {color: string; size: number}) {
  return (
    <View style={styles.layer}>
      {Array.from({length: RINGS}, (_, i) => {
        // Squared spacing puts more rings near the centre, where a real radial
        // gradient is brightest. Linear spacing reads as a flat disc.
        const t = (RINGS - i) / RINGS;
        const d = size * t * t;
        return (
          <View
            key={i}
            style={[
              styles.ring,
              {
                width: d,
                height: d,
                borderRadius: d / 2,
                backgroundColor: color,
                // Tuned for the light ground: on #FCFCFD the accumulated tint
                // has to be stronger than it would be over near-black before
                // it reads as a glow rather than a smudge.
                opacity: 0.075,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {alignItems: 'center', justifyContent: 'center'},
  layer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {position: 'absolute'},
});
