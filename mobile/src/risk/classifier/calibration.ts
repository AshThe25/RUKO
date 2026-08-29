/**
 * Turn raw model probabilities into the calibrated signals the risk engine
 * expects.
 *
 * THE PROBLEM: the risk engine multiplies each signal by a weight, so it reads
 * a score of 0.5 as "half of the evidence for this tactic". But the model's
 * per-label decision boundary is not 0.5 — it is the threshold calibrated on the
 * validation split, which is 0.20 for authority and 0.49 for credentialRequest.
 * Feeding raw probabilities straight in would make authority evidence count for
 * far too little and skew every score in the product.
 *
 * THE FIX: a piecewise-linear rescale that maps each label's own threshold onto
 * 0.5, keeping 0 at 0 and 1 at 1 and staying monotonic. After this, "0.5 means
 * on the fence" is true for every label, and the weights in weights.ts mean what
 * they say.
 */

import type { ManipulationLabel, ManipulationScores } from '../../contracts/index.ts';
import { LABEL_THRESHOLDS } from './modelConfig.generated.ts';

export function calibrateScore(probability: number, threshold: number): number {
  const p = Number.isFinite(probability) ? Math.min(1, Math.max(0, probability)) : 0;
  const t = Math.min(0.999, Math.max(0.001, threshold));
  return p < t ? 0.5 * (p / t) : 0.5 + 0.5 * ((p - t) / (1 - t));
}

export function calibrateScores(
  raw: ManipulationScores,
  thresholds: Record<ManipulationLabel, number> = LABEL_THRESHOLDS,
): ManipulationScores {
  const out = {} as ManipulationScores;
  for (const label of Object.keys(raw) as ManipulationLabel[]) {
    out[label] = Number(calibrateScore(raw[label], thresholds[label]).toFixed(4));
  }
  return out;
}

/**
 * Fuse the neural and lexical scores using the weight that won on the
 * validation split. Fusion happens on RAW probabilities, then the result is
 * calibrated — the same order used in ml/evaluation/evaluate.py, so the phone
 * computes exactly what was measured.
 */
export function fuseScores(
  neural: ManipulationScores,
  lexical: ManipulationScores,
  neuralWeight: number,
): ManipulationScores {
  const w = Math.min(1, Math.max(0, neuralWeight));
  const out = {} as ManipulationScores;
  for (const label of Object.keys(neural) as ManipulationLabel[]) {
    out[label] = w * neural[label] + (1 - w) * (lexical[label] ?? 0);
  }
  return out;
}
