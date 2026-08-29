import React, {useEffect, useRef} from 'react';
import {ActivityIndicator, Animated, Easing, StyleSheet, View} from 'react-native';
import {colors, motion, space} from '@/theme';
import {Txt} from './Txt';

export type StepStatus = 'pending' | 'running' | 'done' | 'flagged' | 'error';

interface InvestigationStepProps {
  label: string;
  status: StepStatus;
  summary?: string;
  /** Points added to the risk score by this finding, when known. */
  contribution?: number;
}

/**
 * One line of the live investigation feed. The whole point of this component
 * is that the user sees *which* evidence source produced *which* finding —
 * an unexplained "AI says scam" is exactly what Ruko must not ship.
 */
export function InvestigationStep({label, status, summary, contribution}: InvestigationStepProps) {
  const fade = useRef(new Animated.Value(status === 'pending' ? 0.35 : 0)).current;

  useEffect(() => {
    Animated.timing(fade, {
      toValue: status === 'pending' ? 0.35 : 1,
      duration: motion.base,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [fade, status]);

  return (
    <Animated.View style={[styles.row, {opacity: fade}]}>
      <View style={styles.marker}>{renderMarker(status)}</View>
      <View style={styles.body}>
        <View style={styles.headline}>
          <Txt variant="bodyStrong">{label}</Txt>
          {contribution !== undefined && contribution > 0 ? (
            <Txt variant="caption" color={colors.high}>
              +{Math.round(contribution)}
            </Txt>
          ) : null}
        </View>
        {summary ? (
          <Txt
            variant="caption"
            color={status === 'flagged' ? colors.critical : colors.textSecondary}
            style={styles.summary}>
            {summary}
          </Txt>
        ) : null}
      </View>
    </Animated.View>
  );
}

function renderMarker(status: StepStatus) {
  switch (status) {
    case 'running':
      return <ActivityIndicator size="small" color={colors.textSecondary} />;
    case 'done':
      return <Txt variant="bodyStrong" color={colors.safe}>✓</Txt>;
    case 'flagged':
      return <Txt variant="bodyStrong" color={colors.critical}>!</Txt>;
    case 'error':
      return <Txt variant="bodyStrong" color={colors.textTertiary}>×</Txt>;
    default:
      return <View style={styles.pendingDot} />;
  }
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'flex-start', paddingVertical: space.md},
  marker: {width: 24, alignItems: 'center', paddingTop: 2},
  body: {flex: 1, paddingLeft: space.sm},
  headline: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  summary: {marginTop: 2},
  pendingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.borderStrong,
    marginTop: 8,
  },
});
