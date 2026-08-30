/**
 * Ruko shared contracts — conversation evidence.
 * Contract version: contracts-v1
 *
 * Produced by: the on-device manipulation classifier (ml/ + mobile/src/risk/classifier).
 * Consumed by: the deterministic risk engine, the live investigation UI.
 *
 * Owner: Vedant.
 */

import type { Confidence, EvidenceBase, Timestamp } from './common.schema';

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
