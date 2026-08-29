import { describe, expect, it } from 'vitest';

import {
  backendLabel,
  envelope,
  formatLatency,
  formatRupees,
  isGuardianAlert,
  parseFrame,
} from '../protocol';

const alert = () => ({
  incidentId: 'inc_0042',
  payment: {
    // 4_800_000 paise == the ₹48,000 in the pitch.
    amountMinor: 4_800_000,
    currency: 'INR',
    payeeDisplayName: 'Ravi Verify',
    firstPayment: true,
  },
  assessment: {
    sessionId: 'rk_test',
    score: 91,
    level: 'CRITICAL',
    policyAction: 'BLOCK_WARNING',
    reasons: [
      { code: 'COERCION', label: 'The caller pressed you to move money', points: 22.5, family: 'CONVERSATION' },
      { code: 'NEW_PAYEE', label: 'First payment to this recipient', points: 10, family: 'PAYEE_BEHAVIOUR' },
      { code: 'AMOUNT_ANOMALY', label: 'Far above your normal range', points: 9.1, family: 'PAYEE_BEHAVIOUR' },
    ],
    contributions: [],
    corroboratingFamilies: ['CONVERSATION', 'PAYEE_BEHAVIOUR'],
    degraded: false,
    degradedReasons: [],
    escalateToGuardian: true,
    modelVersion: 'ruko-risk-v1',
    weightsVersion: 'weights-v1',
    policyVersion: 'policy-v1',
    engineVersion: 'engine-v1',
    timestamp: 1787990000000,
    computeMs: 12.4,
  },
  runtime: {
    engine: 'onnxruntime-android',
    model: 'ruko-risk-v1',
    backend: 'CPU',
    isLocal: true,
    isReady: true,
    lastLatencyMs: 41,
    degradedReason: null,
  },
  phoneState: 'PAYMENT_PAUSED',
  expiresInSec: 120,
});

const frame = (type: string, payload: unknown) =>
  JSON.stringify({
    protocolVersion: '1.0.0',
    type,
    messageId: 'msg_1',
    sessionId: 'rk_1',
    sentAt: 1787990000000,
    payload,
  });

describe('parseFrame', () => {
  it('accepts a well-formed risk alert', () => {
    const parsed = parseFrame(frame('GUARDIAN_ALERT', alert()));
    expect(parsed?.type).toBe('GUARDIAN_ALERT');
  });

  it('rejects a frame from a different protocol version', () => {
    const raw = JSON.parse(frame('GUARDIAN_ALERT', alert()));
    raw.protocolVersion = '2.0.0';
    expect(parseFrame(JSON.stringify(raw))).toBeNull();
  });

  it('rejects malformed json rather than throwing', () => {
    expect(parseFrame('{not json')).toBeNull();
  });

  it('rejects an unknown message type', () => {
    expect(parseFrame(frame('DELETE_EVERYTHING', {}))).toBeNull();
  });

  it('rejects a presence frame missing a field', () => {
    expect(parseFrame(frame('PRESENCE', { phoneConnected: true }))).toBeNull();
  });

  it('accepts a valid presence frame', () => {
    const parsed = parseFrame(
      frame('PRESENCE', {
        phoneConnected: true,
        guardianConnected: true,
        phoneDisplayName: 'Ruko on iQOO 15',
        guardianLabel: 'Priya',
      }),
    );
    expect(parsed?.type).toBe('PRESENCE');
  });
});

describe('isGuardianAlert', () => {
  it('rejects an assessment with no reasons at all', () => {
    const bad = alert();
    bad.assessment.reasons = [];
    expect(isGuardianAlert(bad)).toBe(false);
  });

  it('rejects a blank reason label, which would render as an empty bullet', () => {
    const bad = alert();
    bad.assessment.reasons[0]!.label = '   ';
    expect(isGuardianAlert(bad)).toBe(false);
  });

  it('rejects a score outside 0..100', () => {
    const bad = alert();
    bad.assessment.score = 140;
    expect(isGuardianAlert(bad)).toBe(false);
  });

  it('rejects a non-integer score', () => {
    const bad = alert();
    bad.assessment.score = 91.5;
    expect(isGuardianAlert(bad)).toBe(false);
  });

  it('rejects a negative amount', () => {
    const bad = alert();
    bad.payment.amountMinor = -100;
    expect(isGuardianAlert(bad)).toBe(false);
  });

  it('rejects fractional paise, which means somebody did rupee arithmetic', () => {
    const bad = alert();
    bad.payment.amountMinor = 4_800_000.5;
    expect(isGuardianAlert(bad)).toBe(false);
  });

  it('rejects an unknown inference backend', () => {
    const bad = alert();
    bad.runtime.backend = 'QUANTUM';
    expect(isGuardianAlert(bad)).toBe(false);
  });

  it('accepts a null latency, which means "not measured"', () => {
    const unmeasured = alert();
    unmeasured.runtime.lastLatencyMs = null as unknown as number;
    expect(isGuardianAlert(unmeasured)).toBe(true);
  });

  it('rejects a latency that is neither null nor a number', () => {
    const bad = alert();
    bad.runtime.lastLatencyMs = 'fast' as unknown as number;
    expect(isGuardianAlert(bad)).toBe(false);
  });

  it('rejects a phone state other than PAYMENT_PAUSED', () => {
    expect(isGuardianAlert({ ...alert(), phoneState: 'PAYMENT_SENT' })).toBe(false);
  });
});

describe('formatting', () => {
  it('converts paise to rupees with Indian grouping', () => {
    expect(formatRupees(4_800_000)).toContain('48,000');
    expect(formatRupees(10_000_000)).toContain('1,00,000');
  });

  it('does not silently round away paise', () => {
    expect(formatRupees(4_800_050)).toContain('48,000.50');
  });

  it('renders an unmeasured latency as an em dash, never a number', () => {
    expect(formatLatency(null)).toBe('—');
    expect(formatLatency(41)).toBe('41 ms');
  });

  it('never labels an unknown backend as an NPU', () => {
    expect(backendLabel('UNKNOWN')).toBe('Unknown');
    expect(backendLabel('CPU')).toBe('CPU');
    expect(backendLabel('QUALCOMM')).toBe('Qualcomm NPU');
  });
});

describe('envelope', () => {
  it('stamps the protocol version and a unique message id', () => {
    const a = envelope('GUARDIAN_ACTION', 'rk_1', { incidentId: 'inc_1' });
    const b = envelope('GUARDIAN_ACTION', 'rk_1', { incidentId: 'inc_1' });
    expect(a.protocolVersion).toBe('1.0.0');
    expect(a.messageId).not.toBe(b.messageId);
  });
});
