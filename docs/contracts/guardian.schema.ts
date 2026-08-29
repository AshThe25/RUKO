/**
 * Ruko shared contracts — guardian / Office Kit protocol.
 * Contract version: contracts-v1
 *
 * OWNER: Puneesh (backend + Office Kit). Created here by Vedant only so that the
 * risk/policy layer has something to compile against. Puneesh owns all further
 * changes to this file — please do not edit it without telling him.
 *
 * Hard rule: the guardian channel is OPTIONAL. If it is disconnected, offline or
 * never paired, the phone must continue to protect the user exactly as before.
 */

import type { RiskScore, Timestamp } from './common.schema';
import type { RiskLevel, RiskReason } from './risk.schema';

export type GuardianConnectionState = 'UNPAIRED' | 'OFFLINE' | 'CONNECTING' | 'ONLINE';

/** Phone -> Office Kit. Deliberately minimal: no transcript, no raw audio. */
export interface GuardianAlert {
  sessionId: string;
  deviceLabel: string;
  timestamp: Timestamp;
  score: RiskScore;
  level: RiskLevel;
  amountMinor: number | null;
  currency: 'INR';
  /** Display name only, no account identifiers. */
  payeeDisplayName: string | null;
  reasons: RiskReason[];
  /** Seconds until the phone stops waiting and falls back to its own decision. */
  expiresInSec: number;
}

/** Office Kit -> phone. Advisory: it can keep a block, never force a payment. */
export interface GuardianDecision {
  sessionId: string;
  decision: 'KEEP_BLOCKED' | 'ALLOW';
  decidedAt: Timestamp;
  guardianLabel: string;
  note?: string;
}

export interface GuardianChannel {
  getState(): GuardianConnectionState;
  /** Resolves to null on timeout or disconnect — the phone then decides alone. */
  sendAlert(alert: GuardianAlert): Promise<GuardianDecision | null>;
}
