import React, {useCallback, useRef, useState} from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  Bloom,
  Button,
  Disclosure,
  ProgressDots,
  Screen,
  Txt,
  useReducedMotion,
} from '@/components';
import type {DisclosureItem} from '@/components';
import {colors, layout, space} from '@/theme';
import {useProtectionStore} from '@/store/protectionStore';

/**
 * Four pages, in the order a sceptical person actually asks the questions:
 * what is the problem, what does this do about it, and then — only then —
 * what are you asking for and what happens to it.
 *
 * The two permission pages are the reason this flow exists. Ruko wants the
 * microphone and the accessibility service, which are the two scariest grants
 * on Android and the two most abused by spyware. Asking for them cold, on a
 * system dialog with no context, is how a safety app gets uninstalled at the
 * first prompt. Each page says what is read, what is never kept, and what
 * still works if the answer is no — because the third one is what makes the
 * first two believable.
 */

interface Page {
  eyebrow: string;
  headline: string;
  body: string;
  /** Shown under the body as small print. Usually an Android limitation. */
  footnote?: string;
  disclosure?: DisclosureItem[];
  points?: Array<{title: string; body: string}>;
  bloom?: 'warm' | 'cool' | 'duo';
}

const PAGES: Page[] = [
  {
    eyebrow: 'Ruko',
    headline: 'A payment can be right, and still be wrong.',
    body:
      'Your phone. Your account. Your PIN. Every fraud check in the country says this payment is fine — because the attack was never on your device. It was on you.',
    bloom: 'warm',
  },
  {
    eyebrow: 'What it does',
    headline: 'It watches the pressure, not the payment.',
    body:
      'When someone uses authority, urgency or a threat to move your money, Ruko stops and shows you what it noticed. Ordinary payments go through untouched.',
    points: [
      {
        title: 'It runs on this phone',
        body: 'The model is on the device. No internet needed, and no conversation leaves it.',
      },
      {
        title: 'It stays quiet',
        body: 'You only hear from Ruko when something is genuinely off. Silence is the normal state.',
      },
      {
        title: 'It explains itself',
        body: 'Every warning names what was detected, so you can look at the reasons and disagree.',
      },
    ],
    bloom: 'duo',
  },
  {
    eyebrow: 'Permission 1 of 2',
    headline: 'The microphone, and what happens to what it hears.',
    body:
      'This is the one that decides whether Ruko can tell you are being pressured, rather than only that a payment is unusual.',
    footnote:
      'Android reserves call audio for system apps, so Ruko hears the room through the ordinary microphone. It works on speakerphone and is deaf at the ear — and it says so rather than pretending otherwise.',
    disclosure: [
      {
        kind: 'reads',
        text:
          'Speech during a protected session, while a notification you cannot swipe away says it is listening.',
      },
      {
        kind: 'never',
        text:
          'Audio is processed in memory for one short window and discarded. Nothing is recorded to storage, and no transcript ever leaves this phone.',
      },
      {
        kind: 'declines',
        text:
          'Ruko still checks who you are paying and how much. It just cannot hear the person creating the urgency.',
      },
    ],
    bloom: 'cool',
  },
  {
    eyebrow: 'Permission 2 of 2',
    headline: 'Reading the payment screen.',
    body:
      'So a warning can name the exact payment you are about to make, instead of describing one in the abstract.',
    footnote:
      'No public API lets one app cancel another app’s transfer. Ruko reads what is visible and interrupts the decision, not the transaction.',
    disclosure: [
      {
        kind: 'reads',
        text: 'The amount and recipient shown on a payment confirmation screen.',
      },
      {
        kind: 'never',
        text: 'Payment screens only. Ruko cannot tap, type, or act on your behalf anywhere.',
      },
      {
        kind: 'declines',
        text:
          'Protection still runs. Ruko will know a call looks like a scam, but not what you are about to pay.',
      },
    ],
    bloom: 'cool',
  },
];

export function OnboardingScreen() {
  const navigate = useProtectionStore(s => s.navigate);
  const {width} = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const scroller = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  const last = index === PAGES.length - 1;

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(PAGES.length - 1, next));
      setIndex(clamped);
      scroller.current?.scrollTo({x: clamped * width, animated: !reduceMotion});
    },
    [reduceMotion, width],
  );

  const onScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    // Guard against a zero width on the very first layout pass.
    if (width <= 0) {
      return;
    }
    setIndex(Math.round(event.nativeEvent.contentOffset.x / width));
  };

  return (
    <Screen
      scroll={false}
      testID="onboarding-screen"
      contentStyle={styles.noPadding}
      footer={
        <View>
          <View style={styles.footerTop}>
            <ProgressDots count={PAGES.length} index={index} />
            {!last ? (
              <Txt
                variant="caption"
                tone="tertiary"
                onPress={() => goTo(PAGES.length - 1)}
                accessibilityRole="button"
                suppressHighlighting>
                Skip
              </Txt>
            ) : null}
          </View>
          <Button
            label={last ? 'Set up protection' : 'Continue'}
            onPress={() => (last ? navigate('permissions') : goTo(index + 1))}
            testID="onboarding-continue"
          />
        </View>
      }>
      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        scrollEventThrottle={16}
        style={styles.pager}>
        {PAGES.map(page => (
          <PageView key={page.headline} page={page} width={width} />
        ))}
      </ScrollView>
    </Screen>
  );
}

function PageView({page, width}: {page: Page; width: number}) {
  return (
    <ScrollView
      style={{width}}
      contentContainerStyle={styles.page}
      showsVerticalScrollIndicator={false}>
      {page.bloom ? (
        <View style={styles.bloomWrap}>
          <Bloom size={260} tint={page.bloom} />
        </View>
      ) : null}

      <Txt variant="label" tone="tertiary" uppercase>
        {page.eyebrow}
      </Txt>
      <Txt variant="title" style={styles.headline} accessibilityRole="header">
        {page.headline}
      </Txt>
      <Txt variant="body" tone="secondary" style={styles.body}>
        {page.body}
      </Txt>

      {page.disclosure ? <Disclosure items={page.disclosure} /> : null}

      {page.points ? (
        <View style={styles.points}>
          {page.points.map(point => (
            <View key={point.title} style={styles.point}>
              <View style={styles.rule} />
              <View style={styles.pointBody}>
                <Txt variant="bodyStrong">{point.title}</Txt>
                <Txt variant="caption" tone="secondary" style={styles.pointText}>
                  {point.body}
                </Txt>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {page.footnote ? (
        <Txt variant="caption" tone="tertiary" style={styles.footnote}>
          {page.footnote}
        </Txt>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  noPadding: {paddingHorizontal: 0},
  pager: {flex: 1},
  page: {
    paddingHorizontal: layout.screenPadding,
    paddingBottom: space.xl,
    flexGrow: 1,
    justifyContent: 'center',
  },
  bloomWrap: {alignItems: 'center', marginBottom: space.xl},
  headline: {marginTop: space.md},
  body: {marginTop: space.lg},
  points: {marginTop: space.xl},
  point: {flexDirection: 'row', marginBottom: space.lg},
  rule: {width: 2, borderRadius: 1, backgroundColor: colors.borderStrong},
  pointBody: {flex: 1, paddingLeft: space.lg},
  pointText: {marginTop: 2},
  footnote: {marginTop: space.lg},
  footerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.lg,
  },
});
