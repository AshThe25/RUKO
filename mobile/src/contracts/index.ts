/**
 * GENERATED FILE -- DO NOT EDIT.
 *
 * Source of truth: docs/contracts/*.schema.ts
 * Regenerate:      python3 mobile/src/contracts/sync_contracts.py
 * Verify:          python3 mobile/src/contracts/sync_contracts.py --check
 *
 * This is the Ruko shared contract surface, bundled into one module so that
 * Metro resolves it without watchFolders configuration. Every workstream
 * imports its types from here.
 */
/* eslint-disable */

// ===== docs/contracts/common.schema.ts ==========================================
/**
 * Ruko shared contracts — common primitives.
 * Contract version: contracts-v1
 *
 * Owner: Vedant (ML / risk). Changes require a CHANGELOG entry + team notice.
 */

export const CONTRACTS_VERSION = 'contracts-v1' as const;

/** A model / heuristic confidence, always normalised to the range [0, 1]. */
export type Confidence = number;

/** A risk score, always normalised to the range [0, 100]. */
export type RiskScore = number;

/** Epoch milliseconds. */
export type Timestamp = number;

/**
 * Where a piece of evidence came from. This matters for honesty: the UI and the
 * audit trail must be able to say "this came from a demo provider", never
 * present a mocked signal as if it were measured from the device.
 */
export type EvidenceSource =
  | 'ON_DEVICE_MODEL' // a real local model produced this
  | 'ON_DEVICE_HEURISTIC' // deterministic on-device rules (no model)
  | 'ANDROID_API' // read from a real Android API (call state, notifications)
  | 'ACCESSIBILITY' // parsed from a real accessibility node tree
  | 'LOCAL_STORE' // read from the local behaviour / payee database
  | 'DEMO' // Ruko's own controlled demo app — real pipeline, scripted input
  | 'MOCK'; // test fixture only. Must never appear in a shipped build.

/**
 * Every evidence block extends this. `available: false` means "we could not
 * measure this", which is NOT the same as a measured value of zero.
 */
export interface EvidenceBase {
  available: boolean;
  source: EvidenceSource;
  /** Why the evidence is unavailable, when it is. Surfaced in the audit trail. */
  unavailableReason?: string;
}

export function isAvailable<T extends EvidenceBase>(e: T | undefined | null): e is T {
  return !!e && e.available === true;
}

/** Clamp any number into [0, 1]. Defensive: model outputs are not trusted raw. */
export function clamp01(n: number): Confidence {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ===== docs/contracts/conversation.schema.ts ====================================
/**
 * Ruko shared contracts — conversation evidence.
 * Contract version: contracts-v1
 *
 * Produced by: the on-device manipulation classifier (ml/ + mobile/src/risk/classifier).
 * Consumed by: the deterministic risk engine, the live investigation UI.
 *
 * Owner: Vedant.
 */


/**
 * The manipulation signals Ruko looks for. These are deliberately about the
 * *tactic being used on the person*, not about "is this a scam" — the whole
 * product thesis is that the model reports manipulation, and a deterministic
 * engine decides what that means for this specific payment.
 */
export const MANIPULATION_LABELS = [
  'authority', // "I am calling from your bank / the police / the CBI"
  'coercion', // threat of loss: account freeze, arrest, legal action
  'urgency', // "immediately", "in the next 10 minutes", "do not disconnect"
  'financialInstruction', // an explicit instruction to move money
  'secrecy', // "do not tell your family", "do not discuss this with anyone"
  'credentialRequest', // asking for OTP / PIN / CVV / card number
] as const;

export type ManipulationLabel = (typeof MANIPULATION_LABELS)[number];

/** Raw multi-label classifier output: one probability per label. */
export type ManipulationScores = Record<ManipulationLabel, Confidence>;

export interface ConversationEvidence extends EvidenceBase {
  scores: ManipulationScores;

  /**
   * The classifier's own reliability for THIS window, in [0, 1]. Driven by
   * transcript length, ASR confidence and score dispersion. When this is low the
   * risk engine down-weights conversation evidence rather than guessing.
   */
  reliability: Confidence;

  /** Milliseconds of speech that produced this result. */
  windowMs: number;
  /** Number of tokens/characters the classifier actually saw. Short => unreliable. */
  transcriptChars: number;

  /**
   * Short verbatim spans that drove the top labels, for the "WHY?" screen.
   * Kept in memory only; never persisted and never uploaded by default.
   */
  evidenceSpans?: ConversationSpan[];

  /** e.g. "ruko-manip-v1". Recorded in the audit trail. */
  modelVersion: string;
  /** Actual runtime that executed this inference. Never hardcoded. */
  backend: InferenceBackend;
  /** Wall-clock inference latency in ms. Real measurement, for the eng screen. */
  latencyMs?: number;


  /**
   * Which kind of text the classifier actually read.
   *
   * Ruko's manipulation model does not care whether a sentence arrived down a
   * phone line or in a chat bubble -- it reads language, and the tactics are
   * identical. But the *user* cares, and so does the audit trail: "Ruko heard
   * this" and "Ruko read this in your messages" are different claims and must
   * never be shown as the same one.
   *
   * Absent means SPEECH, which is what every existing producer emits.
   */
  textSource?: 'SPEECH' | 'MESSAGES';
  detectedLanguage?: 'en' | 'hi' | 'hinglish' | 'unknown';
  timestamp: Timestamp;
}

export interface ConversationSpan {
  label: ManipulationLabel;
  text: string;
  score: Confidence;
}

/**
 * The execution provider that actually ran the model. This is reported by the
 * runtime, never assumed — claiming NPU acceleration without measuring it is
 * explicitly out of bounds for this project.
 */
export type InferenceBackend =
  | 'CPU'
  | 'NNAPI'
  | 'QNN'
  | 'XNNPACK'
  | 'HEURISTIC' // no neural model ran; deterministic lexical fallback
  | 'UNAVAILABLE';

export interface ModelInfo {
  modelVersion: string;
  /** sha256 of the model file that is actually loaded on this device. */
  modelHash: string;
  backend: InferenceBackend;
  /** What was requested vs. what the runtime actually gave us. */
  requestedBackend: InferenceBackend;
  loaded: boolean;
  sizeBytes?: number;
  quantization?: 'fp32' | 'fp16' | 'int8' | 'none';
  /** Median measured latency on THIS device, if a benchmark has been run. */
  measuredLatencyMsP50?: number;
  measuredLatencyMsP95?: number;
}

/**
 * The inference abstraction. Implementations: ONNX Runtime (CPU / NNAPI),
 * and a deterministic lexical fallback that is always available offline.
 */
export interface LocalRiskClassifier {
  loadModel(): Promise<ModelInfo>;
  classify(transcript: string): Promise<ConversationEvidence>;
  getModelInfo(): ModelInfo;
  dispose(): Promise<void>;
}

// ===== docs/contracts/payment.schema.ts =========================================
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

// ===== docs/contracts/risk.schema.ts ============================================
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

// ===== docs/contracts/investigation.schema.ts ===================================
/**
 * Ruko shared contracts — the investigation agent's trace.
 * Contract version: contracts-v1
 *
 * Ruko runs ONE investigation agent with several tools. The agent decides WHICH
 * evidence to gather; it does not decide what to do about it. The trace below is
 * both the live UI feed ("RUKO IS CHECKING...") and the audit record.
 *
 * Owner: Vedant.
 */



export const INVESTIGATION_STATES = [
  'IDLE',
  'MONITORING',
  'PAYMENT_WATCH',
  'INVESTIGATION',
  'INTERVENTION',
  'GUARDIAN_ESCALATION',
  'RESOLVED',
] as const;
export type InvestigationState = (typeof INVESTIGATION_STATES)[number];

export const TOOL_NAMES = [
  'conversationTool',
  'paymentTool',
  'payeeTool',
  'behaviourTool',
  'callContextTool',
  'notificationTool',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolResult<T = unknown> {
  tool: ToolName;
  ok: boolean;
  data: T | null;
  /** Present when ok === false. The agent continues; it never throws away the run. */
  error?: string;
  source: EvidenceSource;
  durationMs: number;
  timestamp: Timestamp;
}

/**
 * A tool the investigation agent can call. Tools are pure evidence gatherers:
 * they must not score, decide, or mutate app state.
 */
export interface InvestigationTool<T = unknown> {
  name: ToolName;
  description: string;
  /** Cheap tools run first. Used by the agent's scheduling. */
  cost: 'LOW' | 'MEDIUM' | 'HIGH';
  execute(context: InvestigationContext): Promise<ToolResult<T>>;
}

export interface InvestigationContext {
  sessionId: string;
  startedAt: Timestamp;
  /** Why the investigation was triggered at all. */
  trigger: InvestigationTrigger;
  /** Evidence gathered so far, so later tools can adapt. */
  collected: Partial<RiskEvidence>;
  /** Set when the user or the system aborts. Tools must respect it. */
  cancelled: boolean;
}

export type InvestigationTrigger =
  | 'PAYMENT_SCREEN_DETECTED'
  | 'CALL_DURING_PAYMENT'
  | 'SUSPICIOUS_CONVERSATION'
  | 'SUSPICIOUS_NOTIFICATION'
  | 'MANUAL'
  | 'DEMO';

/** One line in the live "RUKO IS CHECKING" feed and in the audit log. */
export interface TraceEntry {
  timestamp: Timestamp;
  seq: number;
  kind: 'STATE' | 'TOOL_START' | 'TOOL_RESULT' | 'FUSION' | 'RISK' | 'POLICY' | 'ERROR';
  /** One short line, already user-readable. e.g. "Recipient — first payment". */
  message: string;
  tool?: ToolName;
  /** Machine-readable detail for the engineering screen. */
  detail?: Record<string, unknown>;
}

export interface InvestigationResult {
  sessionId: string;
  trigger: InvestigationTrigger;
  state: InvestigationState;
  evidence: RiskEvidence;
  risk: RiskResult;
  trace: TraceEntry[];
  startedAt: Timestamp;
  completedAt: Timestamp;
  totalMs: number;
  /** Tools that failed. The investigation still completes, marked degraded. */
  failedTools: ToolName[];
}

export interface InvestigationAgent {
  investigate(
    trigger: InvestigationTrigger,
    onTrace?: (entry: TraceEntry) => void,
  ): Promise<InvestigationResult>;
}

// ===== docs/contracts/guardian.schema.ts ========================================
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

// ===== docs/contracts/providers.schema.ts =======================================
/**
 * Ruko shared contracts — device context providers and the mobile service
 * container.
 * Contract version: contracts-v1.1 (additive)
 *
 * PROPOSED BY: Aishwarya (mobile). The *implementations* of the device
 * providers belong to Puneesh (Android) and Vedant (classifier / risk / agent);
 * this file only fixes the shape the mobile layer subscribes to, so the UI can
 * be built and tested before the native layer exists.
 *
 * Puneesh / Vedant: if a signature here does not fit what Android or the
 * runtime can actually give us, change it and add a CHANGELOG entry — this is a
 * proposal, not a decree. Nothing in `mobile/src/screens` touches a provider
 * directly; everything goes through `RukoServices` below, so a change here
 * costs one adapter, not twenty screens.
 */







export type Unsubscribe = () => void;

/**
 * Every provider reports how it obtained its data and stays subscribable.
 * `read()` is a one-shot for the investigation agent's tools; `subscribe()` is
 * what keeps the UI live.
 */
export interface ContextProvider<T> {
  readonly source: EvidenceSource;
  read(): Promise<T>;
  subscribe(listener: (value: T) => void): Unsubscribe;
}

export type CallContextProvider = ContextProvider<CallEvidence>;
export type PaymentContextProvider = ContextProvider<PaymentEvidence>;
export type NotificationContextProvider = ContextProvider<NotificationEvidence>;

/**
 * A protected listening session. Audio is processed in RAM and discarded;
 * only derived ConversationEvidence crosses this boundary.
 */
export interface ConversationProvider {
  readonly source: EvidenceSource;
  start(sessionId: string): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  read(): Promise<ConversationEvidence>;
  subscribe(listener: (value: ConversationEvidence) => void): Unsubscribe;
}

/** Local-only behaviour + payee history. Never leaves the device. */
export interface BehaviourStore {
  readonly source: EvidenceSource;
  getBehaviour(amountMinor: number | null): Promise<BehaviourEvidence>;
  getPayee(payeeHash: string | null): Promise<PayeeEvidence>;
  listTransactions(limit?: number): Promise<TransactionRecord[]>;
  recordTransaction(tx: TransactionRecord): Promise<void>;
  /** Used by the demo to seed a realistic history. Test/demo builds only. */
  seed(transactions: TransactionRecord[]): Promise<void>;
}

/**
 * What the engineering screen shows. Every field is a measurement or an
 * explicit "unknown" — nothing here may be hardcoded for a demo.
 */
export interface EngineDiagnostics {
  classifier: ModelInfo;
  asr: {
    available: boolean;
    local: boolean;
    modelVersion: string | null;
    backend: InferenceBackend;
    lastLatencyMs: number | null;
  };
  riskEngine: { engineVersion: string; weightsVersion: string; policyVersion: string };
  /** True when the device has no network. Core protection does not need one. */
  offline: boolean;
  deviceModel: string | null;
  lastUpdated: Timestamp;
}

export interface DiagnosticsProvider {
  read(): Promise<EngineDiagnostics>;
  subscribe(listener: (value: EngineDiagnostics) => void): Unsubscribe;
}

/**
 * Everything the mobile app depends on, injected in one place
 * (`mobile/src/services/createServices.ts`). Swapping a stub for a real
 * implementation is a one-line change there; no screen knows the difference.
 */
export interface RukoServices {
  call: CallContextProvider;
  payment: PaymentContextProvider;
  notification: NotificationContextProvider;
  conversation: ConversationProvider;
  behaviour: BehaviourStore;
  risk: RiskEngine;
  agent: InvestigationAgent;
  guardian: GuardianChannel;
  diagnostics: DiagnosticsProvider;
}
