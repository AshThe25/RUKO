import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StyleSheet, View, ViewStyle} from 'react-native';
import {colors} from '@/theme';
import {useReducedMotion} from './useReducedMotion';

/**
 * The ambient bloom, as a lotus.
 *
 * The site runs warm amber into calm indigo because that is the product's arc:
 * alarm resolving into calm. Concentric discs carried the colour but said
 * nothing — a lotus is the right form for a product about protection in India,
 * and it reads as care rather than as a scanner or a radar sweep.
 *
 * Two rings of petals, the outer offset by half a step so the gaps of one sit
 * behind the mass of the other. Each petal is a single View: a rounded corner
 * on opposing sides makes a leaf, and rotating it about a translated origin
 * arranges the ring. That keeps the whole thing free of any SVG or gradient
 * dependency — adding a native module to draw a decorative shape is a poor
 * trade, and twenty translucent views composite on the GPU for nothing.
 *
 * Alpha accumulates where petals overlap, which is what gives the soft falloff
 * toward the centre without a real gradient.
 */
interface BloomProps {
  size?: number;
  /** Warm first, cool second — the order the arc runs in. */
  tint?: 'warm' | 'cool' | 'duo';
  animated?: boolean;
  style?: ViewStyle;
}

const OUTER_PETALS = 12;
const INNER_PETALS = 10;

export function Bloom({size = 260, tint = 'duo', animated = true, style}: BloomProps) {
  const reduceMotion = useReducedMotion();
  const breath = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const shouldAnimate = animated && !reduceMotion;

  useEffect(() => {
    if (!shouldAnimate) {
      breath.setValue(0.5);
      spin.setValue(0);
      return;
    }
    // Roughly the cadence of calm breathing. Slow enough to be felt rather than
    // watched: a fast pulse on a security screen reads as alarm.
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
    // A very slow turn, under a degree a second. It should never be caught
    // moving; it should only look different if you come back to it.
    const turning = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 48000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    breathing.start();
    turning.start();
    return () => {
      breathing.stop();
      turning.stop();
    };
  }, [breath, spin, shouldAnimate]);

  const outerScale = breath.interpolate({inputRange: [0, 1], outputRange: [0.86, 1.14]});
  const innerScale = breath.interpolate({inputRange: [0, 1], outputRange: [1.12, 0.9]});
  const glow = breath.interpolate({inputRange: [0, 1], outputRange: [0.62, 1]});
  const turn = spin.interpolate({inputRange: [0, 1], outputRange: ['0deg', '360deg']});
  const counterTurn = spin.interpolate({inputRange: [0, 1], outputRange: ['0deg', '-360deg']});

  const warm = tint !== 'cool';
  const cool = tint !== 'warm';

  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[styles.wrap, {width: size, height: size}, style]}>
      {/* Outer ring: the wider, warmer skirt of the flower. */}
      {warm ? (
        <Animated.View
          style={[
            styles.layer,
            {opacity: glow, transform: [{rotate: turn}, {scale: outerScale}]},
          ]}>
          <PetalRing
            count={OUTER_PETALS}
            size={size}
            length={size * 0.44}
            width={size * 0.34}
            color={colors.high}
            offset={0}
          />
        </Animated.View>
      ) : null}

      {/* Inner ring: cooler, half-step offset, breathing against the outer. */}
      {cool ? (
        <Animated.View
          style={[
            styles.layer,
            {opacity: glow, transform: [{rotate: counterTurn}, {scale: innerScale}]},
          ]}>
          <PetalRing
            count={INNER_PETALS}
            size={size}
            length={size * 0.3}
            width={size * 0.26}
            color={colors.accent}
            offset={180 / INNER_PETALS}
          />
        </Animated.View>
      ) : null}

      {/* The centre, built from stacked translucent discs. A single solid one
          acquired a hard edge and read as a button rather than as the place the
          glow is brightest. */}
      <Animated.View style={[styles.layer, {opacity: glow, transform: [{scale: innerScale}]}]}>
        {[0.34, 0.26, 0.18, 0.11].map(f => (
          <View
            key={f}
            style={[
              styles.seed,
              {width: size * f, height: size * f, borderRadius: (size * f) / 2},
            ]}
          />
        ))}
      </Animated.View>
    </View>
  );
}

/**
 * One ring of petals. Each is rotated about the centre and pushed outward, so
 * the ring is described by rotation alone rather than by trigonometry per item.
 */
function PetalRing({
  count,
  size,
  length,
  width,
  color,
  offset,
}: {
  count: number;
  size: number;
  length: number;
  width: number;
  color: string;
  offset: number;
}) {
  return (
    <View style={styles.layer}>
      {Array.from({length: count}, (_, i) => {
        const angle = offset + (360 / count) * i;
        return (
          <View
            key={i}
            style={[
              styles.petal,
              {
                width,
                height: length,
                backgroundColor: color,
                // Rounded on opposing corners: a leaf, not a lozenge.
                borderTopLeftRadius: width,
                borderTopRightRadius: width,
                borderBottomLeftRadius: width * 0.28,
                borderBottomRightRadius: width * 0.28,
                transform: [
                  {rotate: `${angle}deg`},
                  // Push along the petal's own axis so it radiates from centre.
                  {translateY: -length * 0.42},
                ],
                marginLeft: -width / 2,
                marginTop: -length / 2,
                left: size / 2,
                top: size / 2,
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
  layer: {...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center'},
  // Low enough that a single petal is barely visible: the shape should
  // emerge from where they overlap, the way a real glow falls off.
  petal: {position: 'absolute', opacity: 0.07},
  seed: {position: 'absolute', backgroundColor: colors.accent, opacity: 0.06},
});
