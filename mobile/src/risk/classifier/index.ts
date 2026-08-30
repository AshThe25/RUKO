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
import { FraudGateClassifier, type FraudGateOptions } from './fraudGateClassifier.ts';
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

/**
 * Build the binary fraud gate, or null if this device cannot run it.
 *
 * Deliberately a SEPARATE factory from createClassifier. The gate is not part
 * of the six-tactic pipeline and must not be able to affect it: if the gate
 * fails to load, createClassifier is untouched and Ruko keeps working exactly
 * as before. Never throws, for the same reason as above — an optional model
 * failing to load must degrade a feature, not break the app.
 *
 * The caller decides what to do with the score. It is NOT a seventh tactic:
 * feed it to the risk engine only as bounded corroborating evidence, in the
 * shape of notificationSuspicion, never able to reach CRITICAL alone.
 *
 * Measured on the quantised artefact this loads (ml/models/
 * ruko-real-multisource-v1/evaluation_int8.json): F1 0.9915, precision 0.9953,
 * recall 0.9878 on 1,501 held-out real messages.
 */
export async function createFraudGate(
  options?: FraudGateOptions,
): Promise<{ gate: FraudGateClassifier | null; reason?: string }> {
  if (!options) return { gate: null, reason: 'no fraud gate configured for this build' };

  const gate = new FraudGateClassifier(options);
  try {
    await gate.loadModel();
    return { gate };
  } catch (err) {
    return { gate: null, reason: err instanceof Error ? err.message : String(err) };
  }
}
