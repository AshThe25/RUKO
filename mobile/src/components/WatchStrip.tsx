import React from 'react';
import {StyleSheet, View} from 'react-native';
import {colors, space} from '@/theme';
import {Txt} from './Txt';

/**
 * What Ruko looks at, stated plainly.
 *
 * A person who has just granted a microphone and accessibility access is owed
 * an answer to "what is it actually reading?" without opening settings. Six
 * things, named, on the screen they already look at.
 *
 * The glyphs are composed from plain Views rather than an icon library: adding
 * a native module for six small shapes is how the sign-in flow broke earlier,
 * and this costs nothing at runtime.
 */
const C = colors.textTertiary;

function Mic() {
  return (
    <View style={g.box}>
      <View style={[g.pill, {width: 8, height: 12, borderRadius: 4}]} />
      <View style={[g.arc, {width: 16, height: 8}]} />
      <View style={[g.stem, {height: 3}]} />
    </View>
  );
}
function Card_() {
  return (
    <View style={g.box}>
      <View style={[g.rect, {width: 20, height: 14}]} />
      <View style={[g.line, {width: 20, top: 6}]} />
    </View>
  );
}
function Person() {
  return (
    <View style={g.box}>
      <View style={[g.circle, {width: 9, height: 9, top: 1}]} />
      <View style={[g.arc, {width: 18, height: 9, bottom: 1}]} />
    </View>
  );
}
function Phone() {
  return (
    <View style={g.box}>
      <View style={[g.rect, {width: 12, height: 20, borderRadius: 3}]} />
      <View style={[g.line, {width: 5, top: 16}]} />
    </View>
  );
}
function Bell() {
  return (
    <View style={g.box}>
      <View style={[g.arc, {width: 16, height: 12, top: 2, borderBottomWidth: 0}]} />
      <View style={[g.line, {width: 18, top: 15}]} />
      <View style={[g.circle, {width: 5, height: 5, top: 17}]} />
    </View>
  );
}
function Bars() {
  return (
    <View style={[g.box, g.barsRow]}>
      {[8, 16, 11, 20].map((h, i) => (
        <View key={i} style={[g.barTick, {height: h}]} />
      ))}
    </View>
  );
}

const ITEMS = [
  {label: 'Room', Icon: Mic},
  {label: 'Payment', Icon: Card_},
  {label: 'Recipient', Icon: Person},
  {label: 'Caller', Icon: Phone},
  {label: 'Alerts', Icon: Bell},
  {label: 'Habits', Icon: Bars},
];

export function WatchStrip() {
  return (
    <View style={styles.wrap}>
      <Txt variant="label" tone="tertiary" uppercase center style={styles.heading}>
        Six things Ruko watches
      </Txt>
      <View style={styles.row}>
        {ITEMS.map(({label, Icon}) => (
          <View key={label} style={styles.item}>
            <Icon />
            <Txt variant="label" tone="tertiary" uppercase style={styles.label}>
              {label}
            </Txt>
          </View>
        ))}
      </View>
    </View>
  );
}

const g = StyleSheet.create({
  box: {width: 24, height: 24, alignItems: 'center', justifyContent: 'center'},
  barsRow: {flexDirection: 'row', alignItems: 'flex-end', gap: 2},
  pill: {borderWidth: 1.5, borderColor: C, position: 'absolute', top: 2},
  rect: {borderWidth: 1.5, borderColor: C, borderRadius: 2},
  circle: {borderWidth: 1.5, borderColor: C, borderRadius: 99, position: 'absolute'},
  arc: {
    borderWidth: 1.5,
    borderColor: C,
    borderTopLeftRadius: 99,
    borderTopRightRadius: 99,
    borderBottomWidth: 1.5,
    position: 'absolute',
    bottom: 3,
  },
  stem: {width: 1.5, backgroundColor: C, position: 'absolute', bottom: 0},
  line: {height: 1.5, backgroundColor: C, position: 'absolute'},
  barTick: {width: 3, borderRadius: 1, backgroundColor: C},
});

const styles = StyleSheet.create({
  wrap: {marginTop: space.xxl},
  heading: {marginBottom: space.lg},
  row: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start'},
  item: {alignItems: 'center', gap: space.sm, flex: 1},
  label: {fontSize: 9, textAlign: 'center'},
});
