import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectLanguage, HeuristicClassifier, normalise, scoreText, windowReliability,
} from '../heuristicClassifier.ts';

describe('window reliability', () => {
  test('a very short window is worth nothing', () => {
    assert.equal(windowReliability('yes sir'), 0);
    assert.equal(windowReliability('account number please'), 0);
  });
  test('reliability rises with length and saturates', () => {
    const short = windowReliability('can you send me five hundred for dinner');
    const long = windowReliability(new Array(30).fill('word').join(' '));
    assert.ok(short > 0 && short < 1);
    assert.equal(long, 1);
  });
  test('poor ASR confidence drags reliability down', () => {
    const text = new Array(30).fill('word').join(' ');
    assert.equal(windowReliability(text, 1), 1);
    assert.ok(windowReliability(text, 0.4) < 0.5);
  });
});

describe('tactic detection', () => {
  test('a full-pressure scam window fires the expected tactics', () => {
    const { scores } = scoreText(
      'hello sir i am calling from sbi head office your account will be frozen ' +
      'you must transfer 48000 immediately and do not disconnect this call',
    );
    assert.ok(scores.authority > 0.5);
    assert.ok(scores.coercion > 0.5);
    assert.ok(scores.urgency > 0.5);
    assert.ok(scores.financialInstruction > 0.5);
  });

  test('romanised Hinglish is handled, not just English', () => {
    const { scores } = scoreText(
      'main crime branch se bol raha hoon aapka account block ho jayega ' +
      'turant 48000 bhej dijiye aur kisi ko mat bataiye',
    );
    assert.ok(scores.authority > 0.5, 'authority');
    assert.ok(scores.coercion > 0.5, 'coercion');
    assert.ok(scores.secrecy > 0.5, 'secrecy');
  });

  test('a friend asking for money is a financial instruction and nothing else', () => {
    const { scores } = scoreText('can you send me 500 for dinner last night');
    assert.ok(scores.financialInstruction > 0.5);
    for (const l of ['authority', 'coercion', 'secrecy', 'credentialRequest'] as const) {
      assert.ok(scores[l] < 0.25, `${l} should stay quiet, got ${scores[l]}`);
    }
  });

  test('fraud-awareness advice does not read as a credential request', () => {
    const { scores, benignContext } = scoreText(
      'never share your otp with anyone not even with bank staff please stay alert',
    );
    assert.equal(benignContext, true);
    assert.ok(scores.credentialRequest < 0.25,
      `awareness advice must not fire, got ${scores.credentialRequest}`);
  });

  test('a surprise party is not secrecy manipulation', () => {
    const { scores } = scoreText('do not tell her about it because it is a surprise for the birthday');
    assert.ok(scores.secrecy < 0.25, `got ${scores.secrecy}`);
  });

  test('ordinary conversation fires nothing at all', () => {
    const { scores } = scoreText('the traffic was terrible today it took me a full hour to reach office');
    for (const v of Object.values(scores)) assert.ok(v < 0.25);
  });

  test('repetition alone cannot saturate a label', () => {
    const once = scoreText('you must do it immediately').scores.urgency;
    const many = scoreText(
      'immediately immediately immediately immediately do it right now at once straight away',
    ).scores.urgency;
    assert.ok(many < 1, 'noisy-OR must not reach certainty from repetition');
    assert.ok(many >= once);
  });
});

describe('classifier contract', () => {
  test('reports itself honestly as a heuristic, with no fake model hash', () => {
    const info = new HeuristicClassifier().getModelInfo();
    assert.equal(info.backend, 'HEURISTIC');
    assert.equal(info.modelVersion, 'ruko-heuristic-v1');
    assert.match(info.modelHash, /no-model-file/);
  });

  test('produces valid ConversationEvidence with all six labels in [0,1]', async () => {
    const c = new HeuristicClassifier();
    await c.loadModel();
    const e = await c.classify('your account will be blocked transfer 48000 immediately');
    assert.equal(e.available, true);
    assert.equal(e.source, 'ON_DEVICE_HEURISTIC');
    for (const [label, v] of Object.entries(e.scores)) {
      assert.ok(v >= 0 && v <= 1, `${label} out of range: ${v}`);
    }
    assert.ok(e.reliability >= 0 && e.reliability <= 1);
    assert.ok(typeof e.latencyMs === 'number');
  });

  test('empty and whitespace input do not throw and claim nothing', async () => {
    const c = new HeuristicClassifier();
    for (const input of ['', '   ', '\n\t']) {
      const e = await c.classify(input);
      assert.equal(e.reliability, 0);
      for (const v of Object.values(e.scores)) assert.equal(v, 0);
    }
  });

  test('evidence spans are returned for the WHY screen', async () => {
    const e = await new HeuristicClassifier().classify(
      'i am calling from hdfc bank your account will be frozen transfer 48000 immediately',
    );
    assert.ok((e.evidenceSpans?.length ?? 0) > 0);
    assert.ok(e.evidenceSpans!.every((s) => s.text.length > 0 && s.score > 0));
  });
});

describe('normalisation and language', () => {
  test('normalise matches the ASR form used to build the dataset', () => {
    assert.equal(normalise('Hello, Sir!  Your ACCOUNT — frozen?'), 'hello sir your account frozen');
  });
  test('language detection distinguishes Hinglish from English', () => {
    assert.equal(detectLanguage('aapka account block ho jayega abhi paisa bhej dijiye'), 'hinglish');
    assert.equal(detectLanguage('your account will be blocked please transfer the money now'), 'en');
    assert.equal(detectLanguage('आपका खाता ब्लॉक हो जाएगा'), 'hi');
    assert.equal(detectLanguage(''), 'unknown');
  });
});
