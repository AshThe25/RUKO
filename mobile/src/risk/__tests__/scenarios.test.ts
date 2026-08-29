/**
 * THE DEFINITION-OF-DONE SCENARIOS.
 *
 * These three come straight from the master build prompt. If any of them ever
 * goes red, Ruko is broken regardless of what any metric says — the second one
 * is the product working, and the first and third are the product not crying
 * wolf. Do not adjust a threshold to make one of these pass without
 * understanding which of the other two it breaks.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateRisk } from '../riskEngine.ts';
import {
  behaviour, call, conversation, evidence, notification, payee, payment, NOW,
} from './fixtures.ts';

describe('Definition of Done', () => {
  test('1. SAFE: "send me 500 for dinner" to a known friend is LOW', () => {
    const result = evaluateRisk(evidence({
      // A real classifier does fire financialInstruction here -- it IS a request
      // to send money. The engine must stay calm anyway, on context alone.
      conversation: conversation({ financialInstruction: 0.82, urgency: 0.15 }),
      payment: payment({ amountMinor: 500_00, payeeDisplayName: 'Arjun' }),
      payee: payee({ known: true, previousTransactions: 14, averageAmountMinor: 60_000 }),
      behaviour: behaviour({ amountRatio: 0.25, amountAnomaly: 0 }),
      call: call({ active: false }),
    }));

    assert.equal(result.level, 'LOW', `expected LOW, got ${result.level} at ${result.score}`);
    assert.equal(result.policyAction, 'NONE');
    assert.equal(result.escalateToGuardian, false);
  });

  test('2. SCAM: bank-freeze coercion, unknown caller, new payee is CRITICAL', () => {
    const result = evaluateRisk(evidence({
      conversation: conversation({
        authority: 0.94, coercion: 0.91, urgency: 0.96,
        financialInstruction: 0.97, secrecy: 0.72,
      }),
      payment: payment({ amountMinor: 48_000_00, payeeDisplayName: 'Ravi Verify' }),
      payee: payee({ known: false, previousTransactions: 0 }),
      behaviour: behaviour({ amountRatio: 4.2, amountAnomaly: 0.543 }),
      call: call({ active: true, callerKnown: false, direction: 'INCOMING',
        startedBeforePayment: true, durationMs: 420_000 }),
      notification: notification({ suspicion: 0.61, count: 2,
        matchedCategories: ['ACCOUNT_FREEZE'] }),
    }));

    assert.equal(result.level, 'CRITICAL', `expected CRITICAL, got ${result.level} at ${result.score}`);
    assert.equal(result.policyAction, 'BLOCK_WARNING');
    assert.equal(result.escalateToGuardian, true);
    assert.ok(result.corroboratingFamilies.length >= 2,
      `needs >= 2 corroborating families, got ${result.corroboratingFamilies.join(',')}`);
    // The user must be able to read WHY, in plain language.
    assert.ok(result.reasons.length >= 4, 'a critical warning must list its reasons');
    assert.equal(result.reasons[0].code, 'COERCION');
  });

  test('3. LARGE BUT LEGITIMATE: 50,000 rent to a known landlord is NOT critical', () => {
    const result = evaluateRisk(evidence({
      conversation: conversation({ financialInstruction: 0.55 }),
      payment: payment({ amountMinor: 50_000_00, payeeDisplayName: 'Landlord' }),
      payee: payee({ known: true, previousTransactions: 17, userTrusted: true,
        averageAmountMinor: 50_000_00, ageDays: 510 }),
      // Same 4.2x anomaly as the scam. Only the context differs.
      behaviour: behaviour({ amountRatio: 4.2, amountAnomaly: 0.543 }),
      call: call({ active: false }),
    }));

    assert.notEqual(result.level, 'CRITICAL');
    assert.equal(result.escalateToGuardian, false);
    assert.ok(result.score < 30,
      `a routine rent payment should be LOW, got ${result.score}`);
  });

  test('scenarios 2 and 3 share an identical amount anomaly — only context separates them', () => {
    const shared = { amountRatio: 4.2, amountAnomaly: 0.543 };
    const scam = evaluateRisk(evidence({
      conversation: conversation({ authority: 0.94, coercion: 0.91, urgency: 0.96,
        financialInstruction: 0.97, secrecy: 0.72 }),
      payment: payment({ amountMinor: 48_000_00 }),
      behaviour: behaviour(shared),
      call: call({ active: true, callerKnown: false, startedBeforePayment: true }),
    }));
    const rent = evaluateRisk(evidence({
      conversation: conversation({ financialInstruction: 0.55 }),
      payment: payment({ amountMinor: 50_000_00 }),
      payee: payee({ known: true, previousTransactions: 17, userTrusted: true }),
      behaviour: behaviour(shared),
      call: call({ active: false }),
    }));
    assert.ok(scam.score - rent.score > 55,
      `context alone must separate these clearly; got ${scam.score} vs ${rent.score}`);
  });
});
