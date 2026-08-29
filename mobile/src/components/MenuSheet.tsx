import React from 'react';
import {Modal, Pressable, ScrollView, StyleSheet, View} from 'react-native';
import {colors, radius, space} from '@/theme';
import {Txt} from './Txt';

export interface MenuItem {
  label: string;
  caption: string;
  onPress: () => void;
}

/**
 * The whole app behind one control.
 *
 * The home screen's job is to say whether anything needs attention. Six
 * navigation tiles competing with that answer is what made the screen feel
 * busy, so everything that is not the answer moves in here.
 *
 * A sheet rather than a drawer: it is thumb-reachable on a tall phone, and it
 * dismisses by tapping away, which is the gesture people already expect.
 */
export function MenuSheet({
  visible,
  items,
  onClose,
}: {
  visible: boolean;
  items: MenuItem[];
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent>
      {/* Tapping the dimmed area closes: the expected way out of a sheet. */}
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu" />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <Txt variant="label" tone="tertiary" uppercase style={styles.heading}>
          Ruko
        </Txt>
        <ScrollView showsVerticalScrollIndicator={false}>
          {items.map(item => (
            <Pressable
              key={item.label}
              accessibilityRole="button"
              onPress={() => {
                onClose();
                item.onPress();
              }}
              style={({pressed}) => [styles.row, pressed && styles.rowPressed]}>
              <View style={styles.rowText}>
                <Txt variant="bodyStrong">{item.label}</Txt>
                <Txt variant="caption" tone="secondary" style={styles.caption}>
                  {item.caption}
                </Txt>
              </View>
              <Txt variant="body" tone="tertiary">
                ›
              </Txt>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** Three lines. Drawn rather than an icon font, so it inherits the text colour. */
export function MenuButton({onPress}: {onPress: () => void}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open menu"
      hitSlop={12}
      onPress={onPress}
      style={({pressed}) => [styles.button, pressed && styles.buttonPressed]}>
      {[0, 1, 2].map(i => (
        <View key={i} style={styles.bar} />
      ))}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,10,16,0.45)'},
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '72%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.xl,
    paddingBottom: space.xxxl,
    paddingTop: space.md,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: space.lg,
  },
  heading: {marginBottom: space.sm},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowPressed: {backgroundColor: colors.surfacePressed},
  rowText: {flex: 1},
  caption: {marginTop: 2},
  button: {padding: space.sm, gap: 4, justifyContent: 'center'},
  buttonPressed: {opacity: 0.5},
  bar: {width: 20, height: 2, borderRadius: 1, backgroundColor: colors.text},
});
