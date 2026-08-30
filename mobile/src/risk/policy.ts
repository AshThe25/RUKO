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
  /**
   * The payment crossed the guardian's spend limit, so it must not proceed on
   * the user's own say-so. Distinct from `escalateToGuardian`, which is also
   * true for a critical score the user may still override.
   */
  requiresGuardianApproval: boolean;
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

/**
 * Payments at or above this need a guardian's approval, whatever the score.
 *
 * A guardian can raise or lower it; this is the default. It is expressed in
 * paise, like every other amount in the system.
 */
export const DEFAULT_APPROVAL_THRESHOLD_MINOR = 50_000; // ₹500

export function decidePolicy(
  level: RiskLevel,
  evidence: RiskEvidence,
  /** The guardian's limit, in paise. Falls back to the default. */
  approvalThresholdMinor: number = DEFAULT_APPROVAL_THRESHOLD_MINOR,
): PolicyDecision {
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

  /**
   * The spend gate: size alone is enough.
   *
   * Scoring answers "does this look like manipulation", and it answered that
   * honestly for a ₹7,878 game top-up: no caller, no messages, no speech, a
   * first-time payee and no spending history to compare against. Ten out of a
   * hundred. SAFE.
   *
   * That verdict is correct about manipulation and useless to the parent whose
   * child just spent ₹7,878 on Free Fire diamonds. The harm there is not
   * deception, it is amount, and no amount of evidence-weighing will produce a
   * high score for a payment where nothing suspicious was said.
   *
   * So the limit is a gate, not a signal: it does not add points and cannot be
   * outvoted by an otherwise clean assessment. Under the limit, ordinary
   * spending stays completely unimpeded. At or above it, the payment stops and
   * waits for someone the user trusts.
   */
  const amountMinor = evidence.payment?.amountMinor ?? null;
  const overLimit =
    paymentPending && amountMinor !== null && amountMinor >= approvalThresholdMinor;

  if (overLimit) {
    action = raise(action, 'BLOCK_WARNING');
    notes.push(
      `This payment is ${formatMinor(amountMinor)}, at or above the ` +
        `${formatMinor(approvalThresholdMinor)} limit your trusted contact set, ` +
        'so it needs their approval before it can go ahead.',
    );
  }

  return {
    action,
    // Either the phone judged this critical, or it crossed the limit. Both
    // mean a person other than the one being pressured has to agree.
    escalateToGuardian: (level === 'CRITICAL' || overLimit) && paymentPending,
    requiresGuardianApproval: overLimit,
    notes,
  };
}

/** Raise an action to at least `floor`. The mirror of `cap`. */
function raise(action: PolicyAction, floor: PolicyAction): PolicyAction {
  return SEVERITY.indexOf(action) >= SEVERITY.indexOf(floor) ? action : floor;
}

/** Whole rupees, grouped the Indian way. Never routed through a float. */
function formatMinor(minor: number): string {
  const rupees = Math.round(minor / 100);
  const text = String(rupees);
  if (text.length <= 3) return `₹${text}`;
  const last3 = text.slice(-3);
  const rest = text.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `₹${rest},${last3}`;
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
