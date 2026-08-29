/**
 * REAL INFERENCE: the actual `OnnxClassifier` running the actual exported
 * `model_int8.onnx`, end to end, in TypeScript.
 *
 * Every other test in this directory either replays recorded numbers or uses a
 * fake runtime. This one loads the 22.9 MB model file, tokenizes real
 * transcripts with the real tokenizer, runs real inference, and checks the
 * output against the numbers Python produced for the same inputs.
 *
 * It covers the last gap the fake-runtime tests structurally cannot: whether
 * the classifier assembles a genuine session correctly — int64 tensor dtypes,
 * [1, seq] dimensions, output-name lookup. Those mistakes pass every unit test
 * and then fail on a device.
 *
 * SKIPS when `onnxruntime-node` (an optional dev dependency, installed outside
 * the repo) or the exported model is absent. Nobody should need a native ONNX
 * build to run the risk-engine suite.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { createNodeAdapter, loadOnnxRuntimeNode } from './nodeRuntimeAdapter.ts';
import { OnnxClassifier } from '../onnxClassifier.ts';
import { EnsembleClassifier } from '../ensembleClassifier.ts';
import { createClassifier } from '../index.ts';
import { EXPECTED_MODEL_SHA256 } from '../modelConfig.generated.ts';
import type { ManipulationLabel } from '../../../contracts/index.ts';

const MODEL = 'ml/models/ruko-manip-v1/onnx/model_int8.onnx';
const VOCAB = 'ml/models/ruko-manip-v1/onnx/vocab.txt';
const FIXTURE = 'mobile/src/risk/classifier/__tests__/parity_fixture.json';

const SEARCH_PATHS = [
  process.env.RUKO_ORT_NODE_PATH ?? '',
  `${process.env.TMPDIR ?? '/tmp'}/ortnode`,
  process.cwd(),
].filter(Boolean);

const ort = existsSync(MODEL) ? loadOnnxRuntimeNode(SEARCH_PATHS) : null;
const ready = ort !== null && existsSync(MODEL) && existsSync(VOCAB) && existsSync(FIXTURE);

const LABELS: ManipulationLabel[] = [
  'authority', 'coercion', 'urgency', 'financialInstruction', 'secrecy', 'credentialRequest',
];

describe('real ONNX inference through the shipped classifier', {
  skip: ready ? false : 'needs onnxruntime-node and the exported model',
}, () => {
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const adapter = createNodeAdapter(ort);
  const options = { adapter, modelPath: MODEL, vocabPath: VOCAB };

  test('loads the real model and verifies its hash against the shipped config', async () => {
    const c = new OnnxClassifier(options);
    const info = await c.loadModel();
    assert.equal(info.loaded, true);
    assert.equal(info.modelHash, EXPECTED_MODEL_SHA256,
      'the model on disk is not the one the thresholds were calibrated against');
    assert.equal(info.backend, 'CPU');
    assert.equal(info.quantization, 'int8');
    await c.dispose();
  });

  test('produces the same probabilities as Python, through the whole TS path', async () => {
    const c = new OnnxClassifier(options);
    await c.loadModel();
    for (const testCase of fixture.cases) {
      const { scores } = await c.rawProbabilities(testCase.text);
      for (const label of LABELS) {
        const expected = testCase.neural_probs[label];
        // int8 inference is deterministic, but ORT builds differ slightly in
        // kernel implementations, so this is a numerical-agreement bound rather
        // than an exact-equality check.
        assert.ok(Math.abs(scores[label] - expected) < 1e-4,
          `${label} on "${testCase.text.slice(0, 40)}": ` +
          `TS ${scores[label].toFixed(6)} vs Python ${expected.toFixed(6)}`);
      }
    }
    await c.dispose();
  });

  test('calibrated output matches Python for every fixture case', async () => {
    const c = new OnnxClassifier(options);
    await c.loadModel();
    for (const testCase of fixture.cases) {
      const evidence = await c.classify(testCase.text);
      for (const label of LABELS) {
        assert.ok(Math.abs(evidence.scores[label] - testCase.neural_calibrated[label]) < 1e-3,
          `${label}: ${evidence.scores[label]} vs ${testCase.neural_calibrated[label]}`);
      }
    }
    await c.dispose();
  });

  test('the scam transcript is flagged and ordinary conversation is not', async () => {
    const c = new OnnxClassifier(options);
    await c.loadModel();

    const scam = await c.classify(fixture.cases[0].text);
    assert.ok(scam.scores.coercion > 0.5, `coercion ${scam.scores.coercion}`);
    assert.ok(scam.scores.authority > 0.5, `authority ${scam.scores.authority}`);

    const benign = await c.classify(
      'the traffic was terrible today it took me a full hour to reach office',
    );
    for (const label of LABELS) {
      assert.ok(benign.scores[label] < 0.5, `${label} fired on small talk: ${benign.scores[label]}`);
    }
    await c.dispose();
  });

  test('measures real latency on this machine', async () => {
    const c = new OnnxClassifier(options);
    await c.loadModel();
    for (let i = 0; i < 12; i++) {
      await c.classify(fixture.cases[i % fixture.cases.length].text);
    }
    const info = c.getModelInfo();
    assert.ok(typeof info.measuredLatencyMsP50 === 'number');
    assert.ok(info.measuredLatencyMsP50! >= 0 && info.measuredLatencyMsP50! < 1000,
      `implausible latency: ${info.measuredLatencyMsP50} ms`);
    await c.dispose();
  });

  test('the ensemble runs the real model and fuses with the lexicon', async () => {
    const neural = new OnnxClassifier(options);
    await neural.loadModel();
    const ensemble = new EnsembleClassifier(neural);

    const e = await ensemble.classify(fixture.cases[0].text);
    assert.match(e.modelVersion, /\+lexicon$/);
    assert.equal(e.backend, 'CPU');
    assert.ok(e.scores.coercion > 0.5);
    assert.ok((e.evidenceSpans?.length ?? 0) > 0, 'spans come from the lexicon half');
    await ensemble.dispose();
  });

  test('createClassifier selects the neural path when the model really loads', async () => {
    const selection = await createClassifier(options);
    assert.equal(selection.neural, true, selection.fallbackReason ?? '');
    assert.equal(selection.fallbackReason, undefined);
    await selection.classifier.dispose();
  });
});
