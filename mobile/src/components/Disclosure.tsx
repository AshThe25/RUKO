import React from 'react';
import {StyleSheet, View} from 'react-native';
import {colors, radius, space} from '@/theme';
import {Txt} from './Txt';

export interface DisclosureItem {
  kind: 'reads' | 'never' | 'declines';
  text: string;
}

const MARKS: Record<DisclosureItem['kind'], {glyph: string; label: string; tint: string}> = {
  reads: {glyph: '+', label: 'Reads', tint: colors.accent},
  never: {glyph: '−', label: 'Never', tint: colors.safe},
  declines: {glyph: '?', label: 'If you say no', tint: colors.textTertiary},
};

/**
 * The three sentences a permission has to answer before it is asked for:
 * what it reads, what it never does, and what the user loses by refusing.
 *
 * The third line is the one that matters. A permission screen that only lists
 * benefits is a sales pitch; telling someone exactly what they give up by
 * declining is what makes the other two believable — and Ruko asks for the two
 * scariest permissions on Android.
 */
export function Disclosure({items}: {items: DisclosureItem[]}) {
  return (
    <View style={styles.wrap}>
      {items.map(item => {
        const mark = MARKS[item.kind];
        return (
          <View key={`${item.kind}-${item.text}`} style={styles.row}>
            <View style={[styles.badge, {borderColor: mark.tint}]}>
              <Txt variant="label" color={mark.tint}>
                {mark.glyph}
              </Txt>
            </View>
            <View style={styles.body}>
              <Txt variant="label" color={mark.tint} uppercase>
                {mark.label}
              </Txt>
              <Txt variant="caption" tone="secondary" style={styles.text}>
                {item.text}
              </Txt>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {marginTop: space.lg},
  row: {flexDirection: 'row', alignItems: 'flex-start', marginBottom: space.lg},
  badge: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  body: {flex: 1, paddingLeft: space.md},
  text: {marginTop: 3},
});
