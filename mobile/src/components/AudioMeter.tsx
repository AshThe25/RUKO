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
  const bars = useMemo(
    () => Array.from({length: BARS}, () => new Animated.Value(0)),
    [],
  );
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
      bars.forEach(b => b.setValue(0.5));
      return;
    }
    const loops = bars.map((bar, i) =>
      Animated.loop(
        Animated.sequence([
          // The stagger. Linear both ways, so the crest moves at a constant
          // rate and the loop seam is invisible.
          Animated.delay((i / BARS) * CYCLE_MS),
          Animated.timing(bar, {
            toValue: 1,
            duration: CYCLE_MS / 2,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(bar, {
            toValue: 0,
            duration: CYCLE_MS / 2,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [bars, reduced]);

  return (
    <View
      style={styles.row}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {bars.map((bar, i) => {
        const x = i / BARS;
        // Arch envelope: tall in the middle, quiet at the edges, so it reads as
        // a voice rather than a graphic equaliser.
        const arch = Math.sin(Math.PI * x);
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
                    scaleY: Animated.multiply(
                      bar.interpolate({inputRange: [0, 1], outputRange: [lo, hi]}),
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
