/**
 * Ruko shared contract — phone <-> relay <-> Guardian (Office Kit) transport.
 *
 * Owned by Puneesh. Implemented by `backend/` (FastAPI relay) and `guardian/`
 * (Next.js console), and consumed by `android/`.
 *
 * The relay is deliberately thin. It authenticates, validates, routes and
 * forgets. It never scores risk, never edits evidence, and never persists an
 * incident beyond the life of the session.
 */

import type { RiskLevel, RiskResult } from './risk.schema';

export const PROTOCOL_VERSION = '1.0.0' as const;

/* -------------------------------------------------------------------------- */
/* REST                                                                       */
/* -------------------------------------------------------------------------- */

/** POST /devices/register — called once by the phone on first launch. */
export type DeviceRegisterRequest = {
  /** Stable, app-scoped, random. NOT an Android ID, IMEI or advertising ID. */
  installationId: string;
  /** e.g. "iQOO 15". Free text, max 64 chars. Used only for display. */
  deviceLabel: string;
  platform: 'android';
  appVersion: string;
};

export type DeviceRegisterResponse = {
  deviceId: string;
  /** Bearer token for subsequent phone calls. Opaque. */
  deviceToken: string;
  issuedAt: string;
};

/** POST /guardian/pair — phone asks for a pairing code (Bearer deviceToken). */
export type GuardianPairRequest = {
  /** Shown on the phone so the user can read it out to their trusted person. */
  displayName: string;
};

export type GuardianPairResponse = {
  sessionId: string;
  /** Exactly six digits. Single use. */
  pairingCode: string;
  /** Short-lived — see backend settings, default 10 minutes. */
  expiresAt: string;
};

/** POST /guardian/pair/claim — the Guardian console redeems the code. */
export type GuardianClaimRequest = {
  pairingCode: string;
  guardianDisplayName: string;
};

export type GuardianClaimResponse = {
  sessionId: string;
  /** Bearer token for the Guardian websocket. Opaque, session-scoped. */
  guardianToken: string;
  phoneDisplayName: string;
};

/**
 * POST /risk-events — optional, anonymous, opt-in telemetry (master prompt §29).
 * Carries no evidence, no payee, no amount and no transcript.
 */
export type RiskEventReport = {
  /** Random per-event. Not correlatable to a device. */
  eventId: string;
  level: RiskLevel;
  score: number;
  policyAction: RiskResult['policyAction'];
  /** True when the user chose to continue anyway. */
  overridden: boolean;
  modelVersion: string;
  policyVersion: string;
  occurredAt: string;
};

/** GET /models/latest — model/version management. */
export type ModelMetadata = {
  name: string;
  version: string;
  /** SHA-256 of the model artefact. */
  sha256: string;
  sizeBytes: number;
  /** Null until a model is actually published. Never a placeholder URL. */
  downloadUrl: string | null;
  releasedAt: string;
};

/* -------------------------------------------------------------------------- */
/* WebSocket: WS /guardian/{sessionId}?token=...                              */
/* -------------------------------------------------------------------------- */

export type ConnectionRole = 'PHONE' | 'GUARDIAN';

export type Envelope<TType extends string, TPayload> = {
  protocolVersion: typeof PROTOCOL_VERSION;
  type: TType;
  /** Client-generated, unique per message. Used for idempotency. */
  messageId: string;
  sessionId: string;
  sentAt: string;
  payload: TPayload;
};

/** Sent by the relay to both peers whenever presence changes. */
export type PresencePayload = {
  phoneConnected: boolean;
  guardianConnected: boolean;
  phoneDisplayName: string;
  guardianDisplayName: string | null;
};

/**
 * Phone -> Guardian. The single most important message in the system.
 *
 * Deliberately does NOT include: transcript, audio, payee VPA, account number,
 * coordinates, or notification bodies.
 */
export type RiskAlertPayload = {
  incidentId: string;
  payment: {
    amountRupees: number;
    /** Display name only. */
    payeeDisplayName: string;
    firstPayment: boolean;
  };
  assessment: RiskResult;
  /** Exactly three plain-language reasons, max 140 chars each. */
  topReasons: [string, string, string];
  runtime: {
    /** e.g. "onnxruntime-android". */
    engine: string;
    model: string;
    backend: InferenceBackend;
    isLocal: boolean;
    /** Measured. Null when not measured — never a guess. */
    lastLatencyMs: number | null;
  };
  /** What the phone is already doing. The Guardian confirms or overrides. */
  phoneState: 'PAYMENT_PAUSED';
};

export type InferenceBackend = 'CPU' | 'NNAPI' | 'QUALCOMM' | 'RULES' | 'UNKNOWN';

/** Guardian -> phone. One action per incident, enforced by the relay. */
export type GuardianActionPayload = {
  incidentId: string;
  action: 'KEEP_BLOCKED' | 'ALLOW';
  guardianDisplayName: string;
  /** Optional free-text note, max 160 chars. */
  note: string | null;
};

export type GuardianActionAckPayload = {
  incidentId: string;
  accepted: boolean;
  /** Present when accepted is false. */
  reason: string | null;
};

export type HeartbeatPayload = { nonce: string };

export type RelayErrorCode =
  | 'INVALID_MESSAGE'
  | 'UNSUPPORTED_PROTOCOL'
  | 'UNAUTHORIZED'
  | 'PAIRING_FAILED'
  | 'PAIRING_EXPIRED'
  | 'SESSION_FULL'
  | 'ROLE_NOT_PERMITTED'
  | 'UNKNOWN_INCIDENT'
  | 'ACTION_ALREADY_TAKEN'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export type RelayErrorPayload = {
  code: RelayErrorCode;
  message: string;
  recoverable: boolean;
};

export type PairAckEnvelope = Envelope<'PAIR_ACK', PresencePayload>;
export type PresenceEnvelope = Envelope<'PRESENCE', PresencePayload>;
export type RiskAlertEnvelope = Envelope<'RISK_ALERT', RiskAlertPayload>;
export type GuardianActionEnvelope = Envelope<'GUARDIAN_ACTION', GuardianActionPayload>;
export type GuardianActionAckEnvelope = Envelope<'GUARDIAN_ACTION_ACK', GuardianActionAckPayload>;
export type PingEnvelope = Envelope<'PING', HeartbeatPayload>;
export type PongEnvelope = Envelope<'PONG', HeartbeatPayload>;
export type RelayErrorEnvelope = Envelope<'ERROR', RelayErrorPayload>;

export type AnyEnvelope =
  | PairAckEnvelope
  | PresenceEnvelope
  | RiskAlertEnvelope
  | GuardianActionEnvelope
  | GuardianActionAckEnvelope
  | PingEnvelope
  | PongEnvelope
  | RelayErrorEnvelope;

/** Which role is permitted to originate which message type. */
export const ORIGINATOR: Record<AnyEnvelope['type'], ConnectionRole | 'RELAY'> = {
  PAIR_ACK: 'RELAY',
  PRESENCE: 'RELAY',
  RISK_ALERT: 'PHONE',
  GUARDIAN_ACTION: 'GUARDIAN',
  GUARDIAN_ACTION_ACK: 'RELAY',
  PING: 'RELAY',
  PONG: 'PHONE',
  ERROR: 'RELAY',
};

/** Heartbeat cadence. Two missed intervals = disconnected. */
export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_MISS_LIMIT = 2;
