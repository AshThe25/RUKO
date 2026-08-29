import React, {useCallback, useEffect, useState} from 'react';
import {Platform, StyleSheet, View} from 'react-native';
import type {EngineDiagnostics} from '@contracts';
import {Button, Card, LoadingState, Row, Screen, Txt} from '@/components';
import {colors, space} from '@/theme';
import {useDemo, useServices} from '@/services/ServicesContext';
import {useProtectionStore} from '@/store/protectionStore';
import {formatLatency} from '@/utils/format';

const BENCH_ITERATIONS = 25;
const BENCH_TRANSCRIPT =
  'Hello sir, I am calling from your bank security team. Your account will be frozen within ten minutes. You must transfer 48000 immediately to the verification account. Do not disconnect this call.';

/**
 * Engineering screen — technical credibility, and a standing check on our own
 * honesty. Everything here is read from the runtime or measured on the spot.
 * If something is not real, this screen is where it has to say so.
 */
export function EngineeringScreen() {
  const services = useServices();
  const demo = useDemo();
  const navigate = useProtectionStore(s => s.navigate);
  const result = useProtectionStore(s => s.result);

  const [diagnostics, setDiagnostics] = useState<EngineDiagnostics | null>(null);
  const [bench, setBench] = useState<{p50: number; p95: number; iterations: number} | null>(null);
  const [benchRunning, setBenchRunning] = useState(false);

  useEffect(() => {
    services.diagnostics.read().then(setDiagnostics);
  }, [services.diagnostics]);

  /** A real measurement on this device, not a number from a spec sheet. */
  const runBenchmark = useCallback(async () => {
    setBenchRunning(true);
    const classifier = demo.bus.getClassifier();
    const samples: number[] = [];
    for (let i = 0; i < BENCH_ITERATIONS; i++) {
      const started = Date.now();
      await classifier.classify(BENCH_TRANSCRIPT);
      samples.push(Date.now() - started);
    }
    samples.sort((a, b) => a - b);
    setBench({
      p50: samples[Math.floor(samples.length * 0.5)]!,
      p95: samples[Math.floor(samples.length * 0.95)]!,
      iterations: BENCH_ITERATIONS,
    });
    setBenchRunning(false);
    setDiagnostics(await services.diagnostics.read());
  }, [demo.bus, services.diagnostics]);

  if (!diagnostics) {
    return (
      <Screen scroll={false}>
        <LoadingState label="Reading runtime state" />
      </Screen>
    );
  }

  const {classifier, asr, riskEngine} = diagnostics;

  return (
    <Screen
      testID="engineering-screen"
      footer={<Button label="Back" variant="ghost" onPress={() => navigate('home')} />}>
      <Txt variant="label" tone="tertiary" uppercase>
        Ruko edge engine
      </Txt>
      <Txt variant="title" style={styles.headline}>
        What is actually loaded.
      </Txt>
      <Txt variant="body" tone="secondary" style={styles.sub}>
        Read from the runtime. Where something is a stand-in or has not been
        measured, this screen says so rather than showing a green tick.
      </Txt>

      <Card title="Manipulation classifier" style={styles.card}>
        <Row label="Model" value={classifier.modelVersion} />
        <Row
          label="Loaded"
          value={classifier.loaded ? 'Yes' : 'No'}
          valueColor={classifier.loaded ? colors.safe : colors.critical}
        />
        <Row
          label="Backend"
          value={classifier.backend}
          detail={
            classifier.backend === 'HEURISTIC'
              ? 'No neural model is running. This is a phrase lexicon, not ruko-manip-v1.'
              : `Requested ${classifier.requestedBackend}`
          }
          valueColor={classifier.backend === 'HEURISTIC' ? colors.medium : colors.safe}
        />
        <Row label="Quantisation" value={classifier.quantization ?? '—'} />
        <Row label="Model hash" value={classifier.modelHash} />
        <Row
          label="Measured p50"
          value={formatLatency(bench?.p50 ?? classifier.measuredLatencyMsP50)}
          detail={bench ? `${bench.iterations} runs on this device` : 'Not benchmarked yet'}
        />
        {bench ? <Row label="Measured p95" value={formatLatency(bench.p95)} /> : null}
        <View style={styles.benchAction}>
          <Button
            label={benchRunning ? 'Running…' : 'Run benchmark on this device'}
            variant="quiet"
            loading={benchRunning}
            onPress={runBenchmark}
            testID="run-benchmark"
          />
        </View>
      </Card>

      <Card title="Speech recognition" style={styles.card}>
        <Row
          label="Available"
          value={asr.available ? 'Yes' : 'No'}
          valueColor={asr.available ? colors.safe : colors.medium}
          detail={
            asr.available
              ? undefined
              : 'On-device ASR is not integrated yet. Demo transcripts are scripted text, not recognised speech.'
          }
        />
        <Row label="Backend" value={asr.backend} />
        <Row label="Model" value={asr.modelVersion ?? '—'} />
      </Card>

      <Card title="Risk engine" style={styles.card}>
        <Row label="Engine" value={riskEngine.engineVersion} />
        <Row label="Weights" value={riskEngine.weightsVersion} />
        <Row label="Policy" value={riskEngine.policyVersion} />
        {result ? (
          <>
            <Row label="Last score" value={`${result.risk.score}/100`} />
            <Row label="Last compute" value={formatLatency(result.risk.computeMs)} />
            <Row
              label="Corroborating families"
              value={String(result.risk.corroboratingFamilies.length)}
              detail={result.risk.corroboratingFamilies.join(', ') || 'none'}
            />
          </>
        ) : null}
      </Card>

      <Card title="Device" style={styles.card}>
        <Row label="Platform" value={`${Platform.OS} ${Platform.Version}`} />
        <Row label="Model" value={diagnostics.deviceModel ?? 'Not read'} />
        <Row
          label="Network"
          value={diagnostics.offline ? 'Offline' : 'Online'}
          detail="Core protection does not need a network either way."
        />
      </Card>

      {result ? (
        <Card title="Last evaluation — every term" style={styles.card}>
          {result.risk.contributions.map(c => (
            <Row
              key={c.code}
              label={c.code}
              value={`${c.points.toFixed(1)} pts`}
              detail={`signal ${c.signal.toFixed(2)} × weight ${c.weight}${
                c.gate < 1 ? ` × gate ${c.gate}${c.gateReason ? ` (${c.gateReason})` : ''}` : ''
              }`}
              valueColor={c.points > 0 ? colors.text : colors.textTertiary}
            />
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headline: {marginTop: space.md},
  sub: {marginTop: space.md},
  card: {marginTop: space.lg},
  benchAction: {marginTop: space.lg},
});
