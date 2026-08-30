import React, {useEffect, useState} from 'react';
import {StyleSheet, Vibration, View} from 'react-native';
import type {GuardianAlert} from '@contracts';
import {Button, Card, EmptyState, Pill, Row, Screen, Txt} from '@/components';
import {colors, riskPalette, space} from '@/theme';
import {useDemo} from '@/services/ServicesContext';
import {useProtectionStore} from '@/store/protectionStore';
import {formatMinor} from '@/utils/format';
import {
  acknowledgeAlert,
  listAlertsIWatch,
  subscribeToAlerts,
  type Alert as CloudAlert,
} from '@/services/cloud/trustedCircle';
import {cloudConfigured} from '@/services/cloud/supabase';
import {showNativeIntervention} from '@/services/native/nativeProviders';

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
  // Alerts raised by someone this phone watches over. Before this the screen
  // only ever read the local stub inbox, so a guardian signed in on their own
  // phone sat on "Nothing waiting" for ever: the alert reached the database and
  // the web console, and the one device the guardian actually carries never
  // heard about it.
  const [watched, setWatched] = useState<CloudAlert[]>([]);

  useEffect(() => demo.guardian.inbox.subscribe(setAlert), [demo.guardian]);

  useEffect(() => {
    if (!cloudConfigured) return;
    let live = true;
    void listAlertsIWatch().then(rows => {
      if (live) setWatched(rows);
    });
    // RLS decides what arrives, so a new alert for someone we do not watch
    // never reaches this callback at all.
    // The loud part (overlay + vibration) lives in useGuardianWatch at the app
    // root, so it fires wherever the guardian is. This only keeps the list on
    // this screen current.
    const stop = subscribeToAlerts(() => {
      void listAlertsIWatch().then(rows => {
        if (live) setWatched(rows);
      });

    });
    return () => {
      live = false;
      stop();
    };
  }, []);

  const onAcknowledge = async (id: string) => {
    // Optimistic: the row is gone from the list the moment it is acted on, and
    // the refetch below corrects it if the write was refused.
    setWatched(current => current.filter(a => a.id !== id));
    await acknowledgeAlert(id);
    void listAlertsIWatch().then(setWatched);
  };

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
        ) : watched.length > 0 ? (
          <>
            {watched.map(a => (
              <View key={a.id} style={styles.watched}>
                <Txt variant="heading">{formatMinor(a.amount_minor ?? 0)}</Txt>
                <Txt variant="body" tone="secondary" style={styles.payee}>
                  to {a.payee_label ?? 'an unnamed recipient'}
                </Txt>
                <Row
                  label="Risk"
                  value={`${a.score}/100 · ${a.band}`}
                  valueColor={a.band === 'CRITICAL' ? colors.critical : colors.medium}
                />
                {(a.reasons ?? []).slice(0, 4).map((reason, i) => (
                  <Row
                    key={`${a.id}-${i}`}
                    label={typeof reason === 'string' ? reason : String(reason)}
                    value=""
                  />
                ))}
                <Txt variant="caption" tone="tertiary" style={styles.payee}>
                  {a.acknowledged_at ? 'Acknowledged' : 'Waiting for you'}
                </Txt>
                {a.acknowledged_at ? null : (
                  <View style={styles.actions}>
                    <Button
                      label="I've seen this"
                      onPress={() => void onAcknowledge(a.id)}
                      testID={`guardian-ack-${a.id}`}
                    />
                  </View>
                )}
              </View>
            ))}
          </>
        ) : (
          <EmptyState
            title="Nothing waiting"
            message="Critical payments from someone you watch over appear here, the moment they happen."
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
  watched: {marginBottom: space.lg},
  actions: {marginTop: space.lg},
  allow: {marginTop: space.sm},
});
