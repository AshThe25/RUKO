import React from 'react';
import {ScrollView, StatusBar, StyleSheet, View, ViewStyle} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {colors, layout, space} from '@/theme';

interface ScreenProps {
  children: React.ReactNode;
  /** Critical screens are not scrollable — the user must deal with them. */
  scroll?: boolean;
  background?: string;
  footer?: React.ReactNode;
  contentStyle?: ViewStyle;
  /** Traps assistive focus. Used by the intervention, which must be dealt with. */
  modal?: boolean;
  testID?: string;
}

export function Screen({
  children,
  scroll = true,
  background = colors.bg,
  footer,
  contentStyle,
  modal,
  testID,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const padding: ViewStyle = {
    paddingTop: insets.top + space.lg,
    paddingHorizontal: layout.screenPadding,
  };

  const body = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        padding,
        {paddingBottom: space.xxxl + insets.bottom},
        contentStyle,
      ]}
      showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, padding, contentStyle]}>{children}</View>
  );

  return (
    <View
      style={[styles.flex, {backgroundColor: background}]}
      accessibilityViewIsModal={modal}
      testID={testID}>
      <StatusBar
        barStyle={background === colors.darkBg ? 'light-content' : 'dark-content'}
        backgroundColor={background}
      />
      {body}
      {footer ? (
        <View
          style={[
            styles.footer,
            {paddingBottom: insets.bottom + space.lg, backgroundColor: background},
          ]}>
          {footer}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  footer: {
    paddingHorizontal: layout.screenPadding,
    paddingTop: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
