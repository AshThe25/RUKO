import React, {useEffect, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import type {GuardianAlert} from '@contracts';
import {Button, Card, EmptyState, Pill, Row, Screen, Txt} from '@/components';
import {colors, riskPalette, space} from '@/theme';
import {useDemo} from '@/services/ServicesContext';
import {useProtectionStore} from '@/store/protectionStore';
import {formatMinor} from '@/utils/format';

/**
 * Guardian link status, and — until the Office Kit is wired up — a stand-in
 * for it so the escalation path can be exercised end to end on the phone.
 *
 * The rule this screen has to make visible: the guardian is optional. When the
 * link is down, the phone says so plainly and keeps protecting.
 */
export function GuardianScreen() {
  const demo = useDemo();
  const navigate = useProtectionStore(s => s.navigate);
  const guardianState = useProtectionStore(s => s.guardianState);
  const [alert, setAlert] = useState<GuardianAlert | null>(null);

  useEffect(() => demo.guardian.inbox.subscribe(setAlert), [demo.guardian]);

  const online = guardianState === 'ONLINE';

  return (
    <Screen
      testID="guardian-screen"
      footer={<Button label="Back" variant="ghost" onPress={() => navigate('home')} />}>
      <Txt variant="label" tone="tertiary" uppercase>
        Guardian
      </Txt>
      <Txt variant="title" style={styles.headline}>
        A second pair of eyes, when you want one.
      </Txt>
      <Txt variant="body" tone="secondary" style={styles.sub}>
        If a payment reaches critical risk, Ruko can show it to someone you
        trust. They see the amount, the recipient and the reasons — never your
        conversation.
      </Txt>

      <Card style={styles.card}>
        <View style={styles.statusRow}>
          <Pill
            label={STATE_LABEL[guardianState]}
            dotColor={online ? colors.safe : colors.textTertiary}
            fg={online ? colors.safe : colors.textTertiary}
          />
          <Button
            label={online ? 'Disconnect' : 'Connect'}
            variant="quiet"
            onPress={() => (online ? demo.guardian.unpair() : demo.guardian.pair('Office Kit'))}
            style={styles.connect}
            testID="guardian-toggle"
          />
        </View>
        <Txt variant="caption" tone="tertiary" style={styles.note}>
          {online
            ? 'Critical payments will be sent for review. If the link drops mid-review, the phone keeps the payment blocked.'
            : 'Ruko is protecting this phone on its own. Nothing about your payments is being sent anywhere.'}
        </Txt>
      </Card>

      <Card title="Incoming review" style={styles.card}>
        {alert ? (
          <>
            <Txt variant="heading">{formatMinor(alert.amountMinor)}</Txt>
            <Txt variant="body" tone="secondary" style={styles.payee}>
              to {alert.payeeDisplayName ?? 'an unnamed recipient'}
            </Txt>
            <Row
              label="Risk"
              value={`${alert.score}/100`}
              valueColor={riskPalette[alert.level].fg}
            />
            {alert.reasons.map(reason => (
              <Row key={reason.code} label={reason.label} value={`+${reason.points}`} />
            ))}
            <View style={styles.actions}>
              <Button
                label="Keep blocked"
                onPress={() => demo.guardian.respond(alert.sessionId, 'KEEP_BLOCKED')}
                testID="guardian-keep-blocked"
              />
              <Button
                label="Allow this payment"
                variant="ghost"
                onPress={() => demo.guardian.respond(alert.sessionId, 'ALLOW')}
                style={styles.allow}
                testID="guardian-allow"
              />
            </View>
          </>
        ) : (
          <EmptyState
            title="Nothing waiting"
            message="Critical payments appear here for review. This stands in for the Office Kit until it is connected."
          />
        )}
      </Card>
    </Screen>
  );
}

const STATE_LABEL: Record<string, string> = {
  UNPAIRED: 'Not connected',
  OFFLINE: 'Offline',
  CONNECTING: 'Connecting',
  ONLINE: 'Online',
};

const styles = StyleSheet.create({
  headline: {marginTop: space.md},
  sub: {marginTop: space.md},
  card: {marginTop: space.lg},
  statusRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  connect: {minHeight: 40, paddingVertical: space.sm},
  note: {marginTop: space.md},
  payee: {marginTop: space.xs, marginBottom: space.md},
  actions: {marginTop: space.lg},
  allow: {marginTop: space.sm},
});
