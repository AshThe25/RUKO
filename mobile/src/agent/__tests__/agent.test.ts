/**
 * Investigation agent: does it gather the right evidence, in the right order,
 * survive tool failure, and stay out of the way when nothing is happening?
 *
 * These run the REAL pipeline — real classifier, real behaviour engine, real
 * payee engine, real risk engine. Only the device inputs are controlled.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { RukoAgent } from '../rukoAgent.ts';
import { HeuristicClassifier } from '../../risk/classifier/heuristicClassifier.ts';
import {
  DEMO_SALT, DemoCallProvider, DemoConversationProvider, DemoNotificationProvider,
  DemoPaymentProvider, InMemoryHistoryStore, demoHistory,
} from '../../tools/demoProviders.ts';
import type { RukoProviders } from '../../tools/providers.ts';

const NOW = Date.UTC(2026, 7, 29, 14, 30, 0);

function makeProviders(): RukoProviders & {
  conversation: DemoConversationProvider; payment: DemoPaymentProvider;
  call: DemoCallProvider; history: InMemoryHistoryStore;
  notification: DemoNotificationProvider;
} {
  const history = new InMemoryHistoryStore();
  history.seed(demoHistory(NOW), ['Landlord']);
  return {
    conversation: new DemoConversationProvider(new HeuristicClassifier()),
    payment: new DemoPaymentProvider(NOW),
    call: new DemoCallProvider(),
    notification: new DemoNotificationProvider(),
    history,
    now: () => NOW,
  };
}

describe('agent: evidence gathering', () => {
  test('a quiet phone with no payment does not run the expensive tool', async () => {
    const p = makeProviders();
    const result = await new RukoAgent({ providers: p, sessionId: 's1' }).investigate('MANUAL');

    const ran = result.trace.filter((t) => t.kind === 'TOOL_START').map((t) => t.tool);
    assert.ok(!ran.includes('conversationTool'),
      'must not analyse speech when there is no call and no payment');
    assert.ok(result.trace.some((t) => /Skipped conversation analysis/.test(t.message)));
    assert.equal(result.risk.level, 'LOW');
    assert.equal(result.risk.policyAction, 'NONE');
  });

  test('an open payment triggers the full investigation', async () => {
    const p = makeProviders();
    p.payment.openPayment('Ravi Verify', 48_000_00, NOW);
    p.call.startCall({ callerKnown: false, startedBeforePayment: true });
    p.conversation.setTranscript('hello sir i am calling from the bank your account will be frozen');

    const result = await new RukoAgent({ providers: p, sessionId: 's2' })
      .investigate('PAYMENT_SCREEN_DETECTED');

    const ran = result.trace.filter((t) => t.kind === 'TOOL_START').map((t) => t.tool);
    for (const tool of ['paymentTool', 'callContextTool', 'payeeTool', 'behaviourTool',
      'conversationTool', 'notificationTool'] as const) {
      assert.ok(ran.includes(tool), `${tool} should have run`);
    }
    assert.equal(result.failedTools.length, 0);
  });

  test('the payee tool runs after the payment tool, because it needs its output', async () => {
    const p = makeProviders();
    p.payment.openPayment('Arjun', 500_00, NOW);
    const result = await new RukoAgent({ providers: p }).investigate('PAYMENT_SCREEN_DETECTED');

    const order = result.trace.filter((t) => t.kind === 'TOOL_START').map((t) => t.tool);
    assert.ok(order.indexOf('paymentTool') < order.indexOf('payeeTool'));
    assert.equal(result.evidence.payee.known, true, 'Arjun is in the seeded history');
    assert.ok(result.evidence.payee.previousTransactions > 0);
  });
});

describe('agent: resilience', () => {
  test('a throwing tool is recorded and the investigation still completes', async () => {
    const p = makeProviders();
    p.payment.openPayment('Ravi Verify', 48_000_00, NOW);
    p.call.getCallContext = async () => { throw new Error('phone state permission revoked'); };

    const result = await new RukoAgent({ providers: p }).investigate('PAYMENT_SCREEN_DETECTED');

    assert.deepEqual(result.failedTools, ['callContextTool']);
    assert.ok(result.trace.some((t) => t.kind === 'ERROR'));
    assert.equal(result.evidence.call.available, false, 'failed tool must yield unavailable evidence');
    assert.ok(result.risk.score >= 0, 'the run still produced a score');
    assert.equal(result.risk.degraded, true);
  });

  test('an unreadable payment screen degrades rather than crashing', async () => {
    const p = makeProviders();
    p.payment.setUnreadable();
    const result = await new RukoAgent({ providers: p }).investigate('PAYMENT_SCREEN_DETECTED');
    assert.equal(result.evidence.payment.available, false);
    assert.equal(result.risk.degraded, true);
  });

  test('a missing notification provider is unavailable, not a crash', async () => {
    const p = makeProviders();
    const result = await new RukoAgent({
      providers: { ...p, notification: undefined },
    }).investigate('PAYMENT_SCREEN_DETECTED');
    assert.equal(result.evidence.notification?.available, false);
  });
});

describe('agent: trace quality', () => {
  test('every trace line is human-readable and sequentially numbered', async () => {
    const p = makeProviders();
    p.payment.openPayment('Ravi Verify', 48_000_00, NOW);
    p.conversation.setTranscript('transfer 48000 immediately do not disconnect');
    const result = await new RukoAgent({ providers: p }).investigate('PAYMENT_SCREEN_DETECTED');

    assert.ok(result.trace.length >= 10);
    result.trace.forEach((entry, i) => {
      assert.equal(entry.seq, i, 'trace must be sequentially numbered');
      assert.ok(entry.message.length > 0);
      // No raw identifiers, JSON or object dumps in user-visible copy.
      assert.ok(!/[{}]|undefined|\[object/.test(entry.message),
        `trace line not user-readable: ${entry.message}`);
    });
    assert.ok(result.trace.some((t) => t.kind === 'RISK'));
    assert.ok(result.trace.some((t) => t.kind === 'POLICY'));
  });

  test('trace callbacks stream live, in order, during the run', async () => {
    const p = makeProviders();
    p.payment.openPayment('Ravi Verify', 48_000_00, NOW);
    const streamed: number[] = [];
    const result = await new RukoAgent({ providers: p })
      .investigate('PAYMENT_SCREEN_DETECTED', (e) => streamed.push(e.seq));
    assert.deepEqual(streamed, result.trace.map((t) => t.seq));
  });

  test('the payment amount is formatted for a human, not printed in paise', async () => {
    const p = makeProviders();
    p.payment.openPayment('Ravi Verify', 48_000_00, NOW);
    const result = await new RukoAgent({ providers: p }).investigate('PAYMENT_SCREEN_DETECTED');
    const line = result.trace.find((t) => t.tool === 'paymentTool' && t.kind === 'TOOL_RESULT');
    assert.match(line!.message, /48,000/);
    assert.ok(!/4800000/.test(line!.message));
  });
});

describe('agent: the agent decides, the engine judges', () => {
  test('the agent never produces a risk level itself', async () => {
    const p = makeProviders();
    p.payment.openPayment('Ravi Verify', 48_000_00, NOW);
    const result = await new RukoAgent({ providers: p }).investigate('PAYMENT_SCREEN_DETECTED');
    // The only RISK trace line must be a report of the engine's output.
    const riskLines = result.trace.filter((t) => t.kind === 'RISK');
    assert.equal(riskLines.length, 1);
    assert.equal(riskLines[0].detail?.score, result.risk.score);
    assert.equal(result.risk.engineVersion, 'ruko-risk-engine-v1');
  });

  test('exhaustive mode runs every tool regardless of context', async () => {
    const p = makeProviders();
    const result = await new RukoAgent({ providers: p, exhaustive: true }).investigate('MANUAL');
    const ran = result.trace.filter((t) => t.kind === 'TOOL_START').map((t) => t.tool);
    assert.equal(new Set(ran).size, 6);
  });
});
