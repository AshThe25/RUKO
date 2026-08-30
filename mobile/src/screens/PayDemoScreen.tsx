import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {Button, Card, Pill, Screen, Txt} from '@/components';
import {colors, radius, space} from '@/theme';
import {useDemo} from '@/services/ServicesContext';
import {SCENARIOS, SCENARIO_ORDER, type Scenario, type ScenarioId} from '@/services/stubs/scenarios';
import {useProtectionStore} from '@/store/protectionStore';
import {useProtectionController} from '@/store/useProtectionController';
import {formatMinor} from '@/utils/format';

/**
 * RukoPayDemo — a controlled payment surface.
 *
 * It exists because a normal third-party Android app cannot intercept
 * arbitrary UPI payments. This screen fakes the *payment*, and nothing else:
 * the conversation, the classifier, the agent and the risk engine downstream
 * are the real ones. That distinction is stated on screen, not buried in a
 * README.
 */
export function PayDemoScreen() {
  const demo = useDemo();
  const navigate = useProtectionStore(s => s.navigate);
  const {startScenario, confirmPayment} = useProtectionController();

  const [scenario, setScenario] = useState<Scenario | null>(demo.bus.getScenario());
  const [transcript, setTranscript] = useState<string[]>([]);

  useEffect(() => demo.bus.transcript.subscribe(setTranscript), [demo.bus]);

  const choose = async (id: ScenarioId) => {
    await startScenario(id);
    setScenario(SCENARIOS[id]);
  };

  if (!scenario) {
    return (
      <Screen testID="paydemo-picker">
        <Txt variant="label" tone="tertiary" uppercase>
          Demo mode
        </Txt>
        <Txt variant="title" style={styles.headline}>
          Pick a situation.
        </Txt>
        <Txt variant="body" tone="secondary" style={styles.sub}>
          Each one feeds scripted input into the real pipeline. Nothing is
          pre-decided — change a line of dialogue and the score changes with it.
        </Txt>

        <View style={styles.list}>
          {SCENARIO_ORDER.map(id => {
            const s = SCENARIOS[id];
            return (
              <Pressable
                key={id}
                accessibilityRole="button"
                onPress={() => choose(id)}
                testID={`scenario-${id}`}
                style={({pressed}) => [styles.scenario, pressed && styles.scenarioPressed]}>
                <Txt variant="bodyStrong">{s.title}</Txt>
                <Txt variant="caption" tone="secondary" style={styles.scenarioCaption}>
                  {s.caption}
                </Txt>
                <Txt variant="caption" tone="tertiary" style={styles.expectation}>
                  Expected: {s.expectation}
                </Txt>
              </Pressable>
            );
          })}
        </View>

        <Button
          label="Back"
          variant="ghost"
          onPress={() => navigate('home')}
          style={styles.back}
        />
      </Screen>
    );
  }

  return (
    <Screen
      testID="paydemo-screen"
      footer={
        <Button
          label={`Pay ${formatMinor(scenario.payment.amountMinor)}`}
          onPress={confirmPayment}
          testID="pay-now"
        />
      }>
      <View style={styles.demoHeader}>
        <Pill label="RukoPayDemo" dotColor={colors.medium} fg={colors.medium} />
        <Pressable accessibilityRole="button" onPress={() => {
          demo.bus.reset();
          setScenario(null);
        }}>
          <Txt variant="caption" color={colors.accent}>
            Change scenario
          </Txt>
        </Pressable>
      </View>

      <Txt variant="caption" tone="tertiary" style={styles.disclaimer}>
        A stand-in payment app. Real UPI apps cannot be intercepted by a normal
        Android app — everything after you press Pay is the real Ruko pipeline.
      </Txt>

      <Card style={styles.sheet} tone={colors.surfaceRaised}>
        <Txt variant="label" tone="tertiary" uppercase>
          Paying
        </Txt>
        <Txt variant="display" style={styles.amount}>
          {formatMinor(scenario.payment.amountMinor)}
        </Txt>
        <Txt variant="body" tone="secondary">
          to {scenario.payment.payeeDisplayName}
        </Txt>
      </Card>

      {scenario.liveMic ? (
        <Card title="What Ruko is hearing" style={styles.card}>
          {transcript.length === 0 ? (
            <Txt variant="caption" tone="tertiary">
              Listening — speak now. Say something a scam caller would.
            </Txt>
          ) : (
            transcript.map((line, i) => (
              <Txt key={`${i}-${line.slice(0, 12)}`} variant="caption" tone="secondary" style={styles.line}>
                “{line}”
              </Txt>
            ))
          )}
          <Txt variant="caption" tone="tertiary" style={styles.note}>
            Your live voice, transcribed by Sarvam and scored on device. Press
            Pay when you are done speaking.
          </Txt>
        </Card>
      ) : scenario.lines.length > 0 ? (
        <Card title="What Ruko is hearing" style={styles.card}>
          {transcript.length === 0 ? (
            <Txt variant="caption" tone="tertiary">
              Waiting for speech…
            </Txt>
          ) : (
            transcript.map((line, i) => (
              <Txt key={`${i}-${line.slice(0, 12)}`} variant="caption" tone="secondary" style={styles.line}>
                “{line}”
              </Txt>
            ))
          )}
          <Txt variant="caption" tone="tertiary" style={styles.note}>
            Scripted audio, analysed on device as it arrives.
          </Txt>
        </Card>
      ) : (
        <Card title="What Ruko is hearing" style={styles.card}>
          <Txt variant="caption" tone="tertiary">
            Nothing — there is no call in this scenario. Ruko will judge this
            payment on the recipient and the amount alone.
          </Txt>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headline: {marginTop: space.md},
  sub: {marginTop: space.md},
  list: {marginTop: space.xl},
  scenario: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.lg,
    marginBottom: space.sm,
  },
  scenarioPressed: {backgroundColor: colors.surfacePressed},
  scenarioCaption: {marginTop: 4},
  expectation: {marginTop: space.sm},
  back: {marginTop: space.lg},
  demoHeader: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  disclaimer: {marginTop: space.md},
  sheet: {marginTop: space.lg},
  amount: {marginTop: space.sm, marginBottom: space.xs},
  card: {marginTop: space.md},
  line: {marginBottom: space.sm},
  note: {marginTop: space.sm},
});
