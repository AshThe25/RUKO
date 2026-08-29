/**
 * Ruko risk weights and thresholds — `ruko-weights-v1`.
 *
 * OWNER: Vedant. Changing a number here changes every risk decision the product
 * makes, so the version string must be bumped with it and the scenario tests in
 * `__tests__/scenarios.test.ts` must still pass.
 *
 * ------------------------------------------------------------------------
 * WHY THE TABLE DOES NOT SUM TO 100
 * ------------------------------------------------------------------------
 * The master spec sketches weights that sum to exactly 100. We deliberately do
 * not do that. If the table is forced to partition 100 across thirteen signals,
 * every individual signal becomes too weak to matter: a call that is pure
 * coercion plus a payment instruction to a brand-new payee would land in the
 * fifties and the user would get a shrug instead of a warning.
 *
 * Instead each weight is the *maximum points that signal can contribute on its
 * own*, the total is 117, and the final score is clamped to 100. A payment that
 * trips literally every signal in every family is a 100. This is documented
 * rather than hidden, and MAX_ACHIEVABLE_POINTS is asserted in the tests.
 *
 * ------------------------------------------------------------------------
 * WHY credentialRequest EXISTS AT ALL
 * ------------------------------------------------------------------------
 * The master spec's weight list omits it. Asking for an OTP or a UPI PIN is one
 * of the strongest single indicators in Indian payment fraud, and leaving it out
 * would make Ruko blind to the most common attack. It is added at weight 14 and
 * flagged here as a deliberate, documented deviation.
 */

import type { EvidenceFamily, RiskLevel, RiskReasonCode } from '../contracts/index.ts';

export const WEIGHTS_VERSION = 'ruko-weights-v1';

export const WEIGHTS: Record<RiskReasonCode, number> = {
  // --- CONVERSATION family (max 85) ---
  // Coercion is the heaviest single signal: a threat of loss is what actually
  // overrides a person's judgement. It is the difference between a pushy sales
  // call and a scam.
  COERCION: 24,
  // An authority *claim* (see conversation.schema.ts). Heavy, but deliberately
  // below coercion, because genuine bank and hospital calls also claim
  // authority and must never be flagged on that alone.
  AUTHORITY_IMPERSONATION: 16,
  CREDENTIAL_REQUEST: 14,
  FINANCIAL_INSTRUCTION: 14,
  // Urgency appears constantly in perfectly ordinary requests ("send it fast,
  // I'm at the counter"), so it is worth much less than it intuitively feels.
  URGENCY: 11,
  SECRECY: 6,

  // --- PAYEE_BEHAVIOUR family (max 21) ---
  NEW_PAYEE: 10,
  AMOUNT_ANOMALY: 9,
  FREQUENCY_ANOMALY: 1,
  TIME_ANOMALY: 1,

  // --- CALL_CONTEXT family (max 8) ---
  // A call already running when the payment screen opened is the signature of
  // remote-controlled fraud. Small alone; decisive in combination.
  CALL_DURING_PAYMENT: 5,
  UNKNOWN_CALLER: 3,

  // --- NOTIFICATION family (max 3) ---
  // Never enough to matter on its own. That is the point.
  SUSPICIOUS_NOTIFICATION: 3,
};

export const REASON_FAMILY: Record<RiskReasonCode, EvidenceFamily> = {
  COERCION: 'CONVERSATION',
  AUTHORITY_IMPERSONATION: 'CONVERSATION',
  CREDENTIAL_REQUEST: 'CONVERSATION',
  FINANCIAL_INSTRUCTION: 'CONVERSATION',
  URGENCY: 'CONVERSATION',
  SECRECY: 'CONVERSATION',
  NEW_PAYEE: 'PAYEE_BEHAVIOUR',
  AMOUNT_ANOMALY: 'PAYEE_BEHAVIOUR',
  FREQUENCY_ANOMALY: 'PAYEE_BEHAVIOUR',
  TIME_ANOMALY: 'PAYEE_BEHAVIOUR',
  CALL_DURING_PAYMENT: 'CALL_CONTEXT',
  UNKNOWN_CALLER: 'CALL_CONTEXT',
  SUSPICIOUS_NOTIFICATION: 'NOTIFICATION',
};

/** Sum of every weight. The score is clamped to 100, so this is > 100 by design. */
export const MAX_ACHIEVABLE_POINTS: number =
  Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

/** Maximum points each family can contribute. Used by the corroboration rule. */
export const FAMILY_MAX: Record<EvidenceFamily, number> = (() => {
  const out: Record<EvidenceFamily, number> = {
    CONVERSATION: 0,
    PAYEE_BEHAVIOUR: 0,
    CALL_CONTEXT: 0,
    NOTIFICATION: 0,
  };
  for (const code of Object.keys(WEIGHTS) as RiskReasonCode[]) {
    out[REASON_FAMILY[code]] += WEIGHTS[code];
  }
  return out;
})();

/** Lower bound of each level. Anything below MEDIUM is LOW. */
export const THRESHOLDS: Record<Exclude<RiskLevel, 'LOW'>, number> = {
  MEDIUM: 30,
  HIGH: 60,
  CRITICAL: 80,
};

/**
 * A family counts as corroborating when it contributes at least this fraction of
 * what it could possibly contribute. One rule for every family, so it cannot be
 * quietly tuned per-family to make a demo land where we want it to.
 */
export const CORROBORATION_FRACTION = 0.35;

/**
 * CRITICAL — the only level that puts "DON'T PAY" in front of the user — needs
 * this many independent evidence families. A single family, however confident,
 * can never block a payment. This is the main defence against a model false
 * positive costing someone a legitimate rent transfer.
 */
export const MIN_FAMILIES_FOR_CRITICAL = 2;

/** Below this classifier reliability, conversation evidence is not trusted. */
export const MIN_CONVERSATION_RELIABILITY = 0.35;

/**
 * A payee is "established" after this many prior payments. Established payees
 * damp the amount-anomaly term: a large transfer to someone paid many times
 * before is ordinary life (rent, fees, family), not an attack.
 */
export const ESTABLISHED_PAYEE_MIN_TXNS = 3;
export const ESTABLISHED_PAYEE_ANOMALY_GATE = 0.4;

/** Transactions needed before the behaviour profile may claim anything at all. */
export const MIN_PROFILE_SAMPLE = 8;

/** Amount-anomaly curve bounds. See anomaly.ts for the derivation. */
export const ANOMALY_RATIO_FLOOR = 1.5; // below 1.5x p95: not anomalous
export const ANOMALY_RATIO_CEILING = 10; // 10x p95 and above: fully anomalous
