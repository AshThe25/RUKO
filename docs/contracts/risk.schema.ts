/**
 * Ruko shared contracts — risk evidence, risk result and safety policy.
 * Contract version: contracts-v1
 *
 * This is the single most important boundary in the product:
 *
 *   AI GATHERS AND INTERPRETS EVIDENCE  ->  RiskEvidence
 *   A DETERMINISTIC ENGINE DECIDES      ->  RiskResult
 *
 * No model, LLM or agent ever emits a RiskResult directly. Only the risk engine
 * does, from a RiskEvidence object, with versioned weights, and it is unit
 * tested. Owner: Vedant.
 */

import type { RiskScore, Timestamp } from './common.schema';
import type { ConversationEvidence } from './conversation.schema';
import type {
  BehaviourEvidence,
  CallEvidence,
  NotificationEvidence,
  PayeeEvidence,
  PaymentEvidence,
} from './payment.schema';

/** The complete input to the risk engine. Nothing else may influence the score. */
export interface RiskEvidence {
  sessionId: string;
  timestamp: Timestamp;
  conversation: ConversationEvidence;
  payment: PaymentEvidence;
  payee: PayeeEvidence;
  behaviour: BehaviourEvidence;
  call: CallEvidence;
  notification?: NotificationEvidence;
}

export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/**
 * What the app is allowed to do at each level. Ruko never silently blocks money:
 * every action above NONE is user-visible and explained.
 */
export const POLICY_ACTIONS = [
  'NONE', // stay quiet
  'SUBTLE_WARNING', // a passive banner, no interruption
  'STRONG_WARNING', // full-screen warning, deliberate confirmation to continue
  'BLOCK_WARNING', // full-screen intervention, "DON'T PAY" is the primary CTA
] as const;
export type PolicyAction = (typeof POLICY_ACTIONS)[number];

/** A single human-readable driver of the score. Powers the "WHY?" screen. */
export interface RiskReason {
  /** Stable machine code, safe to switch on and to localise. */
  code: RiskReasonCode;
  /** Short user-facing line. Never blames the user. */
  label: string;
  /** Points this reason contributed to the final score. */
  points: number;
  family: EvidenceFamily;
}

export type RiskReasonCode =
  | 'COERCION'
  | 'AUTHORITY_IMPERSONATION'
  | 'FINANCIAL_INSTRUCTION'
  | 'URGENCY'
  | 'SECRECY'
  | 'CREDENTIAL_REQUEST'
  | 'NEW_PAYEE'
  | 'AMOUNT_ANOMALY'
  | 'FREQUENCY_ANOMALY'
  | 'TIME_ANOMALY'
  | 'UNKNOWN_CALLER'
  | 'CALL_DURING_PAYMENT'
  | 'SUSPICIOUS_NOTIFICATION';

/**
 * Evidence families are independent sources of truth. CRITICAL requires
 * corroboration across families — one family alone can never block a payment.
 */
export const EVIDENCE_FAMILIES = ['CONVERSATION', 'PAYEE_BEHAVIOUR', 'CALL_CONTEXT', 'NOTIFICATION'] as const;
export type EvidenceFamily = (typeof EVIDENCE_FAMILIES)[number];

export interface RiskResult {
  sessionId: string;
  score: RiskScore; // 0..100
  level: RiskLevel;
  policyAction: PolicyAction;
  /** Ordered by points, descending. What the user is shown. */
  reasons: RiskReason[];
  /** Every weight term, including zero ones. For the engineering / audit view. */
  contributions: RiskContribution[];
  /** Families that actually contributed. CRITICAL needs >= 2. */
  corroboratingFamilies: EvidenceFamily[];
  /**
   * True when evidence was missing or unreliable and the engine deliberately
   * held back. The UI must say so honestly rather than fake confidence.
   */
  degraded: boolean;
  degradedReasons: string[];
  /** Should the guardian / Office Kit be notified? Policy decides, not the model. */
  escalateToGuardian: boolean;

  // --- audit trail: everything needed to reproduce this decision ---
  modelVersion: string;
  weightsVersion: string;
  policyVersion: string;
  engineVersion: string;
  timestamp: Timestamp;
  computeMs: number;
}

export interface RiskContribution {
  code: RiskReasonCode;
  family: EvidenceFamily;
  /** The normalised [0,1] signal value used. */
  signal: number;
  /** Configured maximum points for this term. */
  weight: number;
  /** Multiplier applied by context gates (1 = no gating). */
  gate: number;
  /** signal * weight * gate */
  points: number;
  /** Why the gate was applied, when it was not 1. */
  gateReason?: string;
}

export interface RiskEngineConfig {
  weightsVersion: string;
  weights: Record<RiskReasonCode, number>;
  thresholds: Record<Exclude<RiskLevel, 'LOW'>, number>;
}

export interface RiskEngine {
  evaluate(evidence: RiskEvidence): RiskResult;
  getConfig(): RiskEngineConfig;
}
