import React from 'react';
import {StyleSheet, View, ViewStyle} from 'react-native';
import {colors, radius, space} from '@/theme';
import {Txt} from './Txt';

interface CardProps {
  children?: React.ReactNode;
  title?: string;
  trailing?: React.ReactNode;
  style?: ViewStyle;
  tone?: string;
  borderColor?: string;
  testID?: string;
}

export function Card({
  children,
  title,
  trailing,
  style,
  tone = colors.surface,
  borderColor = colors.border,
  testID,
}: CardProps) {
  return (
    <View
      testID={testID}
      style={[styles.card, {backgroundColor: tone, borderColor}, style]}>
      {title || trailing ? (
        <View style={styles.header}>
          {title ? (
            <Txt variant="label" tone="tertiary" uppercase>
              {title}
            </Txt>
          ) : (
            <View />
          )}
          {trailing}
        </View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
});
