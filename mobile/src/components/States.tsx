import React from 'react';
import {ActivityIndicator, StyleSheet, View} from 'react-native';
import {colors, radius, space} from '@/theme';
import {Button} from './Button';
import {Txt} from './Txt';

export function LoadingState({label = 'Loading'}: {label?: string}) {
  return (
    <View style={styles.centered} accessibilityLabel={label}>
      <ActivityIndicator color={colors.textSecondary} />
      <Txt variant="caption" tone="tertiary" style={styles.gap}>
        {label}
      </Txt>
    </View>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.centered}>
      <Txt variant="heading" center>
        {title}
      </Txt>
      <Txt variant="body" tone="secondary" center style={styles.gap}>
        {message}
      </Txt>
      {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} style={styles.retry} /> : null}
    </View>
  );
}

export function EmptyState({title, message}: {title: string; message: string}) {
  return (
    <View style={styles.centered}>
      <Txt variant="bodyStrong" tone="secondary" center>
        {title}
      </Txt>
      <Txt variant="caption" tone="tertiary" center style={styles.gap}>
        {message}
      </Txt>
    </View>
  );
}

/**
 * Offline is not an error in Ruko — core protection is on-device. The banner
 * says what still works rather than warning the user about a lost connection.
 */
export function OfflineBanner({guardianReachable}: {guardianReachable: boolean}) {
  return (
    <View style={styles.banner}>
      <Txt variant="label" color={colors.textSecondary} uppercase>
        Offline
      </Txt>
      <Txt variant="caption" tone="tertiary" style={styles.bannerBody}>
        {guardianReachable
          ? 'Protection is running on-device.'
          : 'Protection is running on-device. Your guardian cannot be reached until you are back online.'}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {alignItems: 'center', justifyContent: 'center', paddingVertical: space.xxl},
  gap: {marginTop: space.sm},
  retry: {marginTop: space.lg, alignSelf: 'stretch'},
  banner: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: space.md,
  },
  bannerBody: {marginTop: 4},
});
