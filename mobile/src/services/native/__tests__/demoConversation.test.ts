import {test, describe} from 'node:test';
import assert from 'node:assert/strict';

import {createDemoAwareConversationProvider} from '../demoConversation.ts';

// Minimal fakes — we are testing routing, not the model or the mic.
const evidence = (over: Record<string, unknown> = {}): any => ({
  available: true,
  source: 'ON_DEVICE_MODEL',
  scores: {authority: 0, coercion: 0, urgency: 0, financialInstruction: 0, secrecy: 0, credentialRequest: 0},
  reliability: 0.9,
  windowMs: 1000,
  transcriptChars: 20,
  modelVersion: 'ruko-manip-v1',
  backend: 'NNAPI',
  timestamp: 1,
  ...over,
});

function fakeMic(): any {
  let running = false;
  return {
    source: 'ON_DEVICE_MODEL',
    started: 0,
    async start() {
      running = true;
      this.started += 1;
    },
    async stop() {
      running = false;
    },
    isRunning: () => running,
    read: async () => evidence({available: false, unavailableReason: 'mic: nothing heard', source: 'ON_DEVICE_MODEL'}),
    subscribe: () => () => {},
  };
}

function busWith(lines: any): any {
  const listeners: Array<(v: any) => void> = [];
  return {
    getScenario: () => (lines ? {lines} : null),
    transcript: {
      emit: (v: any) => listeners.forEach((l: (v: any) => void) => l(v)),
      subscribe: (l: (v: any) => void) => {
        listeners.push(l);
        return () => {};
      },
      value: [],
    },
  };
}

describe('demo-aware conversation provider', () => {
  test('with no scenario, it is the microphone — read passes through', async () => {
    const mic = fakeMic();
    const p = createDemoAwareConversationProvider(mic, busWith(null), async () => evidence());
    await p.start('s');
    assert.equal(mic.started, 1, 'mic session started');
    const r = await p.read();
    assert.equal(r.available, false);
    assert.match(r.unavailableReason ?? '', /mic/);
  });

  test('with a scenario, it plays scripted lines through the classifier and does NOT open the mic', async () => {
    const mic = fakeMic();
    const seen: string[] = [];
    const lines = [
      {atMs: 0, speaker: 'CALLER', text: 'calling from your bank'},
      {atMs: 0, speaker: 'CALLER', text: 'transfer 48000 immediately'},
    ];
    const classify = async (t: string) => {
      seen.push(t);
      return evidence({available: true, scores: {...evidence().scores, coercion: 0.9}});
    };
    const p = createDemoAwareConversationProvider(mic, busWith(lines), classify);
    await p.start('demo');
    // lines are on 0ms timers; let them fire
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(mic.started, 0, 'the mic must NOT be opened during a scripted demo');
    assert.ok(seen.length >= 1, 'classifier was called with scripted text');
    // transcript accumulates, not just the last line
    assert.ok(seen[seen.length - 1].includes('transfer 48000'), 'growing transcript reaches the classifier');

    const r = await p.read();
    assert.equal(r.available, true, 'agent reads the scripted evidence, not silence');
    assert.equal(r.scores.coercion, 0.9);
  });

  test('read reports idle (not stale mic) before the first scripted line lands', async () => {
    const mic = fakeMic();
    const p = createDemoAwareConversationProvider(
      mic,
      busWith([{atMs: 5000, speaker: 'CALLER', text: 'late line'}]),
      async () => evidence(),
    );
    await p.start('demo');
    const r = await p.read(); // nothing has fired yet
    assert.equal(r.available, false);
    assert.match(r.unavailableReason ?? '', /No speech/);
  });
});
