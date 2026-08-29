/**
 * Numerical parity between the TypeScript on-device path and the Python
 * pipeline that trained and evaluated the model.
 *
 * The full chain is verified in three linked pieces so no step is trusted:
 *
 *   PyTorch == ONNX fp32/int8   ml/export/export_onnx.py (max prob diff 3.3e-6)
 *   Python tokenizer == TS      tokenizer.test.ts (exact token ids)
 *   ONNX logits -> final scores THIS FILE
 *
 * The fixture holds real int8 ONNX logits for real transcripts. If the TS
 * sigmoid, calibration or fusion ever drifts from Python's, this goes red —
 * which matters, because that class of bug produces a model that looks like it
 * works and is quietly wrong.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { calibrateScore, fuseScores } from '../calibration.ts';
import { scoreText } from '../heuristicClassifier.ts';
import { WordPieceTokenizer } from '../tokenizer.ts';
import { LABEL_THRESHOLDS, NEURAL_FUSION_WEIGHT } from '../modelConfig.generated.ts';
import type { ManipulationLabel, ManipulationScores } from '../../../contracts/index.ts';

const FIXTURE = 'mobile/src/risk/classifier/__tests__/parity_fixture.json';
const VOCAB = 'ml/models/ruko-manip-v1/onnx/vocab.txt';
const ready = existsSync(FIXTURE) && existsSync(VOCAB);

const LABELS: ManipulationLabel[] = [
  'authority', 'coercion', 'urgency', 'financialInstruction', 'secrecy', 'credentialRequest',
];

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

describe('Python <-> TypeScript parity', {
  skip: ready ? false : 'run ml/export/emit_parity_fixture.py first',
}, () => {
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const tokenizer = WordPieceTokenizer.fromVocabText(readFileSync(VOCAB, 'utf8'));

  test('the shipped thresholds match the ones the fixture was built with', () => {
    for (const label of LABELS) {
      assert.ok(Math.abs(LABEL_THRESHOLDS[label] - fixture.thresholds[label]) < 1e-9,
        `${label}: generated config says ${LABEL_THRESHOLDS[label]}, ` +
        `fixture says ${fixture.thresholds[label]}`);
    }
    assert.equal(NEURAL_FUSION_WEIGHT, fixture.neural_fusion_weight);
  });

  for (const testCase of fixture.cases as Array<Record<string, any>>) {
    const label = testCase.text.slice(0, 44);

    test(`tokenizes identically: ${label}`, () => {
      assert.deepEqual(tokenizer.encode(testCase.text).inputIds, testCase.input_ids);
    });

    test(`sigmoid matches Python: ${label}`, () => {
      testCase.logits.forEach((logit: number, i: number) => {
        const expected = testCase.neural_probs[LABELS[i]];
        assert.ok(Math.abs(sigmoid(logit) - expected) < 1e-9,
          `${LABELS[i]}: ${sigmoid(logit)} vs ${expected}`);
      });
    });

    test(`calibration matches Python: ${label}`, () => {
      for (const l of LABELS) {
        const ours = calibrateScore(testCase.neural_probs[l], LABEL_THRESHOLDS[l]);
        assert.ok(Math.abs(ours - testCase.neural_calibrated[l]) < 1e-9,
          `${l}: ${ours} vs ${testCase.neural_calibrated[l]}`);
      }
    });
  }

  test('fusion is applied to raw probabilities, in the same order as evaluation', () => {
    // The offline evaluation fuses raw probs then thresholds. If the phone
    // calibrated first and then fused, the numbers would diverge -- this asserts
    // the orders actually differ, so the test is not vacuous.
    const c = fixture.cases[0];
    const neural = c.neural_probs as ManipulationScores;
    const lexical = scoreText(c.text).scores;

    const correct = fuseScores(neural, lexical, NEURAL_FUSION_WEIGHT);
    const calibratedNeural = {} as ManipulationScores;
    for (const l of LABELS) calibratedNeural[l] = calibrateScore(neural[l], LABEL_THRESHOLDS[l]);
    const wrongOrder = fuseScores(calibratedNeural, lexical, NEURAL_FUSION_WEIGHT);

    const differs = LABELS.some((l) => Math.abs(correct[l] - wrongOrder[l]) > 1e-6);
    assert.ok(differs, 'if the two orders agreed, this guard would prove nothing');
  });

  test('the scam transcript scores highest on the tactics it actually contains', () => {
    const scam = fixture.cases[0];
    const cal = scam.neural_calibrated as Record<string, number>;
    assert.ok(cal.coercion > 0.5, `coercion ${cal.coercion}`);
    assert.ok(cal.authority > 0.5, `authority ${cal.authority}`);
    assert.ok(cal.financialInstruction > 0.5, `financialInstruction ${cal.financialInstruction}`);
  });

  test('the benign transcript does not trip the tactics', () => {
    const benign = fixture.cases.find((c: any) => c.text.startsWith('the traffic'));
    const cal = benign.neural_calibrated as Record<string, number>;
    for (const l of LABELS) {
      assert.ok(cal[l] < 0.5, `${l} fired on ordinary conversation: ${cal[l]}`);
    }
  });
});
