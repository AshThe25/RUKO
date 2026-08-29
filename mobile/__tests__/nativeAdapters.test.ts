/**
 * The native seam. These tests exist because the dangerous failure here is
 * silent: a payment screen Ruko cannot read must never score as a safe
 * payment, and a native module that is missing or throwing must never look
 * like a device reporting "all clear".
 */
import {
  toCallEvidence,
  toNotificationEvidence,
  toPaymentEvidence,
} from '@/services/native/nativeProviders';
import {hasNativeModule} from '@/services/native/RukoNative';
import {createServices, stubbedParts} from '@/services/createServices';

describe('native payload adapters', () => {
  it('marks an unreadable payment screen unavailable, not empty', () => {
    const evidence = toPaymentEvidence({
      active: true,
      amountMinor: null,
      payeeDisplayName: null,
      payeeHash: null,
      parsed: 'ACCESSIBILITY',
    });
    expect(evidence.active).toBe(true);
    expect(evidence.available).toBe(false);
    expect(evidence.unavailableReason).toMatch(/could not read the amount/i);
  });

  it('accepts a payment screen it could read', () => {
    const evidence = toPaymentEvidence({
      active: true,
      amountMinor: 4_800_000,
      payeeDisplayName: 'Ravi Verify',
      payeeHash: 'abc',
      appPackage: 'com.example.upi',
      parsed: 'ACCESSIBILITY',
    });
    expect(evidence.available).toBe(true);
    expect(evidence.amountMinor).toBe(4_800_000);
    expect(evidence.source).toBe('ACCESSIBILITY');
  });

  it('records the demo app as DEMO, never as a real accessibility read', () => {
    const evidence = toPaymentEvidence({
      active: true,
      amountMinor: 50_000,
      payeeDisplayName: 'Ananya',
      payeeHash: 'abc',
      parsed: 'DEMO',
    });
    expect(evidence.source).toBe('DEMO');
  });

  it('treats a missing native answer as unknown', () => {
    expect(toCallEvidence(null).available).toBe(false);
    expect(toNotificationEvidence(null).available).toBe(false);
    expect(toNotificationEvidence(null).suspicion).toBe(0);
  });

  it('keeps callerKnown null when contacts could not be checked', () => {
    const evidence = toCallEvidence({
      active: true,
      callerKnown: null,
      direction: 'INCOMING',
      durationMs: 4000,
      startedBeforePayment: true,
    });
    expect(evidence.available).toBe(true);
    expect(evidence.callerKnown).toBeNull();
  });

  it('clamps a notification suspicion the native side got wrong', () => {
    const evidence = toNotificationEvidence({
      suspicion: 4.2,
      matchedCategories: ['KYC_EXPIRY'],
      count: 3,
      windowMs: 1000,
    });
    expect(evidence.suspicion).toBe(1);
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
    expect(parts).toEqual(expect.arrayContaining(['risk engine', 'speech', 'payment screen']));
  });

  it('reports the loaded classifier and engine versions, not defaults', async () => {
    const runtime = createServices();
    await runtime.demo.bus.init();
    const diagnostics = await runtime.services.diagnostics.read();

    expect(diagnostics.classifier.modelVersion).toBe('stub-lexicon-v0');
    expect(diagnostics.classifier.backend).toBe('HEURISTIC');
    expect(diagnostics.asr.available).toBe(false);
    expect(diagnostics.asr.backend).toBe('UNAVAILABLE');
    expect(diagnostics.riskEngine.weightsVersion).toBe('weights-v1-spec20');
  });
});
