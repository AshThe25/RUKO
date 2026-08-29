import React from 'react';
import {StyleSheet, View} from 'react-native';
import {Button, Screen, Txt} from '@/components';
import {colors, space} from '@/theme';
import {useProtectionStore} from '@/store/protectionStore';

/**
 * The pitch, in the user's language. No robot imagery, no "AI" badge — the
 * first thing Ruko says has to be the thing that is actually true about it.
 */
export function OnboardingScreen() {
  const navigate = useProtectionStore(s => s.navigate);

  return (
    <Screen
      scroll={false}
      footer={
        <Button
          label="Set up protection"
          onPress={() => navigate('permissions')}
          testID="onboarding-continue"
        />
      }>
      <View style={styles.body}>
        <Txt variant="label" tone="tertiary" uppercase>
          Ruko
        </Txt>

        <Txt variant="title" style={styles.headline}>
          Protection around the moment you are about to pay.
        </Txt>

        <Txt variant="body" tone="secondary" style={styles.para}>
          A payment can be completely legitimate. Your phone, your account, your
          PIN, your decision — and still be the wrong one, because somebody
          talked you into it.
        </Txt>

        <Txt variant="body" tone="secondary" style={styles.para}>
          Ruko watches for that pressure. When it sees someone using authority,
          urgency or threats to move your money, it stops and shows you what it
          noticed.
        </Txt>

        <View style={styles.points}>
          <Point
            title="It runs on this phone"
            body="Analysis happens on the device. No internet needed, and no conversation leaves it."
          />
          <Point
            title="It stays quiet"
            body="Ordinary payments go through untouched. You only hear from Ruko when something is genuinely off."
          />
          <Point
            title="It explains itself"
            body="Every warning tells you exactly what was detected, so you can disagree with it."
          />
        </View>
      </View>
    </Screen>
  );
}

function Point({title, body}: {title: string; body: string}) {
  return (
    <View style={styles.point}>
      <View style={styles.rule} />
      <View style={styles.pointBody}>
        <Txt variant="bodyStrong">{title}</Txt>
        <Txt variant="caption" tone="secondary" style={styles.pointText}>
          {body}
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {flex: 1, justifyContent: 'center'},
  headline: {marginTop: space.lg},
  para: {marginTop: space.lg},
  points: {marginTop: space.xxl},
  point: {flexDirection: 'row', marginBottom: space.lg},
  rule: {width: 2, borderRadius: 1, backgroundColor: colors.borderStrong},
  pointBody: {flex: 1, paddingLeft: space.lg},
  pointText: {marginTop: 2},
});
