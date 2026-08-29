/**
 * The classifier Ruko actually ships: the neural model and the lexicon, fused.
 *
 * They are complementary, and the numbers say so. Measured on the hand-authored
 * holdout (ml/models/ruko-manip-v1/evaluation.json):
 *
 *     lexicon only     macro F1 0.508   precision 0.941   recall 0.387
 *     neural int8      macro F1 0.621   precision 0.638   recall 0.597
 *     ensemble int8    macro F1 0.631   precision 0.692   recall 0.597
 *
 * The lexicon is very precise but only catches phrasings someone anticipated.
 * The model generalises further but is looser. Fusing recovers precision without
 * giving up the model's coverage.
 *
 * The fusion rule and weight were selected on the VALIDATION split and the
 * holdout was scored once with that choice fixed.
 */

import type {
  ConversationEvidence, LocalRiskClassifier, ModelInfo,
} from '../../contracts/index.ts';
import { calibrateScores, fuseScores } from './calibration.ts';
import { HeuristicClassifier, detectLanguage, normalise, windowReliability } from './heuristicClassifier.ts';
import { NEURAL_FUSION_WEIGHT } from './modelConfig.generated.ts';
import type { OnnxClassifier } from './onnxClassifier.ts';
import { scoreText } from './heuristicClassifier.ts';

export class EnsembleClassifier implements LocalRiskClassifier {
  private readonly neural: OnnxClassifier;
  private readonly weight: number;

  constructor(neural: OnnxClassifier, neuralWeight: number = NEURAL_FUSION_WEIGHT) {
    this.neural = neural;
    this.weight = neuralWeight;
  }

  async loadModel(): Promise<ModelInfo> {
    return this.neural.loadModel();
  }

  getModelInfo(): ModelInfo {
    const info = this.neural.getModelInfo();
    return { ...info, modelVersion: `${info.modelVersion}+lexicon` };
  }

  async classify(transcript: string, asrConfidence = 1): Promise<ConversationEvidence> {
    const text = transcript ?? '';
    const startedAt = Date.now();
    const { scores: neuralRaw } = await this.neural.rawProbabilities(text);
    const { scores: lexicalRaw, spans } = scoreText(text);

    // Fuse raw, then calibrate -- the same order as the offline evaluation, so
    // the phone computes exactly what was measured.
    const fused = fuseScores(neuralRaw, lexicalRaw, this.weight);
    const info = this.neural.getModelInfo();

    return {
      available: true,
      source: 'ON_DEVICE_MODEL',
      scores: calibrateScores(fused),
      reliability: windowReliability(normalise(text), asrConfidence),
      windowMs: 0,
      transcriptChars: text.length,
      evidenceSpans: spans,
      modelVersion: `${info.modelVersion}+lexicon`,
      backend: info.backend,
      latencyMs: Date.now() - startedAt,
      detectedLanguage: detectLanguage(text),
      timestamp: Date.now(),
    };
  }

  async dispose(): Promise<void> {
    await this.neural.dispose();
  }
}

export { HeuristicClassifier };
