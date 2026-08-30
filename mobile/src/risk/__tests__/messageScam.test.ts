/**
 * A scam run entirely over messages must still be able to interrupt.
 *
 * This case was silently unreachable on the device. The manipulation model was
 * only ever fed ASR output, so with no call in progress the conversation family
 * contributed nothing at all, and the notification family's 3-point ceiling was
 * the only trace a textbook KYC scam left on the score. A payment being set up
 * by threatening messages came out at 10/100 SAFE and Ruko stayed quiet.
 *
 * These pin the two halves of the fix: the evidence can now arrive from message
 * text, and when it does, Ruko says it *read* it rather than claiming to have
 * heard a caller who does not exist.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateRisk } from '../riskEngine.ts';
import { conversation, evidence, notification, payee, payment } from './fixtures.ts';

/**
 * The scores the on-device model actually returned for PayNow's KYC script,
 * read off the Engineering screen on the iQOO. Not illustrative numbers.
 */
const KYC_MESSAGE_SCORES = {
  authority: 0.81,
  coercion: 0.96,
  urgency: 0.42,
  financialInstruction: 0.02,
  secrecy: 0.06,
  credentialRequest: 0.92,
};

function messageScam(textSource: 'MESSAGES' | 'SPEECH' = 'MESSAGES') {
  return evidence({
    conversation: conversation(KYC_MESSAGE_SCORES, {
      textSource,
      // The reliability the classifier itself reported for this text on the
      // device. Left at what was measured rather than discounted by hand:
      // this is the run that scored 66 and raised the overlay.
      reliability: 1,
      // Nothing was spoken, so claiming milliseconds of speech would be a
      // fabrication. The engine must cope with a zero-length window.
      windowMs: textSource === 'MESSAGES' ? 0 : 8000,
      transcriptChars: 240,
    }),
    payment: payment({
      source: 'ACCESSIBILITY',
      amountMinor: 500_00,
      payeeDisplayName: 'KYC Verification Desk',
      payeeHash: 'payee-kyc',
    }),
    payee: payee({ known: false, previousTransactions: 0 }),
    notification: notification({ suspicion: 0.55, count: 4, windowMs: 30 * 60_000 }),
  });
}

describe('a scam conducted over messages', () => {
  test('reaches a level that interrupts the payment', () => {
    const result = evaluateRisk(messageScam());

    // The exact figure is the engine's business. What must hold is that this is
    // no longer a shrug: on the device, this same scam scored 10.
    assert.ok(
      result.score >= 60,
      `expected an interrupting score, got ${result.score} (${result.level})`,
    );
    assert.ok(['HIGH', 'CRITICAL'].includes(result.level), `level was ${result.level}`);
    assert.ok(
      ['STRONG_WARNING', 'BLOCK_WARNING'].includes(result.policyAction),
      `policy action was ${result.policyAction}`,
    );
  });

  test('does not claim the user was on a call', () => {
    const labels = evaluateRisk(messageScam()).reasons.map(r => r.label);

    assert.equal(
      labels.some(l => /caller|this call|speaking to/i.test(l)),
      false,
      `a reason still spoke of a caller: ${JSON.stringify(labels)}`,
    );
    assert.ok(
      labels.some(l => /messages/i.test(l)),
      `no reason mentioned messages: ${JSON.stringify(labels)}`,
    );
  });

  test('still says "caller" when the evidence really did come from speech', () => {
    const labels = evaluateRisk(messageScam('SPEECH')).reasons.map(r => r.label);

    assert.ok(
      labels.some(l => /caller/i.test(l)),
      `speech evidence lost its wording: ${JSON.stringify(labels)}`,
    );
  });
});
