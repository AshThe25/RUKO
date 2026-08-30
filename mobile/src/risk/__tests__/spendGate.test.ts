/**
 * The spend gate: amount alone, independent of the score.
 *
 * These exist because the gate's whole purpose is to fire where the scoring
 * correctly finds nothing. A ₹7,878 game top-up with no caller, no messages
 * and no speech scores SAFE, and should -- nothing about it is deceptive. The
 * gate is what stops it anyway.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {decidePolicy, DEFAULT_APPROVAL_THRESHOLD_MINOR} from '../policy.ts';
import type {RiskEvidence} from '@contracts';

function evidenceFor(amountMinor: number): RiskEvidence {
  return {
    sessionId: 's1',
    timestamp: Date.now(),
    payment: {
      available: true,
      active: true,
      source: 'ACCESSIBILITY',
      amountMinor,
      currency: 'INR',
      payeeDisplayName: 'Diamond Store (Free Fire)',
      payeeHash: 'h',
      timestamp: Date.now(),
    },
  } as unknown as RiskEvidence;
}

test('a payment at the limit needs a guardian even when the score is LOW', () => {
  const decision = decidePolicy('LOW', evidenceFor(DEFAULT_APPROVAL_THRESHOLD_MINOR));

  assert.equal(decision.requiresGuardianApproval, true);
  assert.equal(decision.action, 'BLOCK_WARNING');
  assert.equal(decision.escalateToGuardian, true);
});

test('the ₹7,878 game top-up that scored SAFE is still stopped', () => {
  const decision = decidePolicy('LOW', evidenceFor(7_878_00));

  assert.equal(decision.requiresGuardianApproval, true);
  assert.ok(
    decision.notes.some((n) => n.includes('₹7,878')),
    `the note should name the amount, got: ${decision.notes.join(' | ')}`,
  );
});

test('₹499 is left completely alone', () => {
  const decision = decidePolicy('LOW', evidenceFor(49_900));

  assert.equal(decision.requiresGuardianApproval, false);
  assert.equal(decision.action, 'NONE');
  assert.equal(decision.escalateToGuardian, false);
});

test('a guardian can raise the limit, and ordinary spending stays unimpeded', () => {
  const raised = decidePolicy('LOW', evidenceFor(150_000), 200_000);

  assert.equal(raised.requiresGuardianApproval, false);
});

test('the gate does not fire when no payment is actually pending', () => {
  const noPayment = {sessionId: 's', timestamp: Date.now(), payment: {available: false}} as unknown as RiskEvidence;

  assert.equal(decidePolicy('LOW', noPayment).requiresGuardianApproval, false);
});
