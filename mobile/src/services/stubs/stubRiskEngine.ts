/**
 * STUB — the master spec's weight table (§20) implemented deterministically.
 *
 * This is not a competing design. It is the reference table, wired up, so the
 * mobile UI renders numbers it actually computed instead of numbers someone
 * typed in. It is deleted the moment `mobile/src/risk/` lands from the ML
 * workstream — `createServices.ts` is the only file that has to change.
 *
 * Properties this must keep, because the UI depends on them:
 *   - deterministic: same evidence in, same score out, always
 *   - explainable: every point is attributable to a named contribution
 *   - honest under missing evidence: unavailable is not zero
 *   - corroborated: CRITICAL needs at least two independent evidence families
 */
import {
  clamp01,
  isAvailable,
  type EvidenceFamily,
  type PolicyAction,
  type RiskContribution,
  type RiskEngine,
  type RiskEngineConfig,
  type RiskEvidence,
  type RiskLevel,
  type RiskReason,
  type RiskReasonCode,
  type RiskResult,
} from '@contracts';

export const STUB_ENGINE_VERSION = 'stub-engine-v1';
export const STUB_WEIGHTS_VERSION = 'weights-v1-spec20';
export const STUB_POLICY_VERSION = 'policy-v1';

const WEIGHTS: Record<RiskReasonCode, number> = {
  COERCION: 25,
  AUTHORITY_IMPERSONATION: 20,
  FINANCIAL_INSTRUCTION: 15,
  URGENCY: 10,
  NEW_PAYEE: 10,
  AMOUNT_ANOMALY: 10,
  UNKNOWN_CALLER: 5,
  SECRECY: 5,
  // Scored and shown, but not yet calibrated — weight 0 until the ML
  // workstream has numbers to justify one. Better a visible zero than an
  // invented weight.
  CREDENTIAL_REQUEST: 0,
  FREQUENCY_ANOMALY: 0,
  TIME_ANOMALY: 0,
  CALL_DURING_PAYMENT: 0,
  SUSPICIOUS_NOTIFICATION: 4,
};

const THRESHOLDS = {MEDIUM: 30, HIGH: 60, CRITICAL: 80} as const;

const FAMILY: Record<RiskReasonCode, EvidenceFamily> = {
  COERCION: 'CONVERSATION',
  AUTHORITY_IMPERSONATION: 'CONVERSATION',
  FINANCIAL_INSTRUCTION: 'CONVERSATION',
  URGENCY: 'CONVERSATION',
  SECRECY: 'CONVERSATION',
  CREDENTIAL_REQUEST: 'CONVERSATION',
  NEW_PAYEE: 'PAYEE_BEHAVIOUR',
  AMOUNT_ANOMALY: 'PAYEE_BEHAVIOUR',
  FREQUENCY_ANOMALY: 'PAYEE_BEHAVIOUR',
  TIME_ANOMALY: 'PAYEE_BEHAVIOUR',
  UNKNOWN_CALLER: 'CALL_CONTEXT',
  CALL_DURING_PAYMENT: 'CALL_CONTEXT',
  SUSPICIOUS_NOTIFICATION: 'NOTIFICATION',
};

/** User-facing copy. Describes the caller's behaviour, never the user's. */
const LABELS: Record<RiskReasonCode, string> = {
  COERCION: 'The caller is pressuring or threatening you',
  AUTHORITY_IMPERSONATION: 'The caller is claiming to be an authority',
  FINANCIAL_INSTRUCTION: 'The caller is instructing you to move money',
  URGENCY: 'The caller is creating urgency',
  SECRECY: 'The caller asked you to keep this to yourself',
  CREDENTIAL_REQUEST: 'The caller asked for a code, PIN or card detail',
  NEW_PAYEE: 'You have never paid this recipient',
  AMOUNT_ANOMALY: 'This payment is much larger than your usual',
  FREQUENCY_ANOMALY: 'You are paying more often than usual',
  TIME_ANOMALY: 'This is an unusual time for you to pay',
  UNKNOWN_CALLER: 'You are on a call with a number you do not know',
  CALL_DURING_PAYMENT: 'This payment is happening during a call',
  SUSPICIOUS_NOTIFICATION: 'Recent messages use the same pressure tactics',
};

/**
 * Conversation evidence is trusted in proportion to its own reliability. Below
 * this the engine down-weights it rather than guessing, and says it did.
 */
const RELIABILITY_FLOOR = 0.6;

export function evaluate(evidence: RiskEvidence): RiskResult {
  const startedAt = Date.now();
  const contributions: RiskContribution[] = [];
  const degradedReasons: string[] = [];

  const conv = evidence.conversation;
  // Read before the type guard narrows `conv` to its available form.
  const conversationUnavailableReason = conv?.unavailableReason;
  const conversationAvailable = isAvailable(conv);
  const conversationGate = conversationAvailable
    ? clamp01(conv.reliability / RELIABILITY_FLOOR)
    : 0;

  if (!conversationAvailable) {
    degradedReasons.push(
      conversationUnavailableReason ?? 'No conversation evidence was available.',
    );
  } else if (conversationGate < 1) {
    degradedReasons.push(
      `Ruko could not confidently assess this conversation (reliability ${conv.reliability.toFixed(2)}).`,
    );
  }

  const push = (
    code: RiskReasonCode,
    signal: number,
    gate: number,
    gateReason?: string,
  ) => {
    const weight = WEIGHTS[code];
    const points = clamp01(signal) * weight * clamp01(gate);
    contributions.push({
      code,
      family: FAMILY[code],
      signal: Number(clamp01(signal).toFixed(4)),
      weight,
      gate: Number(clamp01(gate).toFixed(3)),
      points: Number(points.toFixed(2)),
      ...(gateReason && gate < 1 ? {gateReason} : {}),
    });
  };

  // --- conversation family ---------------------------------------------
  const s = conv?.scores;
  push('COERCION', s?.coercion ?? 0, conversationGate, 'conversation reliability');
  push('AUTHORITY_IMPERSONATION', s?.authority ?? 0, conversationGate, 'conversation reliability');
  push('FINANCIAL_INSTRUCTION', s?.financialInstruction ?? 0, conversationGate, 'conversation reliability');
  push('URGENCY', s?.urgency ?? 0, conversationGate, 'conversation reliability');
  push('SECRECY', s?.secrecy ?? 0, conversationGate, 'conversation reliability');
  push('CREDENTIAL_REQUEST', s?.credentialRequest ?? 0, conversationGate, 'conversation reliability');

  // --- payee / behaviour family -----------------------------------------
  const payee = evidence.payee;
  if (isAvailable(payee)) {
    // A payee the user has explicitly trusted (landlord, family) is not new,
    // however large the payment. This is the single most important false
    // positive guard in the product.
    const isNew = !payee.known && !payee.userTrusted;
    push('NEW_PAYEE', isNew ? 1 : 0, 1);
  } else {
    push('NEW_PAYEE', 0, 0, 'no payee history available');
    degradedReasons.push('Recipient history was not available.');
  }

  const behaviour = evidence.behaviour;
  if (isAvailable(behaviour)) {
    // A cold-start profile cannot tell us anything about "unusual".
    const matureGate = behaviour.profileMature ? 1 : 0;
    if (!behaviour.profileMature) {
      degradedReasons.push(
        `Not enough payment history yet to judge the amount (${behaviour.sampleSize} payments).`,
      );
    }
    const trustedGate = isAvailable(payee) && payee.userTrusted ? 0.25 : 1;
    push(
      'AMOUNT_ANOMALY',
      behaviour.amountAnomaly,
      matureGate * trustedGate,
      trustedGate < 1 ? 'recipient marked trusted' : 'profile not mature',
    );
    push('FREQUENCY_ANOMALY', behaviour.frequencyAnomaly, matureGate);
    push('TIME_ANOMALY', behaviour.timeAnomaly, matureGate);
  } else {
    push('AMOUNT_ANOMALY', 0, 0, 'no behaviour profile available');
    push('FREQUENCY_ANOMALY', 0, 0, 'no behaviour profile available');
    push('TIME_ANOMALY', 0, 0, 'no behaviour profile available');
  }

  // --- call context family ----------------------------------------------
  const call = evidence.call;
  if (isAvailable(call)) {
    const unknownCaller = call.active && call.callerKnown === false;
    push('UNKNOWN_CALLER', unknownCaller ? 1 : 0, 1);
    push('CALL_DURING_PAYMENT', call.active && evidence.payment.active ? 1 : 0, 1);
  } else {
    push('UNKNOWN_CALLER', 0, 0, 'call state unavailable');
    push('CALL_DURING_PAYMENT', 0, 0, 'call state unavailable');
  }

  // --- notification family ----------------------------------------------
  // A suspicious notification is never an accusation on its own (spec §14).
  // It only counts once the conversation has already raised something.
  const conversationRaised =
    conversationAvailable &&
    Math.max(s!.coercion, s!.authority, s!.financialInstruction) >= 0.5;
  const notification = evidence.notification;
  if (isAvailable(notification)) {
    push(
      'SUSPICIOUS_NOTIFICATION',
      notification.suspicion,
      conversationRaised && evidence.payment.active ? 1 : 0,
      'needs corroborating conversation evidence',
    );
  } else {
    push('SUSPICIOUS_NOTIFICATION', 0, 0, 'no notification access');
  }

  // --- score, corroboration, level --------------------------------------
  const rawScore = contributions.reduce((sum, c) => sum + c.points, 0);
  const score = Math.round(Math.max(0, Math.min(100, rawScore)));

  const corroboratingFamilies = Array.from(
    new Set(contributions.filter(c => c.points > 0.5).map(c => c.family)),
  ) as EvidenceFamily[];

  let level = levelFor(score);

  // CRITICAL is the level that stops a payment. It requires more than one
  // independent family agreeing — a single noisy source must never be enough.
  if (level === 'CRITICAL' && corroboratingFamilies.length < 2) {
    level = 'HIGH';
    degradedReasons.push(
      'Only one kind of evidence supported this — held below critical.',
    );
  }

  const degraded = degradedReasons.length > 0;
  const policyAction = actionFor(level);

  const reasons: RiskReason[] = contributions
    .filter(c => c.points >= 1)
    .sort((a, b) => b.points - a.points)
    .map(c => ({
      code: c.code,
      label: LABELS[c.code],
      points: Number(c.points.toFixed(1)),
      family: c.family,
    }));

  return {
    sessionId: evidence.sessionId,
    score,
    level,
    policyAction,
    reasons,
    contributions,
    corroboratingFamilies,
    degraded,
    degradedReasons,
    escalateToGuardian: level === 'CRITICAL',
    modelVersion: conv?.modelVersion ?? 'none',
    weightsVersion: STUB_WEIGHTS_VERSION,
    policyVersion: STUB_POLICY_VERSION,
    engineVersion: STUB_ENGINE_VERSION,
    timestamp: Date.now(),
    computeMs: Date.now() - startedAt,
  };
}

export function levelFor(score: number): RiskLevel {
  if (score >= THRESHOLDS.CRITICAL) {
    return 'CRITICAL';
  }
  if (score >= THRESHOLDS.HIGH) {
    return 'HIGH';
  }
  if (score >= THRESHOLDS.MEDIUM) {
    return 'MEDIUM';
  }
  return 'LOW';
}

function actionFor(level: RiskLevel): PolicyAction {
  switch (level) {
    case 'CRITICAL':
      return 'BLOCK_WARNING';
    case 'HIGH':
      return 'STRONG_WARNING';
    case 'MEDIUM':
      return 'SUBTLE_WARNING';
    default:
      return 'NONE';
  }
}

export const stubRiskEngine: RiskEngine = {
  evaluate,
  getConfig(): RiskEngineConfig {
    return {
      weightsVersion: STUB_WEIGHTS_VERSION,
      weights: {...WEIGHTS},
      thresholds: {...THRESHOLDS},
    };
  },
};
