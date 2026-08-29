/**
 * Guardian-side mirror of `docs/contracts/guardian.schema.ts`.
 *
 * Everything arriving over the socket is untrusted input, so the types here
 * are paired with runtime guards. A frame that does not match is dropped and
 * counted, never rendered — the Guardian must not display a half-parsed alert
 * about someone's money.
 */

export const PROTOCOL_VERSION = '1.0.0';

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type InferenceBackend = 'CPU' | 'NNAPI' | 'QUALCOMM' | 'RULES' | 'UNKNOWN';
export type GuardianAction = 'KEEP_BLOCKED' | 'ALLOW';
export type EvidenceFamily = 'CONVERSATION' | 'PAYEE_BEHAVIOUR' | 'CALL_CONTEXT' | 'NOTIFICATION';

/** How many reasons the console shows. They come from RiskResult.reasons. */
export const DISPLAYED_REASON_COUNT = 3;

export type Presence = {
  phoneConnected: boolean;
  guardianConnected: boolean;
  phoneDisplayName: string;
  guardianLabel: string | null;
};

/** One line of the "why". Produced by the engine, rendered verbatim. */
export type RiskReason = {
  code: string;
  label: string;
  points: number;
  family: EvidenceFamily;
};

/** The engine's own result. The console never recomputes any part of it. */
export type RiskResult = {
  sessionId: string;
  score: number;
  level: RiskLevel;
  policyAction: string;
  reasons: RiskReason[];
  contributions: unknown[];
  corroboratingFamilies: EvidenceFamily[];
  /** True when evidence was missing and the engine deliberately held back. */
  degraded: boolean;
  degradedReasons: string[];
  escalateToGuardian: boolean;
  modelVersion: string;
  weightsVersion: string;
  policyVersion: string;
  engineVersion: string;
  timestamp: number;
  computeMs: number;
};

export type GuardianAlert = {
  incidentId: string;
  payment: {
    /** Integer paise. Divide by 100 exactly once, in formatRupees. */
    amountMinor: number;
    currency: 'INR';
    payeeDisplayName: string;
    firstPayment: boolean;
  };
  assessment: RiskResult;
  runtime: {
    engine: string;
    model: string;
    backend: InferenceBackend;
    isLocal: boolean;
    isReady: boolean;
    lastLatencyMs: number | null;
    degradedReason: string | null;
  };
  phoneState: 'PAYMENT_PAUSED';
  /** Seconds until the phone stops waiting and decides alone. */
  expiresInSec: number;
};

export type GuardianDecisionAck = {
  incidentId: string;
  accepted: boolean;
  reason: string | null;
};

export type RelayError = {
  code: string;
  message: string;
  recoverable: boolean;
};

export type Envelope<TType extends string, TPayload> = {
  protocolVersion: string;
  type: TType;
  messageId: string;
  sessionId: string;
  /** Epoch milliseconds — one time convention across the whole wire. */
  sentAt: number;
  payload: TPayload;
};

export type InboundFrame =
  | Envelope<'PAIR_ACK', Presence>
  | Envelope<'PRESENCE', Presence>
  | Envelope<'GUARDIAN_ALERT', GuardianAlert>
  | Envelope<'GUARDIAN_DECISION_ACK', GuardianDecisionAck>
  | Envelope<'PING', { nonce: string }>
  | Envelope<'ERROR', RelayError>;

/* -------------------------------------------------------------------------- */
/* Runtime validation                                                         */
/* -------------------------------------------------------------------------- */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const RISK_LEVELS: readonly RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const BACKENDS: readonly InferenceBackend[] = ['CPU', 'NNAPI', 'QUALCOMM', 'RULES', 'UNKNOWN'];

export function isPresence(value: unknown): value is Presence {
  return (
    isRecord(value) &&
    typeof value.phoneConnected === 'boolean' &&
    typeof value.guardianConnected === 'boolean' &&
    typeof value.phoneDisplayName === 'string'
  );
}

function isRiskReason(value: unknown): value is RiskReason {
  return (
    isRecord(value) &&
    isNonEmptyString(value.code) &&
    // A blank label would render as an empty bullet in the "why", which is
    // worse than no bullet at all.
    isNonEmptyString(value.label) &&
    isFiniteNumber(value.points)
  );
}

export function isRiskResult(value: unknown): value is RiskResult {
  if (!isRecord(value)) return false;
  if (!isFiniteNumber(value.score)) return false;
  if (value.score < 0 || value.score > 100 || !Number.isInteger(value.score)) return false;
  if (!RISK_LEVELS.includes(value.level as RiskLevel)) return false;
  // An assessment with nothing in the "why" is worse than no assessment.
  if (!Array.isArray(value.reasons) || value.reasons.length === 0) return false;
  if (!value.reasons.every(isRiskReason)) return false;
  if (typeof value.degraded !== 'boolean') return false;
  if (!isNonEmptyString(value.modelVersion)) return false;
  if (!isNonEmptyString(value.policyVersion)) return false;
  return true;
}

export function isGuardianAlert(value: unknown): value is GuardianAlert {
  if (!isRecord(value)) return false;
  const { payment, runtime } = value;

  if (!isNonEmptyString(value.incidentId)) return false;
  if (!isRecord(payment)) return false;
  // Paise. A float here means somebody did rupee arithmetic on the way.
  if (!isFiniteNumber(payment.amountMinor)) return false;
  if (payment.amountMinor < 0 || !Number.isInteger(payment.amountMinor)) return false;
  if (!isNonEmptyString(payment.payeeDisplayName)) return false;
  if (typeof payment.firstPayment !== 'boolean') return false;
  if (!isRiskResult(value.assessment)) return false;

  if (!isRecord(runtime)) return false;
  if (!BACKENDS.includes(runtime.backend as InferenceBackend)) return false;
  if (typeof runtime.isLocal !== 'boolean') return false;
  // Null is meaningful: "not measured". Only null or a number is acceptable.
  if (runtime.lastLatencyMs !== null && !isFiniteNumber(runtime.lastLatencyMs)) return false;

  return value.phoneState === 'PAYMENT_PAUSED';
}

/** Parses a raw socket message, or returns null if it is not usable. */
export function parseFrame(raw: string): InboundFrame | null {
  let candidate: unknown;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(candidate)) return null;
  if (candidate.protocolVersion !== PROTOCOL_VERSION) return null;
  if (!isNonEmptyString(candidate.type) || !isNonEmptyString(candidate.sessionId)) return null;

  const { type, payload } = candidate;

  switch (type) {
    case 'PAIR_ACK':
    case 'PRESENCE':
      return isPresence(payload) ? (candidate as InboundFrame) : null;
    case 'GUARDIAN_ALERT':
      return isGuardianAlert(payload) ? (candidate as InboundFrame) : null;
    case 'GUARDIAN_DECISION_ACK':
      return isRecord(payload) && typeof payload.accepted === 'boolean'
        ? (candidate as InboundFrame)
        : null;
    case 'PING':
      return isRecord(payload) && isNonEmptyString(payload.nonce)
        ? (candidate as InboundFrame)
        : null;
    case 'ERROR':
      return isRecord(payload) && isNonEmptyString(payload.code)
        ? (candidate as InboundFrame)
        : null;
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Outbound                                                                   */
/* -------------------------------------------------------------------------- */

let counter = 0;

export function envelope<TType extends string, TPayload>(
  type: TType,
  sessionId: string,
  payload: TPayload,
): Envelope<TType, TPayload> {
  counter += 1;
  return {
    protocolVersion: PROTOCOL_VERSION,
    type,
    messageId: `msg_g_${Date.now().toString(36)}_${counter}`,
    sessionId,
    sentAt: Date.now(),
    payload,
  };
}

/* -------------------------------------------------------------------------- */
/* Presentation helpers                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Paise in, formatted rupees out, with Indian digit grouping: ₹48,000 and
 * ₹1,00,000. This is the ONLY place paise become rupees.
 *
 * Paise that do not divide evenly keep their decimals rather than being
 * rounded away — a ₹48,000.50 payment must not display as ₹48,000.
 */
export function formatRupees(amountMinor: number): string {
  const rupees = amountMinor / 100;
  const hasPaise = amountMinor % 100 !== 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: hasPaise ? 2 : 0,
  }).format(rupees);
}

/**
 * Null means the phone never measured a latency. It renders as an em dash —
 * never as a zero, and never as a plausible-looking guess.
 */
export function formatLatency(latencyMs: number | null): string {
  return latencyMs === null ? '—' : `${Math.round(latencyMs)} ms`;
}

export function backendLabel(backend: InferenceBackend): string {
  switch (backend) {
    case 'QUALCOMM':
      return 'Qualcomm NPU';
    case 'NNAPI':
      return 'NNAPI';
    case 'CPU':
      return 'CPU';
    case 'RULES':
      return 'Rules only';
    default:
      return 'Unknown';
  }
}
