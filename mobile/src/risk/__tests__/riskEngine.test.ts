/**
 * Risk engine behaviour: degradation, gates, caps, determinism, and the
 * false-positive defences. These are the cases that decide whether Ruko is
 * trustworthy when the world is messy, which is most of the time.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateRisk, getRiskEngineConfig } from '../riskEngine.ts';
import {
  CORROBORATION_FRACTION, FAMILY_MAX, MAX_ACHIEVABLE_POINTS,
  MIN_FAMILIES_FOR_CRITICAL, THRESHOLDS, WEIGHTS,
} from '../weights.ts';
import {
  behaviour, call, conversation, evidence, noConversation, notification, payee, payment,
} from './fixtures.ts';

const FULL_SCAM = {
  authority: 0.94, coercion: 0.91, urgency: 0.96,
  financialInstruction: 0.97, secrecy: 0.72, credentialRequest: 0.88,
};

describe('weight table invariants', () => {
  test('every weight is positive and the documented total holds', () => {
    for (const [code, w] of Object.entries(WEIGHTS)) {
      assert.ok(w > 0, `${code} must carry positive weight`);
    }
    // Deliberately > 100; the score is clamped. See the comment in weights.ts.
    assert.equal(MAX_ACHIEVABLE_POINTS, 117);
  });

  test('family maxima partition the weight table exactly', () => {
    const total = Object.values(FAMILY_MAX).reduce((a, b) => a + b, 0);
    assert.equal(total, MAX_ACHIEVABLE_POINTS);
  });

  test('thresholds are ordered', () => {
    assert.ok(THRESHOLDS.MEDIUM < THRESHOLDS.HIGH);
    assert.ok(THRESHOLDS.HIGH < THRESHOLDS.CRITICAL);
  });
});

describe('degradation: missing evidence is never treated as innocent or guilty', () => {
  test('no conversation evidence cannot produce CRITICAL', () => {
    const r = evaluateRisk(evidence({
      conversation: noConversation(),
      payee: payee({ known: false }),
      behaviour: behaviour({ amountAnomaly: 1, amountRatio: 40 }),
      call: call({ active: true, callerKnown: false, startedBeforePayment: true }),
      notification: notification({ suspicion: 1 }),
    }));
    assert.notEqual(r.level, 'CRITICAL');
    assert.equal(r.degraded, true);
    assert.ok(r.degradedReasons.some((x) => /could not hear|microphone/i.test(x)));
  });

  test('a low-reliability classifier window contributes nothing at all', () => {
    const unreliable = evaluateRisk(evidence({
      conversation: conversation(FULL_SCAM, { reliability: 0.2, transcriptChars: 11 }),
    }));
    const conversationPoints = unreliable.contributions
      .filter((c) => c.family === 'CONVERSATION')
      .reduce((a, c) => a + c.points, 0);
    assert.equal(conversationPoints, 0);
    assert.ok(unreliable.degradedReasons.some((x) => /confidently assess/i.test(x)));
  });

  test('reliability scales conversation points proportionally', () => {
    const full = evaluateRisk(evidence({ conversation: conversation(FULL_SCAM, { reliability: 1 }) }));
    const half = evaluateRisk(evidence({ conversation: conversation(FULL_SCAM, { reliability: 0.5 }) }));
    const sum = (r: ReturnType<typeof evaluateRisk>) =>
      r.contributions.filter((c) => c.family === 'CONVERSATION').reduce((a, c) => a + c.points, 0);
    assert.ok(Math.abs(sum(full) * 0.5 - sum(half)) < 0.01);
  });

  test('an unreadable payee is not scored as a new payee', () => {
    const r = evaluateRisk(evidence({
      payee: payee({ available: false, unavailableReason: 'could not read screen' }),
    }));
    const newPayee = r.contributions.find((c) => c.code === 'NEW_PAYEE');
    assert.equal(newPayee?.points, 0);
    assert.equal(r.degraded, true);
  });

  test('an immature behaviour profile withholds the amount anomaly entirely', () => {
    const r = evaluateRisk(evidence({
      behaviour: behaviour({ sampleSize: 2, profileMature: false, amountAnomaly: 1, amountRatio: 60 }),
    }));
    const anomaly = r.contributions.find((c) => c.code === 'AMOUNT_ANOMALY');
    assert.equal(anomaly?.points, 0);
    assert.equal(anomaly?.gate, 0);
    assert.ok(anomaly?.gateReason);
  });

  test('callerKnown === null is not scored as an unknown caller', () => {
    const r = evaluateRisk(evidence({ call: call({ active: true, callerKnown: null }) }));
    assert.equal(r.contributions.find((c) => c.code === 'UNKNOWN_CALLER')?.points, 0);
  });

  test('an entirely empty evidence object scores zero and does not throw', () => {
    const r = evaluateRisk(evidence({
      conversation: noConversation(),
      payment: payment({ available: false, active: false, amountMinor: null, payeeHash: null }),
      payee: payee({ available: false }),
      behaviour: behaviour({ available: false, profileMature: false }),
      call: call({ available: false }),
    }));
    assert.equal(r.score, 0);
    assert.equal(r.level, 'LOW');
    assert.equal(r.policyAction, 'NONE');
    assert.equal(r.degraded, true);
  });
});

describe('corroboration: one source can never block a payment', () => {
  test('a maximal conversation alone is held at HIGH, not CRITICAL', () => {
    const r = evaluateRisk(evidence({
      conversation: conversation({
        authority: 1, coercion: 1, urgency: 1,
        financialInstruction: 1, secrecy: 1, credentialRequest: 1,
      }),
      // Everything else says this is a completely ordinary payment.
      payee: payee({ known: true, previousTransactions: 30, userTrusted: true }),
      behaviour: behaviour({ amountAnomaly: 0, amountRatio: 0.4 }),
      call: call({ active: false }),
    }));
    assert.ok(r.score >= THRESHOLDS.CRITICAL, 'conversation alone should still score high');
    assert.equal(r.level, 'HIGH');
    assert.equal(r.corroboratingFamilies.length, 1);
    assert.equal(r.escalateToGuardian, false);
    assert.ok(r.degradedReasons.some((x) => /independent evidence source/i.test(x)));
  });

  test('a family only corroborates above the documented fraction of its maximum', () => {
    const r = evaluateRisk(evidence({
      conversation: conversation(FULL_SCAM),
      call: call({ active: true, callerKnown: false, startedBeforePayment: true }),
    }));
    for (const family of r.corroboratingFamilies) {
      const points = r.contributions
        .filter((c) => c.family === family)
        .reduce((a, c) => a + c.points, 0);
      assert.ok(points >= FAMILY_MAX[family] * CORROBORATION_FRACTION);
    }
    assert.ok(r.corroboratingFamilies.length >= MIN_FAMILIES_FOR_CRITICAL);
  });
});

describe('policy', () => {
  test('with no payment in progress, nothing louder than a subtle warning fires', () => {
    const r = evaluateRisk(evidence({
      conversation: conversation(FULL_SCAM),
      payment: payment({ active: false }),
      payee: payee({ known: false }),
      call: call({ active: true, callerKnown: false, startedBeforePayment: true }),
    }));
    assert.equal(r.policyAction, 'SUBTLE_WARNING');
    assert.equal(r.escalateToGuardian, false);
    assert.ok(r.degradedReasons.some((x) => /watching rather than intervening/i.test(x)));
  });

  test('guardian escalation happens only at CRITICAL with a live payment', () => {
    const r = evaluateRisk(evidence({
      conversation: conversation(FULL_SCAM),
      payee: payee({ known: false }),
      behaviour: behaviour({ amountAnomaly: 0.9, amountRatio: 8 }),
      call: call({ active: true, callerKnown: false, startedBeforePayment: true }),
    }));
    assert.equal(r.level, 'CRITICAL');
    assert.equal(r.escalateToGuardian, true);
  });
});

describe('false-positive defences', () => {
  test('a genuine bank call about a blocked card does not reach a blocking warning', () => {
    const r = evaluateRisk(evidence({
      // Real service calls DO claim authority and DO mention consequences.
      conversation: conversation({ authority: 0.88, coercion: 0.42, urgency: 0.3,
        financialInstruction: 0.1 }),
      payment: payment({ active: false }),
      payee: payee({ known: true, previousTransactions: 6 }),
      behaviour: behaviour({ amountAnomaly: 0 }),
      call: call({ active: true, callerKnown: false, startedBeforePayment: true }),
    }));
    assert.ok(['LOW', 'MEDIUM', 'HIGH'].includes(r.level));
    assert.notEqual(r.policyAction, 'BLOCK_WARNING');
  });

  test('an urgent request from an established friend stays calm', () => {
    const r = evaluateRisk(evidence({
      conversation: conversation({ urgency: 0.9, financialInstruction: 0.9 }),
      payment: payment({ amountMinor: 500_00 }),
      payee: payee({ known: true, previousTransactions: 22 }),
      behaviour: behaviour({ amountAnomaly: 0, amountRatio: 0.3 }),
      call: call({ active: false }),
    }));
    assert.ok(r.score < THRESHOLDS.HIGH, `expected below HIGH, got ${r.score}`);
    assert.equal(r.escalateToGuardian, false);
  });

  test('a trusted payee removes the new-payee term and damps the amount anomaly', () => {
    const stranger = evaluateRisk(evidence({
      payee: payee({ known: false }),
      behaviour: behaviour({ amountAnomaly: 0.9, amountRatio: 8 }),
    }));
    const trusted = evaluateRisk(evidence({
      payee: payee({ known: true, previousTransactions: 20, userTrusted: true }),
      behaviour: behaviour({ amountAnomaly: 0.9, amountRatio: 8 }),
    }));
    assert.ok(trusted.score < stranger.score);
    assert.equal(trusted.contributions.find((c) => c.code === 'NEW_PAYEE')?.points, 0);
    assert.ok((trusted.contributions.find((c) => c.code === 'AMOUNT_ANOMALY')?.gate ?? 1) < 1);
  });
});

describe('auditability and determinism', () => {
  test('the same evidence always produces the same score', () => {
    const e = evidence({ conversation: conversation(FULL_SCAM), payee: payee({ known: false }) });
    const runs = Array.from({ length: 25 }, () => evaluateRisk(e));
    assert.equal(new Set(runs.map((r) => r.score)).size, 1);
    assert.equal(new Set(runs.map((r) => r.level)).size, 1);
  });

  test('every weighted term appears in contributions, including zero ones', () => {
    const r = evaluateRisk(evidence());
    assert.equal(r.contributions.length, Object.keys(WEIGHTS).length);
    for (const code of Object.keys(WEIGHTS)) {
      assert.ok(r.contributions.some((c) => c.code === code), `${code} missing`);
    }
  });

  test('the result carries a complete version stamp', () => {
    const r = evaluateRisk(evidence());
    for (const field of ['weightsVersion', 'policyVersion', 'engineVersion', 'modelVersion'] as const) {
      assert.ok(r[field] && r[field].length > 0, `${field} must be recorded`);
    }
    assert.equal(r.sessionId, 'test-session');
  });

  test('score is always an integer in [0, 100] even with absurd inputs', () => {
    for (const bad of [-5, 0, 0.5, 1, 99, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = evaluateRisk(evidence({
        conversation: conversation({
          authority: bad, coercion: bad, urgency: bad,
          financialInstruction: bad, secrecy: bad, credentialRequest: bad,
        }),
        behaviour: behaviour({ amountAnomaly: bad }),
        notification: notification({ suspicion: bad }),
      }));
      assert.ok(Number.isInteger(r.score), `score not an integer for input ${bad}`);
      assert.ok(r.score >= 0 && r.score <= 100, `score ${r.score} out of range for ${bad}`);
    }
  });

  test('config is exposed for the engineering screen', () => {
    const cfg = getRiskEngineConfig();
    assert.equal(cfg.weightsVersion, 'ruko-weights-v1');
    assert.deepEqual(cfg.thresholds, THRESHOLDS);
  });
});
