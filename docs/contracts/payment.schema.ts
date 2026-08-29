/**
 * Ruko shared contracts — payment, payee, behaviour and call context.
 * Contract version: contracts-v1
 *
 * Produced by: Android providers (Puneesh) + local behaviour store (Vedant).
 * Consumed by: risk engine, investigation UI.
 *
 * NOTE ON ANDROID REALITY: a normal third-party app cannot intercept arbitrary
 * UPI transactions. `source` records exactly how each field was obtained so the
 * UI and the audit trail can never overclaim.
 */

import type { Confidence, EvidenceBase, Timestamp } from './common.schema';

export interface PaymentEvidence extends EvidenceBase {
  /** Is the user currently on a payment confirmation surface? */
  active: boolean;
  amountMinor: number | null; // paise. Integer money only — never floats.
  currency: 'INR';
  /** Display name as shown on screen. In memory only; not persisted raw. */
  payeeDisplayName: string | null;
  /** Stable local salted hash of the payee identifier. Safe to persist. */
  payeeHash: string | null;
  /** Package name of the app the payment is happening in, when known. */
  appPackage?: string;
  timestamp: Timestamp;
}

export interface PayeeEvidence extends EvidenceBase {
  known: boolean;
  previousTransactions: number;
  averageAmountMinor: number | null;
  maxAmountMinor: number | null;
  firstSeen: Timestamp | null;
  lastSeen: Timestamp | null;
  /** Days since first payment to this payee. New payees are riskier. */
  ageDays: number | null;
  /** User explicitly marked this payee as trusted (e.g. landlord, family). */
  userTrusted: boolean;
}

export interface BehaviourEvidence extends EvidenceBase {
  /** current / p95(history). 1.0 == a completely typical amount. */
  amountRatio: number | null;
  /** amountRatio mapped to [0,1] by a documented, testable curve. */
  amountAnomaly: Confidence;
  medianAmountMinor: number | null;
  meanAmountMinor: number | null;
  p95AmountMinor: number | null;
  /** Payments in the last hour vs. the user's normal rate. */
  frequencyAnomaly: Confidence;
  /** Payment at an unusual hour for this user. */
  timeAnomaly: Confidence;
  /** How many historical transactions the profile is built from. */
  sampleSize: number;
  /**
   * False when sampleSize is below the minimum needed for the statistics to
   * mean anything. The risk engine must not treat a cold-start profile as
   * evidence of anomaly.
   */
  profileMature: boolean;
}

export interface CallEvidence extends EvidenceBase {
  active: boolean;
  callerKnown: boolean | null; // null == we could not check contacts
  direction: 'INCOMING' | 'OUTGOING' | 'UNKNOWN';
  durationMs: number | null;
  /** True if the call started before the payment flow — the classic pattern. */
  startedBeforePayment: boolean | null;
}

export interface NotificationEvidence extends EvidenceBase {
  /** Aggregate suspicion of recent payment-related notifications, [0,1]. */
  suspicion: Confidence;
  matchedCategories: string[]; // e.g. ['KYC_EXPIRY', 'ACCOUNT_FREEZE']
  count: number;
  windowMs: number;
}

/** A completed local transaction record. Persisted on device only. */
export interface TransactionRecord {
  id: string;
  payeeHash: string;
  amountMinor: number;
  timestamp: Timestamp;
  /** Was this payment made while Ruko had flagged risk? For the audit trail. */
  riskScoreAtTime?: number;
}
