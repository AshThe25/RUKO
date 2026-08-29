import React, {useEffect, useRef} from 'react';
import {Animated, StyleSheet, View} from 'react-native';
import {colors, space} from '@/theme';
import {useReducedMotion} from './useReducedMotion';

const BARS = 34;

/**
 * The listening signature from the landing page, on the phone.
 *
 * It is decoration with a job: it is the only visible sign that Ruko is
 * hearing the room, and a person who has granted a microphone deserves to see
 * when it is live rather than take it on trust.
 *
 * Two blended sines under an arch envelope, so it reads as a voice rather than
 * a repeating pattern. Driven by the native driver: it must never compete with
 * the classifier for the JS thread while a session is running.
 */
export function AudioMeter({active}: {active: boolean}) {
  const reduced = useReducedMotion();
  const phase = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active || reduced) {
      phase.stopAnimation();
      return;
    }
    const loop = Animated.loop(
      Animated.timing(phase, {
        toValue: 1,
        duration: 2600,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [active, reduced, phase]);

  return (
    <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({length: BARS}, (_, i) => {
        const x = i / BARS;
        // Arch envelope: tall in the middle, quiet at the edges.
        const arch = Math.sin(Math.PI * x);
        const base = 0.14 + arch * 0.62;
        const peak = 0.14 + arch * (0.55 + 0.45 * Math.sin(x * 9));
        return (
          <Animated.View
            key={i}
            style={[
              styles.bar,
              {
                transform: [
                  {
                    scaleY: active && !reduced
                      ? phase.interpolate({
                          inputRange: [0, 0.5, 1],
                          outputRange: [base, peak, base],
                        })
                      : base,
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
    marginTop: space.lg,
  },
  bar: {
    width: 4,
    height: 56,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
});
