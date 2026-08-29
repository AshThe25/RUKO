/**
 * GENERATED FILE -- DO NOT EDIT.
 * Written by ml/export/export_onnx.py from the measured export artefacts.
 *
 * Everything here is a measurement, not a guess: the thresholds are the ones
 * calibrated on the validation split, the fusion weight is the ensemble rule
 * that won on validation, and the hash is of the model file that was evaluated.
 */

import type { ManipulationLabel } from '../../contracts/index.ts';

export const MODEL_VERSION = 'ruko-manip-v1';
export const MODEL_FILE = 'model_int8.onnx';
export const MODEL_MAX_LENGTH = 64;

/** sha256 of the int8 model that these thresholds were evaluated against. */
export const EXPECTED_MODEL_SHA256 =
  '2e30251f4a35460300645d54da7b66875eca0b259c02ba2de199c52d638a13aa';
export const MODEL_SIZE_BYTES = 22872082;
export const VOCAB_SHA256 = '07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3';

/**
 * Per-label decision thresholds. These are the point at which a label is
 * considered present; the classifier rescales around them so the risk engine
 * always sees 0.5 as "on the fence".
 */
export const LABEL_THRESHOLDS: Record<ManipulationLabel, number> = {
  authority: 0.38,
  coercion: 0.76,
  urgency: 0.2,
  financialInstruction: 0.43,
  secrecy: 0.66,
  credentialRequest: 0.26,
};

/**
 * Ensemble weight on the neural score; the remainder goes to the lexicon.
 * Selected on the validation split; see the model directory's evaluation.json.
 */
export const NEURAL_FUSION_WEIGHT = 0.5;
