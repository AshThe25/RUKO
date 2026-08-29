/**
 * The deterministic fallback classifier.
 *
 * Implements the same `LocalRiskClassifier` interface as the ONNX model, so the
 * rest of the product cannot tell them apart structurally — but it reports
 * `backend: 'HEURISTIC'` and `modelVersion: 'ruko-heuristic-v1'`, and the
 * engineering screen shows that verbatim. This is never presented as neural
 * inference.
 *
 * Ruko uses it when:
 *   - the ONNX model has not loaded yet (first launch, model still unpacking)
 *   - the model failed to load on this device
 *   - a build is running without the model bundled
 *
 * It runs offline, needs no model file, and takes well under a millisecond.
 */

import type {
  ConversationEvidence, ConversationSpan, LocalRiskClassifier,
  ManipulationLabel, ManipulationScores, ModelInfo,
} from '../../contracts/index.ts';
import { BENIGN_CONTEXT, LEXICON } from './lexicon.ts';

export const HEURISTIC_VERSION = 'ruko-heuristic-v1';

const LABELS: ManipulationLabel[] = [
  'authority', 'coercion', 'urgency', 'financialInstruction', 'secrecy', 'credentialRequest',
];

/** Match the ASR normalisation used to build the training data. */
export function normalise(text: string): string {
  return text.toLowerCase().replace(/[^\w\s@.]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Reliability: how much this window is worth listening to at all.
 *
 * Short windows are the main source of nonsense — "account number please" is
 * three words and could be anything. The curve reaches 1.0 at roughly 25 words,
 * which is about eight seconds of speech.
 */
export function windowReliability(text: string, asrConfidence = 1): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words < 4) return 0;
  const lengthTerm = Math.min(1, (words - 3) / 22);
  return Math.max(0, Math.min(1, lengthTerm * Math.max(0, Math.min(1, asrConfidence))));
}

/**
 * Combine independent pieces of evidence with a noisy-OR, not a sum.
 *
 *   combined = 1 - prod(1 - w_i)
 *
 * Two weak-but-independent matches should raise confidence; ten of them should
 * still not exceed certainty. A plain sum would saturate on repetition alone —
 * a caller who says "immediately" four times would score 1.0 on urgency purely
 * for repeating themselves.
 */
function noisyOr(weights: number[]): number {
  let residual = 1;
  for (const w of weights) residual *= 1 - Math.max(0, Math.min(1, w));
  return 1 - residual;
}

export interface HeuristicResult {
  scores: ManipulationScores;
  spans: ConversationSpan[];
  benignContext: boolean;
}

export function scoreText(text: string): HeuristicResult {
  const norm = normalise(text);
  const benignContext = BENIGN_CONTEXT.some((re) => re.test(norm));

  const scores = {} as ManipulationScores;
  const spans: ConversationSpan[] = [];

  for (const label of LABELS) {
    const hits: number[] = [];
    for (const { re, w } of LEXICON[label]) {
      const m = norm.match(re);
      if (!m) continue;
      hits.push(w);
      spans.push({ label, text: m[0].trim().slice(0, 90), score: w });
    }
    let score = noisyOr(hits);

    // Fraud-awareness advice, surprise parties and "never share your OTP" all
    // use the same vocabulary as the attack. When the window is explicitly
    // benign, cut the tactic labels hard rather than firing on the keywords.
    if (benignContext && (label === 'credentialRequest' || label === 'secrecy')) {
      score *= 0.15;
    }
    scores[label] = Number(score.toFixed(4));
  }

  spans.sort((a, b) => b.score - a.score);
  return { scores, spans: spans.slice(0, 6), benignContext };
}

/**
 * The fallback classifier. Deliberately async and stateful in the same shape as
 * the ONNX one so swapping between them is a one-line change at the call site.
 */
export class HeuristicClassifier implements LocalRiskClassifier {
  private loaded = false;

  async loadModel(): Promise<ModelInfo> {
    this.loaded = true;
    return this.getModelInfo();
  }

  getModelInfo(): ModelInfo {
    return {
      modelVersion: HEURISTIC_VERSION,
      // No model file exists, so there is nothing to hash. Reporting a fake
      // hash here would be exactly the kind of dishonesty this project bans.
      modelHash: 'n/a-no-model-file',
      backend: 'HEURISTIC',
      requestedBackend: 'HEURISTIC',
      loaded: this.loaded,
      quantization: 'none',
    };
  }

  async classify(transcript: string, asrConfidence = 1): Promise<ConversationEvidence> {
    const startedAt = Date.now();
    const text = transcript ?? '';
    const reliability = windowReliability(normalise(text), asrConfidence);
    const { scores, spans } = scoreText(text);

    return {
      available: true,
      source: 'ON_DEVICE_HEURISTIC',
      scores,
      reliability,
      windowMs: 0,
      transcriptChars: text.length,
      evidenceSpans: spans,
      modelVersion: HEURISTIC_VERSION,
      backend: 'HEURISTIC',
      latencyMs: Date.now() - startedAt,
      detectedLanguage: detectLanguage(text),
      timestamp: Date.now(),
    };
  }

  async dispose(): Promise<void> {
    this.loaded = false;
  }
}

/**
 * Crude script/vocabulary check, used only for display and for choosing an ASR
 * provider. Not a claim of real language identification.
 */
export function detectLanguage(text: string): 'en' | 'hi' | 'hinglish' | 'unknown' {
  if (!text.trim()) return 'unknown';
  if (/[ऀ-ॿ]/.test(text)) return 'hi';
  const markers = /\b(hai|hain|kar|kijiye|nahi|aap|mera|aapka|bhej|paisa|abhi|jaldi|mat|bata|karo|ho|ka|ki|ke|me|se|ye|wo)\b/g;
  const hits = (text.toLowerCase().match(markers) ?? []).length;
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words >= 4 && hits / words > 0.12) return 'hinglish';
  return 'en';
}
