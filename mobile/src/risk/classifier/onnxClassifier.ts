/**
 * On-device neural classifier: WordPiece tokenizer -> ONNX Runtime -> sigmoid
 * -> calibrated ManipulationScores.
 *
 * Honesty rules this file enforces:
 *   - `backend` is whatever the runtime reports it actually used. Requesting
 *     NNAPI and silently getting CPU is common; Ruko shows the real answer.
 *   - `modelHash` is either a genuinely computed sha256 or is prefixed
 *     `unverified:`. It never repeats the expected hash as though it checked.
 *   - `latencyMs` is measured per inference, not estimated.
 *   - If anything fails, `loadModel` throws and the caller falls back to the
 *     lexicon. A half-loaded model that returns zeros would be far worse than a
 *     visible fallback, because it looks like "no manipulation detected".
 */

import type {
  ConversationEvidence, LocalRiskClassifier, ManipulationLabel,
  ManipulationScores, ModelInfo, InferenceBackend,
} from '../../contracts/index.ts';
import { calibrateScores } from './calibration.ts';
import { detectLanguage, windowReliability, normalise } from './heuristicClassifier.ts';
import {
  EXPECTED_MODEL_SHA256, MODEL_MAX_LENGTH, MODEL_SIZE_BYTES, MODEL_VERSION,
} from './modelConfig.generated.ts';
import type { OnnxRuntimeAdapter, OnnxSession } from './runtime.ts';
import { WordPieceTokenizer } from './tokenizer.ts';

const LABELS: ManipulationLabel[] = [
  'authority', 'coercion', 'urgency', 'financialInstruction', 'secrecy', 'credentialRequest',
];

/** Priority order. The runtime decides which it can honour; we report the truth. */
export const DEFAULT_BACKEND_PREFERENCE: InferenceBackend[] = ['NNAPI', 'XNNPACK', 'CPU'];

export interface OnnxClassifierOptions {
  adapter: OnnxRuntimeAdapter;
  modelPath: string;
  vocabPath: string;
  backendPreference?: InferenceBackend[];
  /** Set false to get raw model probabilities. Only the engineering screen does. */
  calibrate?: boolean;
}

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

export class OnnxClassifier implements LocalRiskClassifier {
  private session: OnnxSession | null = null;
  private tokenizer: WordPieceTokenizer | null = null;
  private info: ModelInfo;
  private readonly options: OnnxClassifierOptions;
  private readonly preference: InferenceBackend[];
  private latencies: number[] = [];

  constructor(options: OnnxClassifierOptions) {
    this.options = options;
    this.preference = options.backendPreference ?? DEFAULT_BACKEND_PREFERENCE;
    this.info = {
      modelVersion: MODEL_VERSION,
      modelHash: `unverified:${EXPECTED_MODEL_SHA256}`,
      backend: 'UNAVAILABLE',
      requestedBackend: this.preference[0],
      loaded: false,
      sizeBytes: MODEL_SIZE_BYTES,
      quantization: 'int8',
    };
  }

  async loadModel(): Promise<ModelInfo> {
    const { adapter, modelPath, vocabPath } = this.options;

    const vocabText = await adapter.readTextAsset(vocabPath);
    this.tokenizer = WordPieceTokenizer.fromVocabText(vocabText, { maxLength: MODEL_MAX_LENGTH });

    const handle = await adapter.createSession(modelPath, this.preference);
    this.session = handle.session;

    // Verify the file if the platform can; otherwise say so rather than lie.
    let modelHash = `unverified:${EXPECTED_MODEL_SHA256}`;
    if (adapter.sha256File) {
      const actual = await adapter.sha256File(modelPath);
      if (actual) {
        if (actual !== EXPECTED_MODEL_SHA256) {
          await this.dispose();
          throw new Error(
            `model file hash mismatch: expected ${EXPECTED_MODEL_SHA256}, got ${actual}. ` +
            'The thresholds shipped with this build were calibrated against a ' +
            'different model, so its scores cannot be trusted.',
          );
        }
        modelHash = actual;
      }
    }

    this.info = {
      ...this.info,
      modelHash,
      backend: handle.backend,
      requestedBackend: this.preference[0],
      loaded: true,
    };
    return this.info;
  }

  getModelInfo(): ModelInfo {
    if (this.latencies.length === 0) return this.info;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    return {
      ...this.info,
      measuredLatencyMsP50: Number(sorted[Math.floor(sorted.length / 2)].toFixed(2)),
      measuredLatencyMsP95: Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(2)),
    };
  }

  /** Raw model probabilities, before calibration. Used by the ensemble. */
  async rawProbabilities(transcript: string): Promise<{ scores: ManipulationScores; latencyMs: number }> {
    if (!this.session || !this.tokenizer) {
      throw new Error('OnnxClassifier.loadModel() must succeed before classify()');
    }
    const encoding = this.tokenizer.encode(transcript);
    const len = encoding.inputIds.length;
    const feeds = {
      input_ids: this.options.adapter.int64Tensor(encoding.inputIds, [1, len]),
      attention_mask: this.options.adapter.int64Tensor(encoding.attentionMask, [1, len]),
    };

    const startedAt = Date.now();
    const outputs = await this.session.run(feeds);
    const latencyMs = Date.now() - startedAt;
    this.latencies.push(latencyMs);
    if (this.latencies.length > 200) this.latencies.shift();

    const logits = outputs.logits ?? Object.values(outputs)[0];
    if (!logits || logits.data.length < LABELS.length) {
      throw new Error(`model returned ${logits?.data.length ?? 0} outputs, expected ${LABELS.length}`);
    }

    const scores = {} as ManipulationScores;
    LABELS.forEach((label, i) => {
      scores[label] = sigmoid(Number(logits.data[i]));
    });
    return { scores, latencyMs };
  }

  async classify(transcript: string, asrConfidence = 1): Promise<ConversationEvidence> {
    const text = transcript ?? '';
    const { scores, latencyMs } = await this.rawProbabilities(text);
    return {
      available: true,
      source: 'ON_DEVICE_MODEL',
      scores: this.options.calibrate === false ? scores : calibrateScores(scores),
      reliability: windowReliability(normalise(text), asrConfidence),
      windowMs: 0,
      transcriptChars: text.length,
      modelVersion: this.info.modelVersion,
      backend: this.info.backend,
      latencyMs,
      detectedLanguage: detectLanguage(text),
      timestamp: Date.now(),
    };
  }

  async dispose(): Promise<void> {
    await this.session?.release();
    this.session = null;
    this.tokenizer = null;
    this.info = { ...this.info, loaded: false, backend: 'UNAVAILABLE' };
  }
}
