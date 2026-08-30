/**
 * The native seam, tested against the payload shapes
 * `android/ruko-native/.../RukoNativeModule.kt` actually sends.
 *
 * These exist because the dangerous failure here is silent: a payment screen
 * Ruko cannot read must never score as a safe payment, and a native module
 * that is missing or throwing must never look like a device reporting
 * "all clear".
 */
import {
  describeBackend,
  toCallEvidence,
  toEvidenceSource,
  toInferenceBackend,
  toNotificationEvidence,
  toPaymentEvidence,
} from '@/services/native/nativeProviders';
import {hasNativeModule} from '@/services/native/RukoNative';
import {createServices, stubbedParts} from '@/services/createServices';

describe('payment payloads', () => {
  // The bridge sends integer paise as `amountMinor` and epoch milliseconds as
  // `observedAt`. These tests previously described a `amount`-in-rupees field
  // the bridge has never sent, which is exactly how the units bug survived: the
  // suite was green against a contract that did not exist.
  it('takes the amount in paise, without rescaling it', () => {
    const evidence = toPaymentEvidence({
      active: true,
      amountMinor: 4_800_000,
      currency: 'INR',
      payee: 'Ravi Verify',
      payeeHash: 'abc',
      source: 'ACCESSIBILITY',
      packageName: 'com.example.upi',
      observedAt: 1_756_461_600_000,
    });
    expect(evidence.available).toBe(true);
    expect(evidence.amountMinor).toBe(4_800_000);
    expect(evidence.source).toBe('ACCESSIBILITY');
    expect(evidence.appPackage).toBe('com.example.upi');
  });

  it('keeps paise exact rather than rounding through rupees', () => {
    const evidence = toPaymentEvidence({
      active: true,
      amountMinor: 123456,
      currency: 'INR',
      payee: 'X',
      payeeHash: 'h',
      source: 'DEMO',
      packageName: null,
      observedAt: 0,
    });
    expect(evidence.amountMinor).toBe(123456);
  });

  it('marks an active but unreadable payment screen unavailable, not empty', () => {
    const evidence = toPaymentEvidence({
      active: true,
      amountMinor: 0,
      currency: 'INR',
      payee: null,
      payeeHash: null,
      source: 'ACCESSIBILITY',
      packageName: null,
      observedAt: 0,
    });
    expect(evidence.active).toBe(true);
    expect(evidence.available).toBe(false);
    expect(evidence.unavailableReason).toMatch(/could not read the amount/i);
  });

  it('records the demo app as DEMO, never as a real accessibility read', () => {
    expect(toEvidenceSource('DEMO')).toBe('DEMO');
    expect(toEvidenceSource('ACCESSIBILITY')).toBe('ACCESSIBILITY');
    // Anything unrecognised is MOCK — the source that must never ship.
    expect(toEvidenceSource('SOMETHING_NEW')).toBe('MOCK');
    expect(toEvidenceSource(null)).toBe('MOCK');
  });

  it('treats no payment surface as unavailable', () => {
    const evidence = toPaymentEvidence(null);
    expect(evidence.available).toBe(false);
    expect(evidence.amountMinor).toBeNull();
  });
});

describe('call payloads', () => {
  it('converts seconds to milliseconds', () => {
    const evidence = toCallEvidence({
      active: true,
      callerKnown: false,
      durationSeconds: 42,
      audioFromMicrophone: true,
    });
    expect(evidence.available).toBe(true);
    expect(evidence.durationMs).toBe(42_000);
    expect(evidence.callerKnown).toBe(false);
  });

  it('treats a missing native answer as unknown', () => {
    const evidence = toCallEvidence(null);
    expect(evidence.available).toBe(false);
    expect(evidence.callerKnown).toBeNull();
  });
});

describe('notification payloads', () => {
  it('converts the lookback window to milliseconds', () => {
    const evidence = toNotificationEvidence({
      suspicion: 0.61,
      matchCount: 2,
      lookbackMinutes: 1440,
    });
    expect(evidence.available).toBe(true);
    expect(evidence.count).toBe(2);
    expect(evidence.windowMs).toBe(86_400_000);
  });

  it('clamps a suspicion the native side got wrong', () => {
    const evidence = toNotificationEvidence({
      suspicion: 4.2,
      matchCount: 1,
      lookbackMinutes: 60,
    });
    expect(evidence.suspicion).toBe(1);
  });

  it('treats no notification access as unavailable, not as zero suspicion', () => {
    const evidence = toNotificationEvidence(null);
    expect(evidence.available).toBe(false);
    expect(evidence.suspicion).toBe(0);
  });
});

describe('inference backend', () => {
  it('passes through the backend the runtime actually reported', () => {
    expect(toInferenceBackend('NNAPI')).toBe('NNAPI');
    expect(toInferenceBackend('QNN')).toBe('QNN');
    expect(toInferenceBackend('HEURISTIC')).toBe('HEURISTIC');
  });

  /**
   * These are the names the bridge actually sends -- `ruko-core`'s enum is
   * CPU/NNAPI/QUALCOMM/RULES/UNKNOWN. The suite previously only exercised the
   * contract's own spellings, which native never emits, so the whole
   * translation could be wrong with every assertion green.
   */
  it('translates the names ruko-core really sends', () => {
    expect(toInferenceBackend('QUALCOMM')).toBe('QNN');
    expect(toInferenceBackend('RULES')).toBe('HEURISTIC');
    expect(toInferenceBackend('CPU')).toBe('CPU');
    expect(toInferenceBackend('UNKNOWN')).toBe('UNAVAILABLE');
  });

  it('never invents a backend it was not told about', () => {
    expect(toInferenceBackend('SNAPDRAGON_MAGIC')).toBe('UNAVAILABLE');
    expect(toInferenceBackend(null)).toBe('UNAVAILABLE');
    expect(describeBackend(null).backend).toBe('UNAVAILABLE');
    expect(describeBackend(null).degradedReason).toBeTruthy();
  });

  it('carries the runtime own degraded reason through', () => {
    const described = describeBackend({
      engine: 'onnxruntime',
      model: 'ruko-manip-v1',
      backend: 'CPU',
      isLocal: true,
      isReady: true,
      lastLatencyMs: 31,
      degradedReason: 'NNAPI delegate refused the graph.',
    });
    expect(described.backend).toBe('CPU');
    expect(described.model).toBe('ruko-manip-v1');
    expect(described.lastLatencyMs).toBe(31);
    expect(described.degradedReason).toMatch(/NNAPI/);
  });
});

describe('service wiring', () => {
  it('falls back to stubs when the native module is absent', () => {
    // The test environment ships no native module — that is the point.
    expect(hasNativeModule()).toBe(false);
    const runtime = createServices();
    expect(runtime.origins.call).toBe('stub');
    expect(runtime.origins.payment).toBe('stub');
    expect(runtime.usingStubs).toBe(true);
    expect(runtime.demoAvailable).toBe(true);
  });

  it('names the parts that are still stand-ins so the UI can say so', () => {
    const runtime = createServices();
    const parts = stubbedParts(runtime.origins);
    // The risk engine is no longer in this list, and that is the point: it
    // runs for real in every build, native or not, because it is pure
    // deterministic scoring with no device dependency. What remains stubbed is
    // only what genuinely needs the device.
    expect(parts).toEqual(
      expect.arrayContaining(['call state', 'payment screen', 'notifications']),
    );
    expect(parts).not.toContain('risk engine');
  });

  it('reports the loaded classifier and engine versions, not defaults', async () => {
    const runtime = createServices();
    await runtime.demo.bus.init();
    const diagnostics = await runtime.services.diagnostics.read();

    expect(diagnostics.classifier.modelVersion).toBe('stub-lexicon-v0');
    expect(diagnostics.classifier.backend).toBe('HEURISTIC');
    // ASR is reachable even without the native module: transcription is a
    // call to the backend proxy, not an on-device capability. Reporting it as
    // unavailable here would understate what a stub build can actually do.
    expect(diagnostics.asr.available).toBe(true);
    expect(diagnostics.riskEngine.weightsVersion).toBe('ruko-weights-v1');
  });
});
