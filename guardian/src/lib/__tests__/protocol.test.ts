import { describe, expect, it } from 'vitest';

import {
  backendLabel,
  envelope,
  formatLatency,
  formatRupees,
  isRiskAlert,
  parseFrame,
} from '../protocol';

const alert = () => ({
  incidentId: 'inc_0042',
  payment: { amountRupees: 48000, payeeDisplayName: 'Ravi Verify', firstPayment: true },
  assessment: {
    score: 91,
    level: 'CRITICAL',
    reasons: ['Caller used authority pressure'],
    policyAction: 'BLOCK_WARNING_WITH_GUARDIAN',
    lowConfidence: false,
    modelVersion: 'ruko-risk-v1',
    policyVersion: 'policy-v1',
    evaluatedAt: '2026-08-29T07:01:59Z',
  },
  topReasons: ['one', 'two', 'three'],
  runtime: {
    engine: 'onnxruntime-android',
    model: 'ruko-risk-v1',
    backend: 'CPU',
    isLocal: true,
    lastLatencyMs: 41,
  },
  phoneState: 'PAYMENT_PAUSED',
});

const frame = (type: string, payload: unknown) =>
  JSON.stringify({
    protocolVersion: '1.0.0',
    type,
    messageId: 'msg_1',
    sessionId: 'rk_1',
    sentAt: '2026-08-29T07:02:00Z',
    payload,
  });

describe('parseFrame', () => {
  it('accepts a well-formed risk alert', () => {
    const parsed = parseFrame(frame('RISK_ALERT', alert()));
    expect(parsed?.type).toBe('RISK_ALERT');
  });

  it('rejects a frame from a different protocol version', () => {
    const raw = JSON.parse(frame('RISK_ALERT', alert()));
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
        guardianDisplayName: 'Priya',
      }),
    );
    expect(parsed?.type).toBe('PRESENCE');
  });
});

describe('isRiskAlert', () => {
  it('requires exactly three reasons', () => {
    expect(isRiskAlert({ ...alert(), topReasons: ['one', 'two'] })).toBe(false);
    expect(isRiskAlert({ ...alert(), topReasons: ['a', 'b', 'c', 'd'] })).toBe(false);
  });

  it('rejects a blank reason, which would render as an empty bullet', () => {
    expect(isRiskAlert({ ...alert(), topReasons: ['one', '   ', 'three'] })).toBe(false);
  });

  it('rejects a score outside 0..100', () => {
    const bad = alert();
    bad.assessment.score = 140;
    expect(isRiskAlert(bad)).toBe(false);
  });

  it('rejects a non-integer score', () => {
    const bad = alert();
    bad.assessment.score = 91.5;
    expect(isRiskAlert(bad)).toBe(false);
  });

  it('rejects a negative amount', () => {
    const bad = alert();
    bad.payment.amountRupees = -100;
    expect(isRiskAlert(bad)).toBe(false);
  });

  it('rejects an unknown inference backend', () => {
    const bad = alert();
    bad.runtime.backend = 'QUANTUM';
    expect(isRiskAlert(bad)).toBe(false);
  });

  it('accepts a null latency, which means "not measured"', () => {
    const unmeasured = alert();
    unmeasured.runtime.lastLatencyMs = null as unknown as number;
    expect(isRiskAlert(unmeasured)).toBe(true);
  });

  it('rejects a latency that is neither null nor a number', () => {
    const bad = alert();
    bad.runtime.lastLatencyMs = 'fast' as unknown as number;
    expect(isRiskAlert(bad)).toBe(false);
  });

  it('rejects a phone state other than PAYMENT_PAUSED', () => {
    expect(isRiskAlert({ ...alert(), phoneState: 'PAYMENT_SENT' })).toBe(false);
  });
});

describe('formatting', () => {
  it('groups rupees the Indian way', () => {
    expect(formatRupees(48000)).toContain('48,000');
    expect(formatRupees(100000)).toContain('1,00,000');
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
