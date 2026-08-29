/**
 * Ruko shared contracts — guardian / Office Kit transport.
 * Contract version: contracts-v1
 *
 * OWNER: Puneesh (Android, backend relay, Office Kit).
 *
 * Replaces the stub Vedant wrote so the risk layer had something to compile
 * against. It keeps his domain types verbatim and adds the wire protocol:
 * REST pairing, the websocket envelope, and who may originate what.
 *
 * Hard rule, unchanged: the guardian channel is OPTIONAL. Disconnected,
 * offline or never paired, the phone protects the user exactly the same.
 *
 * The relay is not a participant. It authenticates, validates, routes and
 * forgets. It never computes a score, never edits evidence, and never keeps an
 * incident past the life of its session.
 */

import type { Timestamp } from './common.schema';
import type { RiskLevel, RiskReason, RiskResult } from './risk.schema';

export const PROTOCOL_VERSION = '1.0.0' as const;

/* -------------------------------------------------------------------------- */
/* Reconciliation notes (2026-08-29, Puneesh)                                 */
/* -------------------------------------------------------------------------- */
/*
 * Three deliberate decisions, per docs/contracts/RECONCILIATION.md:
 *
 * 1. Money is `amountMinor` in integer paise, matching payment.schema.ts.
 *    Rupee-only silently truncates and the bug stays invisible until a demo.
 *    The Office Kit divides by 100 for display, in exactly one function.
 *
 * 2. Timestamps on the wire are epoch ms (`Timestamp`), NOT ISO strings.
 *    This deviates from the reconciliation table, and here is why: the alert
 *    embeds `RiskResult` verbatim, and `RiskResult.timestamp` is epoch ms. To
 *    put ISO on the wire the relay or the phone would have to *reshape* the
 *    engine's own output at the boundary — which is both extra drift surface
 *    and a violation of "the relay never rewrites a payload". One convention
 *    end to end beats two with a converter between them. Vedant: push back if
 *    you disagree, it is a one-line change on my side.
 *
 * 3. There is no separate `topReasons`. `RiskResult.reasons` is already
 *    ordered by points descending, so the console renders the first three.
 *    A second list would be a second place for the "why" to disagree with the
 *    score.
 */

/* -------------------------------------------------------------------------- */
/* REST                                                                       */
/* -------------------------------------------------------------------------- */

/** POST /devices/register — called once by the phone on first launch. */
export interface DeviceRegisterRequest {
  /** App-scoped and random. NOT an Android ID, IMEI or advertising ID. */
  installationId: string;
  /** e.g. "iQOO 15". Display only, max 64 chars. */
  deviceLabel: string;
  platform: 'android';
  appVersion: string;
}

export interface DeviceRegisterResponse {
  deviceId: string;
  /** Opaque bearer token for subsequent phone calls. */
  deviceToken: string;
  issuedAt: Timestamp;
}

/** POST /guardian/pair — phone asks for a pairing code (Bearer deviceToken). */
export interface GuardianPairRequest {
  /** Shown on the phone so the user can read it out to their trusted person. */
  displayName: string;
}

export interface GuardianPairResponse {
  sessionId: string;
  /** Exactly six digits. Single use. */
  pairingCode: string;
  expiresAt: Timestamp;
}

/** POST /guardian/pair/claim — the Office Kit redeems the code. */
export interface GuardianClaimRequest {
  pairingCode: string;
  guardianLabel: string;
}

export interface GuardianClaimResponse {
  sessionId: string;
  /** Opaque, session-scoped. Useless on any other session. */
  guardianToken: string;
  phoneDisplayName: string;
}

/**
 * POST /risk-events — optional, anonymous, opt-in telemetry.
 * Carries no amount, no payee, no evidence and no transcript, so enabling it
 * can never become a privacy regression.
 */
export interface RiskEventReport {
  /** Random per event. Not correlatable to a device. */
  eventId: string;
  level: RiskLevel;
  score: number;
  policyAction: RiskResult['policyAction'];
  /** True when the user chose to continue anyway. */
  overridden: boolean;
  modelVersion: string;
  policyVersion: string;
  occurredAt: Timestamp;
}

/** GET /models/latest — 404 when nothing has been published. Never a stub. */
export interface ModelMetadata {
  name: string;
  version: string;
  sha256: string;
  sizeBytes: number;
  downloadUrl: string | null;
  releasedAt: Timestamp;
}

/* -------------------------------------------------------------------------- */
/* WebSocket: WS /guardian/{sessionId}?token=...                              */
/* -------------------------------------------------------------------------- */

export type ConnectionRole = 'PHONE' | 'GUARDIAN';

export type GuardianConnectionState = 'UNPAIRED' | 'OFFLINE' | 'CONNECTING' | 'ONLINE';

export interface Envelope<TType extends string, TPayload> {
  protocolVersion: typeof PROTOCOL_VERSION;
  type: TType;
  /** Client-generated, unique per message. */
  messageId: string;
  sessionId: string;
  sentAt: Timestamp;
  payload: TPayload;
}

/** Relay -> both peers, whenever presence changes. */
export interface PresencePayload {
  phoneConnected: boolean;
  guardianConnected: boolean;
  phoneDisplayName: string;
  guardianLabel: string | null;
}

/**
 * Phone -> Guardian. The single most important message in the system.
 *
 * Deliberately absent: transcript, audio, payee VPA or hash, account number,
 * coordinates, notification bodies. The relay rejects any payload that carries
 * them.
 */
export interface GuardianAlertPayload {
  incidentId: string;
  payment: {
    /** Integer paise. */
    amountMinor: number;
    currency: 'INR';
    /** Display name only. */
    payeeDisplayName: string;
    firstPayment: boolean;
  };
  /** The engine's own result, carried verbatim. Never recomputed in transit. */
  assessment: RiskResult;
  /** What ran, measured. See the honesty rules below. */
  runtime: RuntimeInfo;
  /** What the phone has already done, so the console can say so. */
  phoneState: 'PAYMENT_PAUSED';
  /** Seconds until the phone stops waiting and decides alone. */
  expiresInSec: number;
}

export type InferenceBackend = 'CPU' | 'NNAPI' | 'QUALCOMM' | 'RULES' | 'UNKNOWN';

export interface RuntimeInfo {
  /** e.g. "onnxruntime-android". */
  engine: string;
  model: string;
  /** The backend the runtime reported after initialising — never the requested one. */
  backend: InferenceBackend;
  isLocal: boolean;
  isReady: boolean;
  /**
   * Measured on real inference. `null` means NOT MEASURED and must render as
   * an em dash. Never fill this with an estimate.
   */
  lastLatencyMs: number | null;
  /** Set whenever we asked for one backend and got another. */
  degradedReason: string | null;
}

/** Guardian -> phone. Advisory: it can keep a block, never force a payment. */
export interface GuardianDecisionPayload {
  incidentId: string;
  decision: 'KEEP_BLOCKED' | 'ALLOW';
  guardianLabel: string;
  note: string | null;
  decidedAt: Timestamp;
}

export interface GuardianDecisionAckPayload {
  incidentId: string;
  accepted: boolean;
  /** Present when accepted is false, or when the phone was offline. */
  reason: string | null;
}

export interface HeartbeatPayload {
  nonce: string;
}

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

export interface RelayErrorPayload {
  code: RelayErrorCode;
  message: string;
  recoverable: boolean;
}

export type PairAckEnvelope = Envelope<'PAIR_ACK', PresencePayload>;
export type PresenceEnvelope = Envelope<'PRESENCE', PresencePayload>;
export type GuardianAlertEnvelope = Envelope<'GUARDIAN_ALERT', GuardianAlertPayload>;
export type GuardianDecisionEnvelope = Envelope<'GUARDIAN_DECISION', GuardianDecisionPayload>;
export type GuardianDecisionAckEnvelope = Envelope<
  'GUARDIAN_DECISION_ACK',
  GuardianDecisionAckPayload
>;
export type PingEnvelope = Envelope<'PING', HeartbeatPayload>;
export type PongEnvelope = Envelope<'PONG', HeartbeatPayload>;
export type RelayErrorEnvelope = Envelope<'ERROR', RelayErrorPayload>;

export type AnyEnvelope =
  | PairAckEnvelope
  | PresenceEnvelope
  | GuardianAlertEnvelope
  | GuardianDecisionEnvelope
  | GuardianDecisionAckEnvelope
  | PingEnvelope
  | PongEnvelope
  | RelayErrorEnvelope;

/**
 * Who may ORIGINATE each message type. Enforced on every inbound frame, so a
 * compromised console cannot forge an alert and a phone cannot approve its own
 * payment.
 */
export const ORIGINATOR: Record<AnyEnvelope['type'], ConnectionRole | 'RELAY'> = {
  PAIR_ACK: 'RELAY',
  PRESENCE: 'RELAY',
  GUARDIAN_ALERT: 'PHONE',
  GUARDIAN_DECISION: 'GUARDIAN',
  GUARDIAN_DECISION_ACK: 'RELAY',
  PING: 'RELAY',
  PONG: 'PHONE',
  ERROR: 'RELAY',
};

/** Heartbeat cadence. Two missed intervals means disconnected. */
export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_MISS_LIMIT = 2;

/** Paise -> rupees, for display only. The one place this conversion happens. */
export function toRupees(amountMinor: number): number {
  return amountMinor / 100;
}

/** The console shows this many reasons. They come from RiskResult.reasons. */
export const DISPLAYED_REASON_COUNT = 3;

export type { RiskReason };
