import React, {useEffect, useMemo, useRef} from 'react';
import {Animated, Easing, StyleSheet, View} from 'react-native';
import {colors, space} from '@/theme';
import {useReducedMotion} from './useReducedMotion';

const BARS = 34;
const CYCLE_MS = 1600;

/**
 * The listening signature from the landing page, on the phone.
 *
 * Decoration with a job: it is the only visible sign that Ruko is hearing the
 * room, and someone who has granted a microphone deserves to see when it is
 * live rather than take it on trust.
 *
 * Each bar runs the same loop started a little later than its neighbour, so a
 * crest travels along the row. Driving every bar from one shared value made
 * the whole row throb as a single block, which reads as a progress indicator
 * rather than a voice. All of it runs on the native driver: it must never
 * compete with the classifier for the JS thread during a session.
 */
export function AudioMeter({
  active,
  /**
   * 0..1 loudness of the last utterance. The wave reflects what was actually
   * heard: a meter that moves identically in silence teaches people to ignore
   * it. At rest it idles low rather than freezing, so "listening" and "not
   * running" stay distinguishable.
   */
  level = 0.35,
}: {
  active: boolean;
  level?: number;
}) {
  const reduced = useReducedMotion();
  /**
   * One driver for the whole meter, not one per bar.
   *
   * Each bar previously ran its own `Animated.loop`, which meant 34 concurrent
   * looping animations for a single decorative strip -- and the Bloom above it
   * added 22 more. Even on the native driver each loop is separately scheduled
   * and committed every frame, and the cost showed up as jank across the whole
   * app, not just here.
   *
   * A single value sweeping 0 -> 1 forever carries the same information: the
   * per-bar phase offset is applied by interpolating that one value with a
   * shifted input range, so the crest still travels along the row exactly as
   * before while the UI thread animates one node instead of thirty-four.
   */
  const phase = useRef(new Animated.Value(0)).current;
  const amp = useRef(new Animated.Value(0.4)).current;

  // Ease toward the new level. Speech energy is spiky, and a meter that jumps
  // every frame reads as noise rather than a voice.
  useEffect(() => {
    Animated.spring(amp, {
      toValue: 0.3 + Math.max(0, Math.min(1, level)) * 0.7,
      useNativeDriver: true,
      damping: 16,
      stiffness: 90,
      mass: 0.6,
    }).start();
  }, [level, amp]);

  useEffect(() => {
    if (reduced) {
      phase.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(phase, {
        toValue: 1,
        duration: CYCLE_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, reduced]);

  return (
    <View
      style={styles.row}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {Array.from({length: BARS}, (_, i) => {
        const x = i / BARS;
        // Arch envelope: tall in the middle, quiet at the edges, so it reads as
        // a voice rather than a graphic equaliser.
        const arch = Math.sin(Math.PI * x);
        // Where in the shared cycle this bar peaks. Bars later in the row
        // crest later, which is what makes the wave travel.
        const crest = Math.max(0.001, Math.min(0.998, 1 - x));
        const lo = 0.14 + arch * 0.16;
        const hi = 0.14 + arch * 0.86;
        return (
          <Animated.View
            key={i}
            style={[
              styles.bar,
              {
                opacity: active ? 1 : 0.35,
                transform: [
                  {
                    // The bar's own place in the travelling wave. Shifting
                    // the input range is what the per-bar delay used to do:
                    // the crest reaches bar i when the shared phase passes
                    // 1 - x, and the range is written so the loop seam at
                    // 0/1 lands at the same height either side.
                    scaleY: Animated.multiply(
                      phase.interpolate({
                        inputRange: [0, crest, Math.min(1, crest + 0.5), 1],
                        outputRange: [lo, hi, lo, lo],
                        extrapolate: 'clamp',
                      }),
                      active ? amp : 0.45,
                    ),
                  },
                ],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 56,
    gap: 3,
    marginTop: space.xl,
    marginBottom: space.xl,
  },
  bar: {width: 4, height: 56, borderRadius: 2, backgroundColor: colors.accent},
});
