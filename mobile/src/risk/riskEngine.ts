/**
 * The Ruko deterministic risk engine.
 *
 * This is the only thing in the product allowed to produce a `RiskResult`. No
 * model, no LLM, no agent ever does. Given the same `RiskEvidence` it returns
 * the same score, every time, on every device, and every term it used is in the
 * output so the decision can be explained and audited afterwards.
 *
 * Structure of a score:
 *
 *     points = signal x weight x gate
 *
 * `signal`  [0,1]  what the evidence says.
 * `weight`         how much that signal is worth at most (weights.ts).
 * `gate`    [0,1]  how much we are willing to trust it *in this context*.
 *
 * The gates are where the product thesis actually lives. A large payment is not
 * suspicious by itself; a large payment to someone you have paid for two years
 * is not suspicious at all; a classifier that only heard four words does not get
 * to drive a warning. Gates encode that, explicitly, with a stated reason
 * attached to every one that fires.
 */

import type {
  CallEvidence,
  EvidenceFamily,
  ManipulationLabel,
  RiskContribution,
  RiskEngineConfig,
  RiskEvidence,
  RiskLevel,
  RiskReason,
  RiskReasonCode,
  RiskResult,
} from '../contracts/index.ts';
import {
  CORROBORATION_FRACTION,
  ESTABLISHED_PAYEE_ANOMALY_GATE,
  ESTABLISHED_PAYEE_MIN_TXNS,
  FAMILY_MAX,
  MIN_CONVERSATION_RELIABILITY,
  MIN_FAMILIES_FOR_CRITICAL,
  REASON_FAMILY,
  THRESHOLDS,
  WEIGHTS,
  WEIGHTS_VERSION,
} from './weights.ts';
import { decidePolicy, POLICY_VERSION } from './policy.ts';

export const ENGINE_VERSION = 'ruko-risk-engine-v1';

/** User-facing text for each reason. Never accusatory, never blames the user. */
export const REASON_LABELS: Record<RiskReasonCode, string> = {
  COERCION: 'The caller is using a threat to pressure you',
  AUTHORITY_IMPERSONATION: 'The caller claims to be from a bank or an authority',
  FINANCIAL_INSTRUCTION: 'Someone on this call is instructing you to send money',
  CREDENTIAL_REQUEST: 'Someone asked you for an OTP, PIN or card details',
  URGENCY: 'You are being rushed to act immediately',
  SECRECY: 'You are being asked to keep this from other people',
  NEW_PAYEE: 'You have never paid this recipient before',
  AMOUNT_ANOMALY: 'This payment is much larger than your usual payments',
  FREQUENCY_ANOMALY: 'Unusually many payments in a short time',
  TIME_ANOMALY: 'This is an unusual time of day for you to pay',
  CALL_DURING_PAYMENT: 'You are on a call while making this payment',
  UNKNOWN_CALLER: 'The caller is not in your contacts',
  SUSPICIOUS_NOTIFICATION: 'Recent messages use financial pressure language',
};

/**
 * The same reasons, worded for evidence Ruko *read* rather than *heard*.
 *
 * Only the conversation family needs this: every other reason is already
 * neutral about how it was observed. Telling someone "the caller is
 * threatening you" when there was no call is a small lie, and a costly one --
 * the first thing they do is check whether they are on a call, find they are
 * not, and stop believing the rest of the warning.
 */
const MESSAGE_REASON_LABELS: Partial<Record<RiskReasonCode, string>> = {
  COERCION: 'These messages are using a threat to pressure you',
  AUTHORITY_IMPERSONATION: 'These messages claim to be from a bank or an authority',
  FINANCIAL_INSTRUCTION: 'These messages are instructing you to send money',
  CREDENTIAL_REQUEST: 'You were asked for an OTP, PIN or card details',
  URGENCY: 'You are being rushed to act immediately',
  SECRECY: 'You are being asked to keep this from other people',
};

/** Picks the wording that matches where the text actually came from. */
export function reasonLabel(code: RiskReasonCode, fromMessages: boolean): string {
  return (fromMessages && MESSAGE_REASON_LABELS[code]) || REASON_LABELS[code];
}

const CONVERSATION_TERMS: Array<[RiskReasonCode, ManipulationLabel]> = [
  ['COERCION', 'coercion'],
  ['AUTHORITY_IMPERSONATION', 'authority'],
  ['CREDENTIAL_REQUEST', 'credentialRequest'],
  ['FINANCIAL_INSTRUCTION', 'financialInstruction'],
  ['URGENCY', 'urgency'],
  ['SECRECY', 'secrecy'],
];

const clamp01 = (n: number): number =>
  !Number.isFinite(n) ? 0 : n < 0 ? 0 : n > 1 ? 1 : n;

/** Call signal: a call already in progress when the payment began matters most. */
function callSignal(call: CallEvidence): number {
  if (!call.available || !call.active) return 0;
  if (call.startedBeforePayment === false) return 0.5;
  return 1;
}

export function evaluateRisk(evidence: RiskEvidence): RiskResult {
  const startedAt = Date.now();
  const contributions: RiskContribution[] = [];
  const degradedReasons: string[] = [];

  const push = (
    code: RiskReasonCode,
    signal: number,
    gate: number,
    gateReason?: string,
  ): void => {
    const s = clamp01(signal);
    const g = clamp01(gate);
    contributions.push({
      code,
      family: REASON_FAMILY[code],
      signal: s,
      weight: WEIGHTS[code],
      gate: g,
      points: s * WEIGHTS[code] * g,
      gateReason,
    });
  };

  // ---------------------------------------------------------------- //
  // CONVERSATION
  // ---------------------------------------------------------------- //
  const conv = evidence.conversation;
  let convGate = 1;
  let convGateReason: string | undefined;

  if (!conv?.available) {
    convGate = 0;
    convGateReason = 'no conversation evidence available';
    degradedReasons.push(
      conv?.unavailableReason ?? 'Ruko could not hear the conversation',
    );
  } else if (conv.reliability < MIN_CONVERSATION_RELIABILITY) {
    // Too little speech, or the classifier itself is unsure. Discard rather than
    // scale: a barely-heard fragment should contribute nothing, not a little.
    convGate = 0;
    convGateReason =
      `classifier reliability ${conv.reliability.toFixed(2)} is below the ` +
      `${MIN_CONVERSATION_RELIABILITY} minimum`;
    degradedReasons.push(
      'Ruko could not confidently assess the conversation (too little speech)',
    );
  } else {
    // Scale by reliability. A window the classifier is 60% sure it understood
    // contributes 60% of its weight.
    convGate = conv.reliability;
    if (conv.reliability < 1) {
      convGateReason = `scaled by classifier reliability ${conv.reliability.toFixed(2)}`;
    }
  }

  for (const [code, label] of CONVERSATION_TERMS) {
    push(code, conv?.available ? (conv.scores?.[label] ?? 0) : 0, convGate, convGateReason);
  }

  // ---------------------------------------------------------------- //
  // PAYEE + BEHAVIOUR
  // ---------------------------------------------------------------- //
  const payee = evidence.payee;
  const behaviour = evidence.behaviour;

  const payeeEstablished =
    payee?.available === true &&
    payee.known &&
    (payee.userTrusted || payee.previousTransactions >= ESTABLISHED_PAYEE_MIN_TXNS);

  if (!payee?.available) {
    push('NEW_PAYEE', 0, 0, 'recipient could not be identified');
    degradedReasons.push(
      payee?.unavailableReason ?? 'Ruko could not identify the recipient',
    );
  } else if (payee.userTrusted) {
    push('NEW_PAYEE', payee.known ? 0 : 1, 0, 'recipient is marked trusted by you');
  } else {
    push('NEW_PAYEE', payee.known ? 0 : 1, 1);
  }

  // The amount-anomaly gate is the single most important false-positive
  // defence in the engine. It is why a 50,000 rent payment to a known landlord
  // does not look like a 48,000 transfer to a stranger.
  let anomalyGate = 1;
  let anomalyGateReason: string | undefined;
  if (!behaviour?.available || !behaviour.profileMature) {
    anomalyGate = 0;
    anomalyGateReason =
      behaviour?.unavailableReason ?? 'not enough payment history to judge this amount';
    degradedReasons.push(
      'Ruko does not yet know your normal payment pattern, so it did not ' +
        'treat this amount as unusual',
    );
  } else if (payeeEstablished) {
    anomalyGate = ESTABLISHED_PAYEE_ANOMALY_GATE;
    anomalyGateReason =
      `you have paid this recipient ${payee.previousTransactions} times before`;
  }

  push('AMOUNT_ANOMALY', behaviour?.amountAnomaly ?? 0, anomalyGate, anomalyGateReason);
  push('FREQUENCY_ANOMALY', behaviour?.frequencyAnomaly ?? 0,
    behaviour?.available && behaviour.profileMature ? 1 : 0, anomalyGateReason);
  push('TIME_ANOMALY', behaviour?.timeAnomaly ?? 0,
    behaviour?.available && behaviour.profileMature ? 1 : 0, anomalyGateReason);

  // ---------------------------------------------------------------- //
  // CALL CONTEXT
  // ---------------------------------------------------------------- //
  const call = evidence.call;
  if (!call?.available) {
    push('CALL_DURING_PAYMENT', 0, 0, 'call state unavailable');
    push('UNKNOWN_CALLER', 0, 0, 'call state unavailable');
    degradedReasons.push('Ruko could not check whether you are on a call');
  } else {
    push('CALL_DURING_PAYMENT', callSignal(call), 1,
      call.startedBeforePayment === false
        ? 'the call started after the payment screen opened'
        : undefined);
    // `callerKnown === null` means we could not check contacts. That is not the
    // same as an unknown caller and must not be scored as one.
    push('UNKNOWN_CALLER', call.active && call.callerKnown === false ? 1 : 0,
      call.callerKnown === null ? 0 : 1,
      call.callerKnown === null ? 'contacts could not be checked' : undefined);
  }

  // ---------------------------------------------------------------- //
  // NOTIFICATIONS
  // ---------------------------------------------------------------- //
  const notif = evidence.notification;
  push('SUSPICIOUS_NOTIFICATION', notif?.available ? notif.suspicion : 0,
    notif?.available ? 1 : 0, notif?.available ? undefined : 'no notification access');

  // ---------------------------------------------------------------- //
  // FUSION
  // ---------------------------------------------------------------- //
  const rawPoints = contributions.reduce((sum, c) => sum + c.points, 0);
  const score = Math.round(Math.min(100, Math.max(0, rawPoints)));

  const familyPoints: Record<EvidenceFamily, number> = {
    CONVERSATION: 0, PAYEE_BEHAVIOUR: 0, CALL_CONTEXT: 0, NOTIFICATION: 0,
  };
  for (const c of contributions) familyPoints[c.family] += c.points;

  const corroboratingFamilies = (Object.keys(familyPoints) as EvidenceFamily[])
    .filter((f) => familyPoints[f] >= FAMILY_MAX[f] * CORROBORATION_FRACTION)
    .sort((a, b) => familyPoints[b] - familyPoints[a]);

  let level: RiskLevel =
    score >= THRESHOLDS.CRITICAL ? 'CRITICAL'
      : score >= THRESHOLDS.HIGH ? 'HIGH'
        : score >= THRESHOLDS.MEDIUM ? 'MEDIUM' : 'LOW';

  // --- Caps. These only ever lower the level, never raise it. --- //
  if (level === 'CRITICAL' && corroboratingFamilies.length < MIN_FAMILIES_FOR_CRITICAL) {
    level = 'HIGH';
    degradedReasons.push(
      `held back from a full intervention: only ${corroboratingFamilies.length} ` +
        `independent evidence source(s), ${MIN_FAMILIES_FOR_CRITICAL} required`,
    );
  }
  if (level === 'CRITICAL' && convGate === 0) {
    level = 'HIGH';
    degradedReasons.push(
      'held back from a full intervention: no usable conversation evidence',
    );
  }

  const reasons: RiskReason[] = contributions
    .filter((c) => c.points >= 1)
    .sort((a, b) => b.points - a.points)
    .map((c) => ({
      code: c.code,
      label: reasonLabel(c.code, evidence.conversation?.textSource === 'MESSAGES'),
      points: Number(c.points.toFixed(2)),
      family: c.family,
    }));

  const policy = decidePolicy(level, evidence);

  return {
    sessionId: evidence.sessionId,
    score,
    level,
    policyAction: policy.action,
    reasons,
    contributions: contributions.map((c) => ({ ...c, points: Number(c.points.toFixed(3)) })),
    corroboratingFamilies,
    degraded: degradedReasons.length > 0,
    degradedReasons: [...new Set([...degradedReasons, ...policy.notes])],
    escalateToGuardian: policy.escalateToGuardian,
    requiresGuardianApproval: policy.requiresGuardianApproval,
    modelVersion: conv?.modelVersion ?? 'none',
    weightsVersion: WEIGHTS_VERSION,
    policyVersion: POLICY_VERSION,
    engineVersion: ENGINE_VERSION,
    timestamp: evidence.timestamp,
    computeMs: Date.now() - startedAt,
  };
}

export function getRiskEngineConfig(): RiskEngineConfig {
  return { weightsVersion: WEIGHTS_VERSION, weights: { ...WEIGHTS }, thresholds: { ...THRESHOLDS } };
}
