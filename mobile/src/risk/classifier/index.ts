/**
 * Classifier selection.
 *
 * Ruko tries the ensemble (neural model + lexicon) and falls back to the lexicon
 * alone if the model cannot be loaded on this device. The fallback is reported
 * honestly — `backend: 'HEURISTIC'` — everywhere it appears, and the reason for
 * the fallback is returned to the caller so the engineering screen can show it.
 */

import type { LocalRiskClassifier } from '../../contracts/index.ts';
import { EnsembleClassifier } from './ensembleClassifier.ts';
import { HeuristicClassifier } from './heuristicClassifier.ts';
import { OnnxClassifier } from './onnxClassifier.ts';
import type { OnnxClassifierOptions } from './onnxClassifier.ts';

export { HeuristicClassifier, scoreText, windowReliability, detectLanguage, normalise } from './heuristicClassifier.ts';
export { OnnxClassifier, DEFAULT_BACKEND_PREFERENCE } from './onnxClassifier.ts';
export { EnsembleClassifier } from './ensembleClassifier.ts';
export { WordPieceTokenizer } from './tokenizer.ts';
export { calibrateScore, calibrateScores, fuseScores } from './calibration.ts';
export { backendFromProvider } from './runtime.ts';
export type { OnnxRuntimeAdapter, OnnxSession, SessionHandle } from './runtime.ts';
export * from './modelConfig.generated.ts';

export interface ClassifierSelection {
  classifier: LocalRiskClassifier;
  /** True when the neural model loaded. False means the lexicon is running. */
  neural: boolean;
  /** Present when the neural model was tried and failed. Shown in diagnostics. */
  fallbackReason?: string;
}

/**
 * Build the best classifier this device can run.
 *
 * Pass no options — or options for a device with no bundled model — and you get
 * the lexicon, which always works. Never throws: a classifier failing to load
 * must degrade Ruko, not break it.
 */
export async function createClassifier(
  options?: OnnxClassifierOptions,
): Promise<ClassifierSelection> {
  if (!options) {
    const classifier = new HeuristicClassifier();
    await classifier.loadModel();
    return { classifier, neural: false, fallbackReason: 'no model configured for this build' };
  }

  const onnx = new OnnxClassifier(options);
  try {
    await onnx.loadModel();
    return { classifier: new EnsembleClassifier(onnx), neural: true };
  } catch (err) {
    const classifier = new HeuristicClassifier();
    await classifier.loadModel();
    return {
      classifier,
      neural: false,
      fallbackReason: err instanceof Error ? err.message : String(err),
    };
  }
}
