/**
 * The ONNX classifier's own logic — backend reporting, hash verification,
 * calibration, fusion and fallback — tested against a fake runtime.
 *
 * Numerical agreement with the Python model is verified separately, in
 * parity.test.ts, by running the real .onnx file.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { OnnxClassifier } from '../onnxClassifier.ts';
import { EnsembleClassifier } from '../ensembleClassifier.ts';
import { createClassifier } from '../index.ts';
import { calibrateScore, fuseScores } from '../calibration.ts';
import { backendFromProvider } from '../runtime.ts';
import { EXPECTED_MODEL_SHA256, LABEL_THRESHOLDS } from '../modelConfig.generated.ts';
import type { OnnxRuntimeAdapter, OnnxSession } from '../runtime.ts';
import type { InferenceBackend, ManipulationScores } from '../../../contracts/index.ts';

const VOCAB_PATH = 'ml/models/ruko-manip-v1/onnx/vocab.txt';
const hasVocab = existsSync(VOCAB_PATH);

/** A runtime that returns fixed logits, and reports whatever provider we tell it. */
function fakeAdapter(opts: {
  logits?: number[];
  grantedProvider?: string;
  hash?: string | null;
  failCreate?: string;
} = {}): OnnxRuntimeAdapter {
  const logits = opts.logits ?? [2, -2, 0, 1, -1, 3];
  const session: OnnxSession = {
    activeProviders: [opts.grantedProvider ?? 'cpu'],
    async run() {
      return { logits: { data: logits, dims: [1, logits.length] } };
    },
    async release() {},
  };
  return {
    name: 'fake',
    async createSession(_path, _preferred: InferenceBackend[]) {
      if (opts.failCreate) throw new Error(opts.failCreate);
      return { session, backend: backendFromProvider(opts.grantedProvider ?? 'cpu') };
    },
    int64Tensor(values, dims) {
      return { data: values, dims };
    },
    async readTextAsset() {
      return readFileSync(VOCAB_PATH, 'utf8');
    },
    sha256File: opts.hash === undefined ? undefined : async () => opts.hash!,
  };
}

const options = (adapter: OnnxRuntimeAdapter) => ({
  adapter, modelPath: 'model_int8.onnx', vocabPath: 'vocab.txt',
});

describe('calibration', () => {
  test('maps each label threshold onto exactly 0.5', () => {
    for (const [, t] of Object.entries(LABEL_THRESHOLDS)) {
      assert.ok(Math.abs(calibrateScore(t, t) - 0.5) < 1e-9);
    }
  });

  test('is monotonic and preserves the endpoints', () => {
    assert.equal(calibrateScore(0, 0.37), 0);
    assert.equal(calibrateScore(1, 0.37), 1);
    let prev = -1;
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const v = calibrateScore(p, 0.37);
      assert.ok(v >= prev - 1e-9, `not monotonic at ${p}`);
      prev = v;
    }
  });

  test('a below-threshold probability lands below 0.5 and vice versa', () => {
    assert.ok(calibrateScore(0.1, 0.2) < 0.5);
    assert.ok(calibrateScore(0.3, 0.2) > 0.5);
  });

  test('rejects rubbish input instead of propagating NaN', () => {
    assert.equal(calibrateScore(Number.NaN, 0.4), 0);
    assert.ok(calibrateScore(5, 0.4) <= 1);
    assert.ok(calibrateScore(-5, 0.4) >= 0);
  });

  test('fusion weights the two sources as configured', () => {
    const neural = { authority: 1, coercion: 0, urgency: 0.5,
      financialInstruction: 0, secrecy: 0, credentialRequest: 0 } as ManipulationScores;
    const lexical = { authority: 0, coercion: 1, urgency: 0.5,
      financialInstruction: 0, secrecy: 0, credentialRequest: 0 } as ManipulationScores;
    const fused = fuseScores(neural, lexical, 0.5);
    assert.equal(fused.authority, 0.5);
    assert.equal(fused.coercion, 0.5);
    assert.equal(fused.urgency, 0.5);
    assert.deepEqual(fuseScores(neural, lexical, 1), neural);
  });
});

describe('OnnxClassifier', { skip: hasVocab ? false : 'export the model first' }, () => {
  test('reports the backend the runtime actually granted, not the one requested', async () => {
    const c = new OnnxClassifier({
      ...options(fakeAdapter({ grantedProvider: 'cpu' })),
      backendPreference: ['NNAPI', 'CPU'],
    });
    const info = await c.loadModel();
    assert.equal(info.requestedBackend, 'NNAPI');
    assert.equal(info.backend, 'CPU', 'must not claim NNAPI when it got CPU');
  });

  test('reports NNAPI when the runtime really granted it', async () => {
    const c = new OnnxClassifier({
      ...options(fakeAdapter({ grantedProvider: 'nnapi' })),
      backendPreference: ['NNAPI', 'CPU'],
    });
    assert.equal((await c.loadModel()).backend, 'NNAPI');
  });

  test('marks the hash unverified when the platform cannot compute one', async () => {
    const c = new OnnxClassifier(options(fakeAdapter()));
    const info = await c.loadModel();
    assert.match(info.modelHash, /^unverified:/,
      'must not present the expected hash as a verified one');
  });

  test('records a real hash when the platform can compute one', async () => {
    const c = new OnnxClassifier(options(fakeAdapter({ hash: EXPECTED_MODEL_SHA256 })));
    assert.equal((await c.loadModel()).modelHash, EXPECTED_MODEL_SHA256);
  });

  test('refuses to load a model whose hash does not match the thresholds', async () => {
    const c = new OnnxClassifier(options(fakeAdapter({ hash: 'deadbeef'.repeat(8) })));
    await assert.rejects(() => c.loadModel(), /hash mismatch/);
  });

  test('classify produces calibrated scores in range with measured latency', async () => {
    const c = new OnnxClassifier(options(fakeAdapter()));
    await c.loadModel();
    const e = await c.classify('your account will be frozen transfer 48000 immediately now please');
    assert.equal(e.available, true);
    assert.equal(e.source, 'ON_DEVICE_MODEL');
    for (const [label, v] of Object.entries(e.scores)) {
      assert.ok(v >= 0 && v <= 1, `${label} = ${v}`);
    }
    assert.ok(typeof e.latencyMs === 'number');
    assert.ok(e.reliability > 0);
  });

  test('classify before loadModel fails loudly rather than returning zeros', async () => {
    const c = new OnnxClassifier(options(fakeAdapter()));
    await assert.rejects(() => c.classify('anything at all here'), /loadModel/);
  });

  test('a model returning the wrong number of outputs is an error, not silence', async () => {
    const c = new OnnxClassifier(options(fakeAdapter({ logits: [1, 2] })));
    await c.loadModel();
    await assert.rejects(() => c.classify('some transcript text here'), /expected 6/);
  });

  test('latency percentiles appear only after real inferences', async () => {
    const c = new OnnxClassifier(options(fakeAdapter()));
    await c.loadModel();
    assert.equal(c.getModelInfo().measuredLatencyMsP50, undefined);
    for (let i = 0; i < 5; i++) await c.classify('transfer the money immediately please now');
    assert.ok(typeof c.getModelInfo().measuredLatencyMsP50 === 'number');
  });
});

describe('EnsembleClassifier', { skip: hasVocab ? false : 'export the model first' }, () => {
  test('combines the model with the lexicon and labels itself as such', async () => {
    const neural = new OnnxClassifier(options(fakeAdapter({ logits: [0, 0, 0, 0, 0, 0] })));
    await neural.loadModel();
    const e = await new EnsembleClassifier(neural).classify(
      'your account will be frozen you must transfer 48000 immediately do not disconnect',
    );
    assert.match(e.modelVersion, /\+lexicon$/);
    // Model outputs 0.5 for every label; the lexicon should pull the tactics
    // it recognises above the model's fence-sitting.
    assert.ok(e.scores.coercion > e.scores.secrecy,
      'the lexicon must actually influence the fused result');
    assert.ok((e.evidenceSpans?.length ?? 0) > 0);
  });
});

describe('classifier selection', () => {
  test('with no model configured, the lexicon is used and says so', async () => {
    const s = await createClassifier();
    assert.equal(s.neural, false);
    assert.equal(s.classifier.getModelInfo().backend, 'HEURISTIC');
    assert.ok(s.fallbackReason);
  });

  test('a model that fails to load falls back instead of throwing', {
    skip: hasVocab ? false : 'export the model first',
  }, async () => {
    const s = await createClassifier(options(fakeAdapter({ failCreate: 'no NNAPI driver' })));
    assert.equal(s.neural, false);
    assert.equal(s.classifier.getModelInfo().backend, 'HEURISTIC');
    assert.match(s.fallbackReason!, /no NNAPI driver/);
    // And it must still work.
    const e = await s.classifier.classify('your account will be frozen transfer 48000 now');
    assert.ok(e.scores.coercion > 0.5);
  });

  test('a working model yields the ensemble', {
    skip: hasVocab ? false : 'export the model first',
  }, async () => {
    const s = await createClassifier(options(fakeAdapter()));
    assert.equal(s.neural, true);
    assert.match(s.classifier.getModelInfo().modelVersion, /\+lexicon/);
  });
});
