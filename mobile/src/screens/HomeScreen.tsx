import React, {useEffect, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import type {CallEvidence, EngineDiagnostics} from '@contracts';
import {Bloom, Card, EmptyState, OfflineBanner, Pill, Screen, Txt} from '@/components';
import {colors, radius, riskPalette, space} from '@/theme';
import {stubbedParts} from '@/services/createServices';
import {useRuntime, useServices} from '@/services/ServicesContext';
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
  const runtime = useRuntime();
  const navigate = useProtectionStore(s => s.navigate);
  const machineState = useProtectionStore(s => s.machineState);
  const protectionEnabled = useProtectionStore(s => s.protectionEnabled);
  const setProtectionEnabled = useProtectionStore(s => s.setProtectionEnabled);
  const guardianState = useProtectionStore(s => s.guardianState);
  const history = useProtectionStore(s => s.history);
  // Re-read once the neural model replaces the lexicon. Without this the line
  // below keeps saying 'heuristic' for the whole session while the model is
  // actually running -- the app under-reporting itself.
  const modelNonce = useProtectionStore(s => s.modelNonce);
  const checks = useCheckedToday();
  const interventions = useInterventionsToday();

  const [diagnostics, setDiagnostics] = useState<EngineDiagnostics | null>(null);
  const [call, setCall] = useState<CallEvidence | null>(null);

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
  }, [services.diagnostics, modelNonce]);

  // Live call state, so the monitoring banner reflects the device rather than
  // a screen-local guess.
  useEffect(() => services.call.subscribe(setCall), [services.call]);

  const last = history[0];
  const listening = !!call?.active && protectionEnabled;
  const stubs = stubbedParts(runtime.origins);

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

      {listening ? (
        <View style={styles.monitoring} testID="monitoring-banner">
          <View style={styles.pulse} />
          <Txt variant="caption" color={colors.safe}>
            Listening during this call. Audio stays on this phone.
          </Txt>
        </View>
      ) : null}

      {machineState === 'IDLE' && protectionEnabled ? (
        <View style={styles.quiet}>
          <Bloom size={200} tint="duo" />
          <Txt variant="title" center style={styles.quietTitle} accessibilityRole="header">
            {STATE_COPY.IDLE}
          </Txt>
          <Txt variant="body" tone="secondary" center style={styles.quietSub}>
            This screen staying quiet is what working looks like. Ruko wakes up
            when a payment is about to happen, and stays out of the way the rest
            of the time.
          </Txt>
        </View>
      ) : (
        <>
          <Txt variant="title" style={styles.state} accessibilityRole="header">
            {STATE_COPY[machineState] ?? 'Watching for payment pressure.'}
          </Txt>
          <Txt variant="body" tone="secondary" style={styles.stateSub}>
            {protectionEnabled
              ? 'Ruko checks a payment when one is about to happen. Nothing runs in between.'
              : 'Protection is paused. Ruko will not check payments until you turn it back on.'}
          </Txt>
        </>
      )}

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

      {diagnostics?.offline ? (
        <View style={styles.card}>
          <OfflineBanner guardianReachable={guardianState === 'ONLINE'} />
        </View>
      ) : null}

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
            title="No payments checked yet"
            message="The next time you are about to pay someone, Ruko will check it and the result will show up here — including the ones it decides are fine."
          />
        )}
      </Card>

      <View style={styles.actions}>
        {runtime.demoAvailable ? (
          <NavTile
            label="Demo mode"
            caption="Run a scenario through the real pipeline"
            onPress={() => navigate('paydemo')}
          />
        ) : null}
        <NavTile label="Guardian" caption="Office Kit link" onPress={() => navigate('guardian')} />
        <NavTile
          label="Trusted circle"
          caption="Who gets told"
          onPress={() => navigate('circle')}
        />
        <NavTile label="History" caption="Every decision Ruko made" onPress={() => navigate('history')} />
        <NavTile
          label="Permissions"
          caption="What Ruko can see, and what it cannot"
          onPress={() => navigate('permissions')}
        />
      </View>

      {stubs.length > 0 ? (
        <Txt variant="caption" tone="tertiary" style={styles.buildNote}>
          Development build. Standing in for the real thing: {stubs.join(', ')}. The
          engineering screen shows exactly what is loaded.
        </Txt>
      ) : null}
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
    <View style={styles.stat} accessible accessibilityLabel={`${value} ${label}`}>
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
  monitoring: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.lg,
    paddingVertical: space.sm,
  },
  pulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.safe,
    marginRight: space.sm,
  },
  state: {marginTop: space.xl},
  stateSub: {marginTop: space.md},
  quiet: {alignItems: 'center', marginTop: space.xl, marginBottom: space.sm},
  quietTitle: {marginTop: space.lg},
  quietSub: {marginTop: space.md},
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
  buildNote: {marginTop: space.lg},
});
