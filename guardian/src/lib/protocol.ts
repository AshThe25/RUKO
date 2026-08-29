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

export type Presence = {
  phoneConnected: boolean;
  guardianConnected: boolean;
  phoneDisplayName: string;
  guardianDisplayName: string | null;
};

export type RiskAssessment = {
  score: number;
  level: RiskLevel;
  reasons: string[];
  policyAction: string;
  lowConfidence: boolean;
  modelVersion: string;
  policyVersion: string;
  evaluatedAt: string;
};

export type RiskAlert = {
  incidentId: string;
  payment: {
    amountRupees: number;
    payeeDisplayName: string;
    firstPayment: boolean;
  };
  assessment: RiskAssessment;
  topReasons: [string, string, string];
  runtime: {
    engine: string;
    model: string;
    backend: InferenceBackend;
    isLocal: boolean;
    lastLatencyMs: number | null;
  };
  phoneState: 'PAYMENT_PAUSED';
};

export type GuardianActionAck = {
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
  sentAt: string;
  payload: TPayload;
};

export type InboundFrame =
  | Envelope<'PAIR_ACK', Presence>
  | Envelope<'PRESENCE', Presence>
  | Envelope<'RISK_ALERT', RiskAlert>
  | Envelope<'GUARDIAN_ACTION_ACK', GuardianActionAck>
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

export function isRiskAssessment(value: unknown): value is RiskAssessment {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.score) &&
    value.score >= 0 &&
    value.score <= 100 &&
    Number.isInteger(value.score) &&
    RISK_LEVELS.includes(value.level as RiskLevel) &&
    Array.isArray(value.reasons) &&
    typeof value.lowConfidence === 'boolean' &&
    isNonEmptyString(value.modelVersion) &&
    isNonEmptyString(value.policyVersion)
  );
}

export function isRiskAlert(value: unknown): value is RiskAlert {
  if (!isRecord(value)) return false;
  const { payment, runtime, topReasons } = value;

  if (!isNonEmptyString(value.incidentId)) return false;
  if (!isRecord(payment)) return false;
  if (!isFiniteNumber(payment.amountRupees) || payment.amountRupees < 0) return false;
  if (!isNonEmptyString(payment.payeeDisplayName)) return false;
  if (typeof payment.firstPayment !== 'boolean') return false;
  if (!isRiskAssessment(value.assessment)) return false;

  // Exactly three reasons, every one of them real. A blank reason would render
  // as an empty bullet in the "why", which is worse than no bullet at all.
  if (!Array.isArray(topReasons) || topReasons.length !== 3) return false;
  if (!topReasons.every(isNonEmptyString)) return false;

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
    case 'RISK_ALERT':
      return isRiskAlert(payload) ? (candidate as InboundFrame) : null;
    case 'GUARDIAN_ACTION_ACK':
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
    sentAt: new Date().toISOString(),
    payload,
  };
}

/* -------------------------------------------------------------------------- */
/* Presentation helpers                                                       */
/* -------------------------------------------------------------------------- */

/** Indian digit grouping: ₹48,000 and ₹1,00,000. */
export function formatRupees(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
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
