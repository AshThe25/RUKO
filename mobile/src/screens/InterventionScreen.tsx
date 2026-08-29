import React, {useEffect, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {Button, Card, Pill, RiskScore, Screen, Txt} from '@/components';
import {colors, riskPalette, space} from '@/theme';
import {useProtectionStore} from '@/store/protectionStore';
import {useProtectionController} from '@/store/useProtectionController';
import {formatMinor} from '@/utils/format';

/** How long the override button stays disabled. Long enough to think. */
const OVERRIDE_DELAY_SEC = 3;

/**
 * The screen the whole product exists for.
 *
 * Rules it follows: never block money silently, always explain what was
 * detected, make "DON'T PAY" the easy path and continuing a deliberate one,
 * and never shame the user — the caller is the one behaving badly, not them.
 */
export function InterventionScreen() {
  const result = useProtectionStore(s => s.result);
  const guardianState = useProtectionStore(s => s.guardianState);
  const guardianAlert = useProtectionStore(s => s.guardianAlert);
  const guardianDecision = useProtectionStore(s => s.guardianDecision);
  const {endSession} = useProtectionController();

  const [overrideArmed, setOverrideArmed] = useState(false);
  const [countdown, setCountdown] = useState(OVERRIDE_DELAY_SEC);

  useEffect(() => {
    if (!overrideArmed || countdown <= 0) {
      return;
    }
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [overrideArmed, countdown]);

  if (!result) {
    return (
      <Screen scroll={false}>
        <Txt variant="body" tone="secondary">
          There is no active check.
        </Txt>
      </Screen>
    );
  }

  const {risk, evidence} = result;
  const palette = riskPalette[risk.level];
  const awaitingGuardian = guardianAlert !== null;
  const guardianAllowed = guardianDecision?.decision === 'ALLOW';

  return (
    <Screen
      testID="intervention-screen"
      background={colors.bg}
      modal
      footer={
        <View>
          <Button
            label="Don't pay"
            variant="primary"
            onPress={() => endSession('USER_STOPPED')}
            testID="dont-pay"
          />
          {overrideArmed ? (
            <Button
              label={countdown > 0 ? `Continue anyway (${countdown})` : 'Continue anyway'}
              variant="ghost"
              disabled={countdown > 0}
              onPress={() => endSession('USER_CONTINUED')}
              hint="Ruko will remember that you disagreed."
              style={styles.secondary}
              testID="continue-confirm"
            />
          ) : (
            <Button
              label="I'm sure — continue"
              variant="ghost"
              onPress={() => {
                setOverrideArmed(true);
                setCountdown(OVERRIDE_DELAY_SEC);
              }}
              style={styles.secondary}
              testID="continue-arm"
            />
          )}
        </View>
      }>
      <View style={[styles.banner, {backgroundColor: palette.surface}]}>
        <Txt variant="label" color={palette.fg} uppercase>
          {palette.label} · {risk.score}/100
        </Txt>
      </View>

      <Txt
        variant="title"
        style={styles.headline}
        accessibilityRole="header"
        accessibilityLiveRegion="assertive">
        Stop for a moment.
      </Txt>
      <Txt variant="body" tone="secondary" style={styles.sub}>
        You may be under pressure from the person you are speaking to. Nothing
        has been paid yet.
      </Txt>

      <Card style={styles.payment} tone={colors.surfaceRaised}>
        <Txt variant="display" color={colors.text}>
          {formatMinor(evidence.payment.amountMinor)}
        </Txt>
        <Txt variant="body" tone="secondary" style={styles.payee}>
          to {evidence.payment.payeeDisplayName ?? 'an unnamed recipient'}
        </Txt>
      </Card>

      <Txt variant="label" tone="tertiary" uppercase style={styles.whyLabel}>
        Why Ruko stopped
      </Txt>
      <View style={styles.reasons}>
        {risk.reasons.map(reason => (
          <View key={reason.code} style={styles.reason}>
            <View style={[styles.bullet, {backgroundColor: palette.fg}]} />
            <Txt variant="body" style={styles.reasonText}>
              {reason.label}
            </Txt>
          </View>
        ))}
      </View>

      {risk.degraded ? (
        <Txt variant="caption" tone="tertiary" style={styles.degraded}>
          {risk.degradedReasons.join(' ')}
        </Txt>
      ) : null}

      <Card style={styles.meter}>
        <RiskScore score={risk.score} level={risk.level} />
      </Card>

      {guardianState !== 'UNPAIRED' ? (
        <Card title="Guardian" style={styles.guardian}>
          {awaitingGuardian ? (
            <Txt variant="body" tone="secondary">
              Your guardian has been shown this payment and is reviewing it.
            </Txt>
          ) : guardianDecision ? (
            <>
              <Pill
                label={guardianAllowed ? 'Guardian allowed it' : 'Guardian kept it blocked'}
                dotColor={guardianAllowed ? colors.medium : colors.safe}
                fg={guardianAllowed ? colors.medium : colors.safe}
              />
              <Txt variant="caption" tone="tertiary" style={styles.guardianNote}>
                {guardianAllowed
                  ? 'Your guardian said this one is fine. The decision is still yours.'
                  : `${guardianDecision.guardianLabel} reviewed the evidence and kept this blocked.`}
              </Txt>
            </>
          ) : (
            <Txt variant="body" tone="secondary">
              Your guardian could not be reached. Ruko is protecting this payment
              on its own.
            </Txt>
          )}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: {alignSelf: 'flex-start', paddingHorizontal: space.md, paddingVertical: 6, borderRadius: 6},
  headline: {marginTop: space.lg},
  sub: {marginTop: space.md},
  payment: {marginTop: space.xl},
  payee: {marginTop: space.xs},
  whyLabel: {marginTop: space.xl},
  reasons: {marginTop: space.md},
  reason: {flexDirection: 'row', alignItems: 'flex-start', marginBottom: space.md},
  bullet: {width: 5, height: 5, borderRadius: 3, marginTop: 9, marginRight: space.md},
  reasonText: {flex: 1},
  degraded: {marginTop: space.sm},
  meter: {marginTop: space.md},
  guardian: {marginTop: space.md},
  guardianNote: {marginTop: space.sm},
  secondary: {marginTop: space.sm},
});
