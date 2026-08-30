import React, {useEffect, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {Button, Card, Screen, Txt} from '@/components';
import {colors, space} from '@/theme';
import {useProtectionStore} from '@/store/protectionStore';
import {HOLD_MINUTES, type Approval} from '@/services/cloud/spendHold';
import {formatMinor} from '@/utils/format';

/**
 * Waiting for a trusted contact to decide.
 *
 * This screen is honest about its own limits. It does not say the payment was
 * blocked, because Ruko cannot reach into another app and stop one. It says
 * Ruko is asking someone first, and it leaves a way past -- a hold with no exit
 * is a hold people learn to uninstall.
 */
export function HoldScreen() {
  const navigate = useProtectionStore(s => s.navigate);
  // The setter is deliberately unused for now: nothing delivers a guardian's
  // answer to this screen yet, because the approve/deny console is unbuilt.
  // Named with the underscore so that stays visible rather than looking done.
  const [approval, _setApproval] = useState<Approval>('pending');
  const [remaining, setRemaining] = useState(HOLD_MINUTES * 60);

  useEffect(() => {
    if (approval !== 'pending') return;
    const t = setInterval(() => setRemaining(r => Math.max(0, r - 1)), 1000);
    return () => clearInterval(t);
  }, [approval]);

  const mins = Math.floor(remaining / 60);
  const secs = String(remaining % 60).padStart(2, '0');

  return (
    <Screen
      testID="hold-screen"
      footer={
        <Button
          label="Continue anyway"
          variant="ghost"
          onPress={() => navigate('home')}
          hint="Ruko cannot stop the payment itself — this is your call"
        />
      }>
      <Txt variant="label" tone="tertiary" uppercase>
        Waiting on your trusted contact
      </Txt>
      <Txt variant="title" style={styles.headline}>
        {approval === 'approved'
          ? 'Approved.'
          : approval === 'denied'
            ? 'They asked you to stop.'
            : 'Just a moment.'}
      </Txt>

      <Txt variant="body" tone="secondary" style={styles.body}>
        {approval === 'pending'
          ? 'Today’s spending has passed the limit you agreed together, so Ruko has asked them before you go further. They can see the amount and the reason — not what you were doing.'
          : approval === 'approved'
            ? 'They said this is fine. Nothing else is in the way.'
            : 'They would rather you did not. Ruko cannot stop the payment, so the decision is still yours — but they have seen it.'}
      </Txt>

      {approval === 'pending' ? (
        <Card style={styles.card}>
          <Txt variant="label" tone="tertiary" uppercase>
            Spent in this window
          </Txt>
          <Txt variant="display" style={styles.amount}>
            {formatMinor(300000)}
          </Txt>
          <Txt variant="caption" tone="tertiary">
            Across 6 payments, none of them large on its own.
          </Txt>

          <View style={styles.timerRow}>
            <Txt variant="caption" tone="secondary">
              Releases on its own in
            </Txt>
            <Txt variant="bodyStrong">
              {mins}:{secs}
            </Txt>
          </View>
          <Txt variant="caption" tone="tertiary" style={styles.small}>
            If they are asleep, you are not stuck. The hold lapses and you decide.
          </Txt>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headline: {marginTop: space.sm},
  body: {marginTop: space.md},
  card: {marginTop: space.xl, gap: space.sm},
  amount: {color: colors.high, marginTop: space.xs},
  timerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: space.lg,
    paddingTop: space.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  small: {marginTop: space.xs},
});
