/**
 * Safety policy — `ruko-policy-v1`.
 *
 * The risk engine says how risky. The policy says what Ruko is allowed to *do*
 * about it. They are separate on purpose: the policy can be made more or less
 * cautious for a demo, a pilot or a specific user without touching the scoring,
 * and the audit trail records both versions.
 *
 * Non-negotiable rules:
 *   1. Ruko never blocks money silently. Every action above NONE is visible and
 *      explained, and the user can always override with a deliberate action.
 *   2. Ruko never shames the user. The copy is "you may be under pressure",
 *      never "you are being careless".
 *   3. Nothing is escalated to a guardian below CRITICAL, and never without a
 *      real payment in progress.
 */

import type { PolicyAction, RiskEvidence, RiskLevel } from '../contracts/index.ts';

export const POLICY_VERSION = 'ruko-policy-v1';

export interface PolicyDecision {
  action: PolicyAction;
  escalateToGuardian: boolean;
  /** Anything the user should be told about how this decision was limited. */
  notes: string[];
}

const BASE_ACTION: Record<RiskLevel, PolicyAction> = {
  LOW: 'NONE',
  MEDIUM: 'SUBTLE_WARNING',
  HIGH: 'STRONG_WARNING',
  CRITICAL: 'BLOCK_WARNING',
};

const SEVERITY: PolicyAction[] = ['NONE', 'SUBTLE_WARNING', 'STRONG_WARNING', 'BLOCK_WARNING'];

const cap = (action: PolicyAction, ceiling: PolicyAction): PolicyAction =>
  SEVERITY.indexOf(action) > SEVERITY.indexOf(ceiling) ? ceiling : action;

export function decidePolicy(level: RiskLevel, evidence: RiskEvidence): PolicyDecision {
  const notes: string[] = [];
  let action = BASE_ACTION[level];

  const paymentPending = evidence.payment?.available === true && evidence.payment.active;

  // Nothing to intervene in. Ruko is monitoring, not blocking, so the loudest
  // thing it may do is a passive notice. Interrupting a user full-screen over a
  // conversation they have not acted on is exactly the behaviour that gets a
  // safety app uninstalled.
  if (!paymentPending) {
    action = cap(action, 'SUBTLE_WARNING');
    if (level === 'HIGH' || level === 'CRITICAL') {
      notes.push('No payment is in progress, so Ruko is watching rather than intervening');
    }
  }

  return {
    action,
    escalateToGuardian: level === 'CRITICAL' && paymentPending,
    notes,
  };
}

/** Copy for the intervention screen. Kept beside the policy so tone stays consistent. */
export const INTERVENTION_COPY: Record<PolicyAction, { title: string; body: string } | null> = {
  NONE: null,
  SUBTLE_WARNING: {
    title: 'Something looks unusual',
    body: 'Take a moment before you continue.',
  },
  STRONG_WARNING: {
    title: 'Wait a moment',
    body: 'A few things about this payment do not match how you normally pay. ' +
      'It is worth a second look before you continue.',
  },
  BLOCK_WARNING: {
    title: 'Stop for a moment',
    body: 'You may be being manipulated into making this payment. ' +
      'Nobody from a bank, the police or any government office will ever ask ' +
      'you to transfer money to keep it safe.',
  },
};
