import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {colors, space} from '@/theme';
import {Txt} from './Txt';

interface RowProps {
  label: string;
  value?: string;
  detail?: string;
  valueColor?: string;
  onPress?: () => void;
  testID?: string;
}

/** Label / value row used by the engineering and guardian screens. */
export function Row({label, value, detail, valueColor, onPress, testID}: RowProps) {
  const body = (
    <View style={styles.row} testID={testID}>
      <View style={styles.labelCol}>
        <Txt variant="body" tone="secondary">
          {label}
        </Txt>
        {detail ? (
          <Txt variant="caption" tone="tertiary" style={styles.detail}>
            {detail}
          </Txt>
        ) : null}
      </View>
      {value !== undefined ? (
        <Txt variant="mono" color={valueColor ?? colors.text}>
          {value}
        </Txt>
      ) : null}
    </View>
  );
  if (!onPress) {
    return body;
  }
  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  labelCol: {flex: 1, paddingRight: space.lg},
  detail: {marginTop: 2},
});
