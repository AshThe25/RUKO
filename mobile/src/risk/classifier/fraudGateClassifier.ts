/**
 * Binary fraud gate: WordPiece -> ONNX -> sigmoid -> P(suspected fraud).
 *
 * WHAT THIS IS NOT. It is not a seventh manipulation tactic and its output must
 * not be fed to the risk engine as one. The engine scores six tactics and its
 * corroboration rule needs two independent evidence families; a single binary
 * score satisfies neither. Wire it, if at all, as bounded corroborating
 * evidence in the shape of notificationSuspicion — capped, and never able to
 * reach CRITICAL on its own.
 *
 * WHY IT EXISTS. `ruko-manip-v1` is trained on synthetic templates because no
 * public corpus carries per-tactic labels. This model is the opposite trade:
 * all-real human text (FTC/NCSU robocalls, NCSU SMS phishing, IMC'25 smishing,
 * BPO transcripts, UCI ham) but only one label. It answers "is this fraud?"
 * very well and "why?" not at all.
 *
 * ⚠️ CALIBRATION WARNING. The reported 0.9858 test F1 was measured on the fp32
 * checkpoint. Dynamic int8 quantisation moved a borderline probe case from
 * 0.546 to 0.425 — across the 0.46 threshold, flipping the decision. The int8
 * artefact this class loads has NOT been re-evaluated. Treat its probability as
 * indicative until ml/evaluation is re-run against the quantised model.
 */

import type { InferenceBackend, ModelInfo } from '../../contracts/index.ts';
import type { OnnxRuntimeAdapter, OnnxSession } from './runtime.ts';
import { WordPieceTokenizer } from './tokenizer.ts';

/** Artefacts from ml/models/ruko-real-multisource-v1/onnx/. */
export const GATE_MODEL_VERSION = 'ruko-real-multisource-v1';
export const GATE_MODEL_FILE = 'fraud_gate_int8.onnx';
export const GATE_MODEL_SHA256 =
  '0583855ed39e82ab7024ca42605325e9559ee3a1af38f9657db51fdb8cb79646';
export const GATE_MODEL_SIZE_BYTES = 22900722;
export const GATE_MAX_LENGTH = 64;

/** Fitted on the validation split only. Never tuned on test or the holdout. */
export const GATE_THRESHOLD = 0.46;

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

export interface FraudGateResult {
  /** P(suspected fraud) in [0, 1]. */
  probability: number;
  /** probability >= GATE_THRESHOLD. */
  flagged: boolean;
  latencyMs: number;
  modelVersion: string;
}

export interface FraudGateOptions {
  adapter: OnnxRuntimeAdapter;
  modelPath: string;
  vocabPath: string;
  backendPreference?: InferenceBackend[];
}

export class FraudGateClassifier {
  private session: OnnxSession | null = null;
  private tokenizer: WordPieceTokenizer | null = null;
  private info: ModelInfo;
  private readonly options: FraudGateOptions;
  private readonly preference: InferenceBackend[];
  private latencies: number[] = [];

  constructor(options: FraudGateOptions) {
    this.options = options;
    this.preference = options.backendPreference ?? ['NNAPI', 'XNNPACK', 'CPU'];
    this.info = {
      modelVersion: GATE_MODEL_VERSION,
      modelHash: `unverified:${GATE_MODEL_SHA256}`,
      backend: 'UNAVAILABLE',
      requestedBackend: this.preference[0],
      loaded: false,
      sizeBytes: GATE_MODEL_SIZE_BYTES,
      quantization: 'int8',
    };
  }

  async loadModel(): Promise<ModelInfo> {
    const { adapter, modelPath, vocabPath } = this.options;

    const vocabText = await adapter.readTextAsset(vocabPath);
    this.tokenizer = WordPieceTokenizer.fromVocabText(vocabText, { maxLength: GATE_MAX_LENGTH });

    const handle = await adapter.createSession(modelPath, this.preference);
    this.session = handle.session;

    // Same rule as OnnxClassifier: verify if the platform can, and say
    // `unverified:` rather than echoing the expected hash as if it checked.
    let modelHash = `unverified:${GATE_MODEL_SHA256}`;
    if (adapter.sha256File) {
      const actual = await adapter.sha256File(modelPath);
      if (actual) {
        if (actual !== GATE_MODEL_SHA256) {
          await this.dispose();
          throw new Error(
            `fraud gate hash mismatch: expected ${GATE_MODEL_SHA256}, got ${actual}. ` +
            'The threshold shipped with this build was calibrated against a ' +
            'different model, so its score cannot be trusted.',
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

  async score(text: string): Promise<FraudGateResult> {
    if (!this.session || !this.tokenizer) {
      throw new Error('FraudGateClassifier.loadModel() must succeed before score()');
    }

    const encoding = this.tokenizer.encode(text);
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

    // Exported with output_names=['logit'], shape [batch, 1].
    const logit = outputs.logit ?? Object.values(outputs)[0];
    if (!logit || logit.data.length < 1) {
      throw new Error(`fraud gate returned ${logit?.data.length ?? 0} outputs, expected 1`);
    }

    const probability = sigmoid(Number(logit.data[0]));
    return {
      probability,
      flagged: probability >= GATE_THRESHOLD,
      latencyMs,
      modelVersion: GATE_MODEL_VERSION,
    };
  }

  async dispose(): Promise<void> {
    await this.session?.release?.();
    this.session = null;
    this.tokenizer = null;
    this.info = { ...this.info, loaded: false, backend: 'UNAVAILABLE' };
  }
}
