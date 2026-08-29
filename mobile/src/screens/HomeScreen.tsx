import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import type {EngineDiagnostics} from '@contracts';
import {Card, EmptyState, Pill, Screen, Txt} from '@/components';
import {colors, radius, riskPalette, space} from '@/theme';
import {useServices} from '@/services/ServicesContext';
import {
  useCheckedToday,
  useInterventionsToday,
  useProtectionStore,
} from '@/store/protectionStore';
import {formatMinor, formatRelative} from '@/utils/format';

/**
 * Quiet by default. The dashboard deliberately does NOT show a live "current
 * risk" number when nothing is happening — there is no payment to score, so
 * any number there would be invented. It shows the last real check instead.
 */
export function HomeScreen() {
  const services = useServices();
  const navigate = useProtectionStore(s => s.navigate);
  const machineState = useProtectionStore(s => s.machineState);
  const protectionEnabled = useProtectionStore(s => s.protectionEnabled);
  const setProtectionEnabled = useProtectionStore(s => s.setProtectionEnabled);
  const guardianState = useProtectionStore(s => s.guardianState);
  const history = useProtectionStore(s => s.history);
  const checks = useCheckedToday();
  const interventions = useInterventionsToday();

  const [diagnostics, setDiagnostics] = useState<EngineDiagnostics | null>(null);

  useEffect(() => {
    let cancelled = false;
    services.diagnostics.read().then(d => {
      if (!cancelled) {
        setDiagnostics(d);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [services.diagnostics]);

  const last = history[0];

  return (
    <Screen testID="home-screen">
      <View style={styles.header}>
        <Txt variant="label" tone="tertiary" uppercase>
          Ruko
        </Txt>
        <Pressable
          accessibilityRole="button"
          onPress={() => setProtectionEnabled(!protectionEnabled)}
          testID="toggle-protection">
          <Pill
            label={protectionEnabled ? 'Protection on' : 'Paused'}
            dotColor={protectionEnabled ? colors.safe : colors.textTertiary}
            fg={protectionEnabled ? colors.safe : colors.textTertiary}
          />
        </Pressable>
      </View>

      <Txt variant="title" style={styles.state}>
        {STATE_COPY[machineState] ?? 'Watching for payment pressure.'}
      </Txt>
      <Txt variant="body" tone="secondary" style={styles.stateSub}>
        {protectionEnabled
          ? 'Ruko checks a payment when one is about to happen. Nothing runs in between.'
          : 'Protection is paused. Ruko will not check payments until you turn it back on.'}
      </Txt>

      <View style={styles.statRow}>
        <Stat label="Checks today" value={String(checks)} />
        <Stat label="Interventions" value={String(interventions)} />
        <Stat
          label="Guardian"
          value={guardianState === 'ONLINE' ? 'Online' : 'Offline'}
          tone={guardianState === 'ONLINE' ? colors.safe : colors.textTertiary}
        />
      </View>

      <Card title="Where the analysis runs" style={styles.card}>
        <View style={styles.kv}>
          <Txt variant="body" tone="secondary">
            Manipulation model
          </Txt>
          <Txt variant="mono" color={colors.text}>
            {diagnostics ? backendLabel(diagnostics) : '—'}
          </Txt>
        </View>
        <View style={styles.kv}>
          <Txt variant="body" tone="secondary">
            Internet
          </Txt>
          <Txt variant="mono" color={colors.textSecondary}>
            Not required
          </Txt>
        </View>
        <Pressable onPress={() => navigate('engineering')} testID="open-engineering">
          <Txt variant="caption" color={colors.accent} style={styles.link}>
            See exactly what is loaded →
          </Txt>
        </Pressable>
      </Card>

      <Card title="Recent checks" style={styles.card}>
        {last ? (
          history.slice(0, 4).map(event => (
            <Pressable
              key={event.id}
              accessibilityRole="button"
              onPress={() => navigate('history')}
              style={styles.eventRow}>
              <View style={styles.eventMain}>
                <Txt variant="bodyStrong">{formatMinor(event.amountMinor)}</Txt>
                <Txt variant="caption" tone="tertiary">
                  {event.payeeDisplayName ?? 'Unknown recipient'} · {formatRelative(event.timestamp)}
                </Txt>
              </View>
              <Txt variant="label" color={riskPalette[event.level].fg} uppercase>
                {riskPalette[event.level].label}
              </Txt>
            </Pressable>
          ))
        ) : (
          <EmptyState
            title="Nothing checked yet"
            message="Ruko has not seen a payment on this device yet."
          />
        )}
      </Card>

      <View style={styles.actions}>
        <NavTile label="Demo mode" caption="Run a scenario end to end" onPress={() => navigate('paydemo')} />
        <NavTile label="Guardian" caption="Office Kit link" onPress={() => navigate('guardian')} />
        <NavTile label="History" caption="Every decision Ruko made" onPress={() => navigate('history')} />
      </View>
    </Screen>
  );
}

const STATE_COPY: Record<string, string> = {
  IDLE: 'Nothing to check right now.',
  MONITORING: 'Listening during this call.',
  PAYMENT_WATCH: 'A payment is on screen.',
  INVESTIGATION: 'Checking this payment.',
  INTERVENTION: 'Ruko stopped a payment.',
  GUARDIAN_ESCALATION: 'Waiting for your guardian.',
  RESOLVED: 'Last payment checked out.',
};

function backendLabel(d: EngineDiagnostics): string {
  if (!d.classifier.loaded) {
    return 'Not loaded';
  }
  return d.classifier.backend === 'HEURISTIC' ? 'On-device · heuristic' : `On-device · ${d.classifier.backend}`;
}

function Stat({label, value, tone}: {label: string; value: string; tone?: string}) {
  return (
    <View style={styles.stat}>
      <Txt variant="heading" color={tone ?? colors.text}>
        {value}
      </Txt>
      <Txt variant="label" tone="tertiary" uppercase style={styles.statLabel}>
        {label}
      </Txt>
    </View>
  );
}

function NavTile({label, caption, onPress}: {label: string; caption: string; onPress: () => void}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={`nav-${label.toLowerCase().replace(/\s+/g, '-')}`}
      style={({pressed}) => [styles.tile, pressed && styles.tilePressed]}>
      <Txt variant="bodyStrong">{label}</Txt>
      <Txt variant="caption" tone="tertiary">
        {caption}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
  state: {marginTop: space.xl},
  stateSub: {marginTop: space.md},
  statRow: {flexDirection: 'row', marginTop: space.xl, marginBottom: space.lg},
  stat: {flex: 1},
  statLabel: {marginTop: 4},
  card: {marginTop: space.md},
  kv: {flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space.sm},
  link: {marginTop: space.md},
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
  },
  eventMain: {flex: 1, paddingRight: space.md},
  actions: {marginTop: space.lg},
  tile: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.lg,
    marginBottom: space.sm,
  },
  tilePressed: {backgroundColor: colors.surfacePressed},
});
