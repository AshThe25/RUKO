import React, {useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {Button, Card, EmptyState, Screen, Txt} from '@/components';
import {colors, riskPalette, space} from '@/theme';
import {useProtectionStore, type RiskEventRecord} from '@/store/protectionStore';
import {formatMinor, formatRelative} from '@/utils/format';

const OUTCOME_COPY: Record<RiskEventRecord['outcome'], string> = {
  NO_INTERRUPTION: 'Allowed without interruption',
  USER_STOPPED: 'You stopped the payment',
  USER_CONTINUED: 'You continued anyway',
  GUARDIAN_BLOCKED: 'Guardian kept it blocked',
  GUARDIAN_ALLOWED: 'Guardian allowed it',
  GUARDIAN_TIMED_OUT: 'Guardian did not respond — stayed blocked',
};

/**
 * The audit trail (spec §49). Every decision Ruko made, what it was based on,
 * and which model and policy version made it — so an intervention is always
 * reviewable after the fact.
 */
export function HistoryScreen() {
  const history = useProtectionStore(s => s.history);
  const navigate = useProtectionStore(s => s.navigate);
  const clearHistory = useProtectionStore(s => s.clearHistory);
  const [confirmingClear, setConfirmingClear] = useState(false);

  return (
    <Screen
      testID="history-screen"
      footer={
        <View>
          {history.length > 0 ? (
            <Button
              label={confirmingClear ? 'Delete everything — tap to confirm' : 'Delete this history'}
              variant={confirmingClear ? 'danger' : 'quiet'}
              onPress={() => {
                if (confirmingClear) {
                  clearHistory();
                  setConfirmingClear(false);
                } else {
                  setConfirmingClear(true);
                }
              }}
              hint={confirmingClear ? undefined : 'It is stored only on this phone.'}
              testID="clear-history"
            />
          ) : null}
          <Button
            label="Back"
            variant="ghost"
            onPress={() => navigate('home')}
            style={history.length > 0 ? styles.backSpaced : undefined}
          />
        </View>
      }>
      <Txt variant="label" tone="tertiary" uppercase>
        History
      </Txt>
      <Txt variant="title" style={styles.headline}>
        Every check, and why.
      </Txt>

      {history.length === 0 ? (
        <EmptyState
          title="No checks yet"
          message="Payments Ruko has looked at will appear here, with the evidence behind each decision."
        />
      ) : (
        history.map(event => (
          <Card key={event.id} style={styles.card}>
            <View style={styles.head}>
              <View style={styles.headMain}>
                <Txt variant="heading">{formatMinor(event.amountMinor)}</Txt>
                <Txt variant="caption" tone="tertiary">
                  {event.payeeDisplayName ?? 'Unknown recipient'} · {formatRelative(event.timestamp)}
                </Txt>
              </View>
              <View style={styles.score}>
                <Txt variant="heading" color={riskPalette[event.level].fg}>
                  {event.score}
                </Txt>
                <Txt variant="label" color={riskPalette[event.level].fg} uppercase>
                  {riskPalette[event.level].label}
                </Txt>
              </View>
            </View>

            {event.reasons.length > 0 ? (
              <View style={styles.reasons}>
                {event.reasons.map(reason => (
                  <Txt key={reason.code} variant="caption" tone="secondary" style={styles.reason}>
                    · {reason.label} (+{reason.points})
                  </Txt>
                ))}
              </View>
            ) : (
              <Txt variant="caption" tone="tertiary" style={styles.reasons}>
                Nothing concerning found.
              </Txt>
            )}

            <Txt variant="caption" tone="secondary" style={styles.outcome}>
              {OUTCOME_COPY[event.outcome]}
            </Txt>
            <Txt variant="caption" tone="tertiary" style={styles.versions}>
              {event.modelVersion} · {event.weightsVersion} · {event.policyVersion}
            </Txt>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headline: {marginTop: space.md, marginBottom: space.lg},
  card: {marginBottom: space.md},
  head: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start'},
  headMain: {flex: 1, paddingRight: space.md},
  score: {alignItems: 'flex-end'},
  reasons: {
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  reason: {marginBottom: 2},
  outcome: {marginTop: space.md},
  versions: {marginTop: space.xs},
  backSpaced: {marginTop: space.sm},
});
